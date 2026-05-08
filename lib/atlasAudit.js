// ============================================================
// lib/atlasAudit.js — Atlas fleet health auditor (deterministic)
//
// Atlas is the agent that watches the rest of the fleet. Its job
// is to answer ONE question on every cycle: "Is everyone working
// at peak right now, and if not, where's the failure?"
//
// The audit is intentionally deterministic — pure SQL counts and
// thresholds, no LLM. A health alert that hallucinates a problem
// is worse than no alert. The narrative pass (optional) is left
// for a future phase.
//
// Output contract: see runAtlasAudit() return shape.
// Persistence: writes one row to public.fleet_audits per call.
// Side effect: when status=CRITICAL, sends `incident_detected`
// to Manager via the caller's AgentMessenger.
// ============================================================

const STALE_HEARTBEAT_MS  = 5  * 60 * 1000; // > 5 min without heartbeat = STALE
const STUCK_CLAIM_MS      = 10 * 60 * 1000; // > 10 min claimed = stuck queue worker
const FAILED_WINDOW_MS    = 60 * 60 * 1000; // count failed messages in last 1h
const CRITICAL_FAILED_THRESHOLD = 5;        // ≥5 failed/h tips us to CRITICAL
const CRITICAL_CRASHED_THRESHOLD = 1;       // any crashed proc = CRITICAL
const DEGRADED_STALE_THRESHOLD   = 1;       // any stale proc = DEGRADED

/**
 * Run a single audit pass and persist the verdict.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase
 * @param {string}  args.brandId
 * @param {object} [args.messenger] Optional AgentMessenger — if provided
 *   and the verdict is CRITICAL, Atlas opens an incident with Manager.
 * @param {object} [args.log]       Optional logger.
 * @returns {Promise<{
 *   status: 'HEALTHY'|'DEGRADED'|'CRITICAL',
 *   alive_count: number,
 *   stale_count: number,
 *   crashed_count: number,
 *   stuck_messages: number,
 *   failed_1h: number,
 *   findings: Array<{ kind: string, agent?: string, detail: string, severity: 'info'|'warn'|'critical' }>,
 *   metrics: object,
 *   alerted: boolean,
 *   audit_id: number|null,
 * }>}
 */
export async function runAtlasAudit({ supabase, brandId, messenger = null, log = null }) {
  const now = Date.now();
  const findings = [];
  const metrics = {};

  // ── 1. agent_processes — heartbeats ────────────────────────
  const { data: procRows = [], error: procErr } = await supabase
    .from('agent_processes')
    .select('agent_name, process_id, status, last_heartbeat_at, started_at')
    .eq('brand_id', brandId)
    .order('last_heartbeat_at', { ascending: false });

  if (procErr) {
    findings.push({ kind: 'audit_error', detail: `agent_processes read failed: ${procErr.message}`, severity: 'critical' });
  }

  // Dedupe to most-recent row per agent_name (multiple boots leave history)
  const latestByAgent = new Map();
  for (const row of procRows) {
    const key = (row.agent_name || '').toLowerCase().trim();
    if (!key) continue;
    if (!latestByAgent.has(key)) latestByAgent.set(key, row);
  }

  let aliveCount = 0, staleCount = 0, crashedCount = 0;
  for (const row of latestByAgent.values()) {
    const hb = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
    const ageMs = now - hb;
    const status = (row.status || '').toLowerCase();

    if (status === 'crashed') {
      crashedCount++;
      findings.push({
        kind: 'process_crashed',
        agent: row.agent_name,
        detail: `Agente reportó status=crashed (process_id ${row.process_id})`,
        severity: 'critical',
      });
    } else if (status === 'stopped') {
      // Stopped is intentional — only flag if it's unexpected. For now: silent.
    } else if (ageMs > STALE_HEARTBEAT_MS) {
      staleCount++;
      const ageMin = Math.round(ageMs / 60000);
      findings.push({
        kind: 'heartbeat_stale',
        agent: row.agent_name,
        detail: `Sin pulso desde hace ${ageMin} min (último: ${row.last_heartbeat_at})`,
        severity: 'warn',
      });
    } else {
      aliveCount++;
    }
  }
  metrics.processes_total = latestByAgent.size;

  // ── 2. agent_messages — stuck claims (claimed but not processed) ──
  const stuckCutoff = new Date(now - STUCK_CLAIM_MS).toISOString();
  const { data: stuckRows = [], error: stuckErr } = await supabase
    .from('agent_messages')
    .select('id, from_agent, to_agent, claimed_by, claimed_at, payload')
    .eq('brand_id', brandId)
    .eq('status', 'claimed')
    .lt('claimed_at', stuckCutoff)
    .limit(20);

  if (stuckErr) {
    findings.push({ kind: 'audit_error', detail: `agent_messages stuck read failed: ${stuckErr.message}`, severity: 'critical' });
  }
  const stuckCount = stuckRows.length;
  for (const m of stuckRows) {
    findings.push({
      kind: 'message_stuck',
      agent: m.claimed_by || m.to_agent,
      detail: `Mensaje ${m.id} (${m.from_agent}→${m.to_agent}, ${m.payload?.type ?? '?'}) claimed sin procesar desde ${m.claimed_at}`,
      severity: 'warn',
    });
  }

  // ── 3. agent_messages — failed in last hour (per-agent counts) ──
  const failedSince = new Date(now - FAILED_WINDOW_MS).toISOString();
  const { data: failedRows = [], error: failedErr } = await supabase
    .from('agent_messages')
    .select('to_agent, error, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'failed')
    .gte('created_at', failedSince)
    .limit(200);

  if (failedErr) {
    findings.push({ kind: 'audit_error', detail: `agent_messages failed read failed: ${failedErr.message}`, severity: 'critical' });
  }
  const failedByAgent = new Map();
  for (const r of failedRows) {
    const k = r.to_agent || 'unknown';
    failedByAgent.set(k, (failedByAgent.get(k) || 0) + 1);
  }
  const failedTotal = failedRows.length;
  for (const [agent, count] of failedByAgent) {
    if (count >= 3) {
      findings.push({
        kind: 'errors_spiking',
        agent,
        detail: `${count} mensajes fallidos en última hora`,
        severity: count >= CRITICAL_FAILED_THRESHOLD ? 'critical' : 'warn',
      });
    }
  }

  // ── 4. agent_state — circuit breakers open (Gemini 429 etc.) ──
  const { data: circuitRows = [] } = await supabase
    .from('agent_state')
    .select('agent_name, key, value')
    .eq('brand_id', brandId)
    .eq('key', 'gemini_circuit_open_until')
    .limit(20);

  let circuitsOpen = 0;
  for (const r of circuitRows) {
    const until = r.value ? new Date(r.value).getTime() : 0;
    if (until > now) {
      circuitsOpen++;
      const remainMin = Math.round((until - now) / 60000);
      findings.push({
        kind: 'circuit_breaker_open',
        agent: r.agent_name,
        detail: `Circuit breaker abierto por LLM 429, reabre en ${remainMin} min`,
        severity: 'warn',
      });
    }
  }
  metrics.circuits_open = circuitsOpen;

  // ── 5. Verdict ─────────────────────────────────────────────
  let status = 'HEALTHY';
  if (
    crashedCount >= CRITICAL_CRASHED_THRESHOLD ||
    failedTotal >= CRITICAL_FAILED_THRESHOLD ||
    findings.some((f) => f.severity === 'critical')
  ) {
    status = 'CRITICAL';
  } else if (
    staleCount >= DEGRADED_STALE_THRESHOLD ||
    stuckCount > 0 ||
    circuitsOpen > 0 ||
    failedTotal > 0
  ) {
    status = 'DEGRADED';
  }

  metrics.failed_1h = failedTotal;
  metrics.failed_by_agent = Object.fromEntries(failedByAgent);
  metrics.audited_at = new Date(now).toISOString();

  // ── 6. Persist audit row ──────────────────────────────────
  let audit_id = null;
  let alerted = false;
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('fleet_audits')
      .insert({
        brand_id: brandId,
        status,
        alive_count: aliveCount,
        stale_count: staleCount,
        crashed_count: crashedCount,
        stuck_messages: stuckCount,
        failed_1h: failedTotal,
        findings,
        metrics,
      })
      .select('id')
      .single();
    if (insErr) {
      log?.warn?.('atlas: failed to persist audit', { err: insErr.message });
    } else {
      audit_id = inserted.id;
    }
  } catch (e) {
    log?.warn?.('atlas: persist threw', { err: e.message });
  }

  // ── 7. Send incident to Manager if CRITICAL ──────────────
  if (status === 'CRITICAL' && messenger && audit_id) {
    try {
      await messenger.send({
        to_agent: 'manager',
        payload: {
          type: 'incident_detected',
          source: 'atlas',
          audit_id,
          severity: 'critical',
          findings: findings.filter((f) => f.severity === 'critical'),
          summary: shortSummary({ status, crashedCount, staleCount, failedTotal, stuckCount }),
          opened_at: metrics.audited_at,
        },
      });
      alerted = true;
      // Mark this audit as having alerted (fire-and-forget; not load-bearing)
      await supabase.from('fleet_audits').update({ alerted: true }).eq('id', audit_id);
    } catch (e) {
      log?.warn?.('atlas: failed to send incident_detected to manager', { err: e.message });
    }
  }

  log?.info?.('atlas: audit complete', {
    status, aliveCount, staleCount, crashedCount, stuckCount, failedTotal, alerted, audit_id,
  });

  return {
    status,
    alive_count: aliveCount,
    stale_count: staleCount,
    crashed_count: crashedCount,
    stuck_messages: stuckCount,
    failed_1h: failedTotal,
    findings,
    metrics,
    alerted,
    audit_id,
  };
}

function shortSummary({ status, crashedCount, staleCount, failedTotal, stuckCount }) {
  const parts = [];
  if (crashedCount > 0) parts.push(`${crashedCount} crashed`);
  if (staleCount   > 0) parts.push(`${staleCount} stale`);
  if (stuckCount   > 0) parts.push(`${stuckCount} stuck`);
  if (failedTotal  > 0) parts.push(`${failedTotal} fallos/1h`);
  return `Atlas · ${status} — ${parts.join(', ') || 'sin issues'}`;
}
