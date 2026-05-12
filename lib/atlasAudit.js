// ============================================================
// lib/atlasAudit.js — Atlas fleet health auditor
//
// Atlas watches the rest of the fleet. One question per cycle:
// "Is everyone working at peak right now, and if not, where?"
//
// Verdict logic = pure SQL + thresholds (deterministic, never
// hallucinates). Daily narrative summary uses LLM, but only as
// post-hoc storytelling — never as an input to verdict.
// ============================================================

const STALE_HEARTBEAT_MS  = 5  * 60 * 1000;
const STUCK_CLAIM_MS      = 10 * 60 * 1000;
const ORPHAN_RECLAIM_MS   = 30 * 60 * 1000;  // > 30 min stuck → return to queue
const FAILED_WINDOW_MS    = 60 * 60 * 1000;
const CRITICAL_FAILED_THRESHOLD = 5;
const CRITICAL_CRASHED_THRESHOLD = 1;
const DEGRADED_STALE_THRESHOLD   = 1;
const ALERT_DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1h: same fingerprint → no spam
const QUERY_TIMEOUT_MS       = 8000;

/**
 * Wraps a thenable with a hard timeout. Returns { data: null, error }
 * shape compatible with Supabase replies, so callers don't need to
 * change error-handling code.
 */
async function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(
      () => resolve({ data: null, error: { message: `timeout after ${ms}ms (${label})` } }),
      ms,
    )),
  ]);
}

/**
 * Stable fingerprint of the current critical findings — used to
 * dedupe alerts across consecutive cycles.
 */
function fingerprintFindings(findings) {
  return findings
    .filter((f) => f.severity === 'critical')
    .map((f) => `${f.kind}:${f.agent ?? '_'}`)
    .sort()
    .join('|');
}

/**
 * Run a single audit pass.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase
 * @param {string}  args.brandId
 * @param {object} [args.messenger]   Optional — used to alert Manager + reclaim orphans
 * @param {object} [args.log]
 * @param {boolean} [args.autoRecover] When true (default), Atlas reclaims orphan messages.
 */
export async function runAtlasAudit({
  supabase,
  brandId,
  messenger = null,
  log = null,
  autoRecover = true,
}) {
  const now = Date.now();
  const findings = [];
  const metrics = {};
  let recoveredOrphans = 0;

  // ── 1. agent_processes ────────────────────────────────────
  const procResp = await withTimeout(
    supabase
      .from('agent_processes')
      .select('agent_name, process_id, status, last_heartbeat_at, started_at')
      .eq('brand_id', brandId)
      .order('last_heartbeat_at', { ascending: false }),
    QUERY_TIMEOUT_MS,
    'agent_processes',
  );
  const procRows = procResp.data || [];
  if (procResp.error) {
    findings.push({ kind: 'audit_error', detail: `agent_processes read failed: ${procResp.error.message}`, severity: 'warn' });
  }

  // Dedupe — pick the row with most recent activity (max of last_heartbeat_at
  // or started_at). Earlier logic used started_at alone, which let zombie
  // boot-rows (INSERT-but-never-heartbeat) shadow the actually-live process.
  // Real-world hit 2026-05-12: Angela had 64 rows; newest-started was stale
  // 21h, the truly-live row had heartbeat 8s ago but older started_at.
  const scoreRow = (r) => {
    const hb = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
    const st = r.started_at        ? new Date(r.started_at).getTime()        : 0;
    return Math.max(hb, st);
  };
  const latestByAgent = new Map();
  for (const row of procRows) {
    const key = (row.agent_name || '').toLowerCase().trim();
    if (!key) continue;
    const prev = latestByAgent.get(key);
    if (!prev || scoreRow(row) > scoreRow(prev)) {
      latestByAgent.set(key, row);
    }
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
      // intentional — silent
    } else if (ageMs > STALE_HEARTBEAT_MS) {
      staleCount++;
      const ageMin = Math.round(ageMs / 60000);
      findings.push({
        kind: 'heartbeat_stale',
        agent: row.agent_name,
        detail: `Sin pulso desde hace ${ageMin} min`,
        severity: 'warn',
      });
    } else {
      aliveCount++;
    }
  }
  metrics.processes_total = latestByAgent.size;

  // ── 2. agent_messages — stuck claims ─────────────────────
  const stuckCutoff = new Date(now - STUCK_CLAIM_MS).toISOString();
  const stuckResp = await withTimeout(
    supabase
      .from('agent_messages')
      .select('id, from_agent, to_agent, claimed_by, claimed_at, payload')
      .eq('brand_id', brandId)
      .eq('status', 'claimed')
      .lt('claimed_at', stuckCutoff)
      .limit(20),
    QUERY_TIMEOUT_MS,
    'agent_messages_stuck',
  );
  const stuckRows = stuckResp.data || [];
  if (stuckResp.error) {
    findings.push({ kind: 'audit_error', detail: `agent_messages stuck read failed: ${stuckResp.error.message}`, severity: 'warn' });
  }
  const stuckCount = stuckRows.length;
  for (const m of stuckRows) {
    findings.push({
      kind: 'message_stuck',
      agent: m.claimed_by || m.to_agent,
      detail: `Mensaje ${m.id} (${m.from_agent}→${m.to_agent}, ${m.payload?.type ?? '?'}) atascado desde ${m.claimed_at}`,
      severity: 'warn',
    });
  }

  // ── 2b. AUTO-RECOVERY of orphans (> 30 min stuck) ─────────
  // Returns the message to the queue so any worker can claim it.
  // Only fires if autoRecover=true and we have a path to the DB.
  if (autoRecover) {
    const orphanCutoff = new Date(now - ORPHAN_RECLAIM_MS).toISOString();
    const orphanIds = stuckRows
      .filter((m) => m.claimed_at && m.claimed_at < orphanCutoff)
      .map((m) => m.id);

    if (orphanIds.length > 0) {
      const recoverResp = await withTimeout(
        supabase
          .from('agent_messages')
          .update({ status: 'pending', claimed_by: null, claimed_at: null })
          .in('id', orphanIds)
          .select('id'),
        QUERY_TIMEOUT_MS,
        'agent_messages_reclaim',
      );
      if (recoverResp.error) {
        findings.push({ kind: 'audit_error', detail: `auto-recovery failed: ${recoverResp.error.message}`, severity: 'warn' });
      } else {
        recoveredOrphans = (recoverResp.data || []).length;
        if (recoveredOrphans > 0) {
          findings.push({
            kind: 'orphans_recovered',
            detail: `Atlas devolvió ${recoveredOrphans} mensajes a la cola para reasignación`,
            severity: 'info',
          });
        }
      }
    }
  }

  // ── 3. agent_messages — failed in last hour ──────────────
  const failedSince = new Date(now - FAILED_WINDOW_MS).toISOString();
  const failedResp = await withTimeout(
    supabase
      .from('agent_messages')
      .select('to_agent, error, created_at')
      .eq('brand_id', brandId)
      .eq('status', 'failed')
      .gte('created_at', failedSince)
      .limit(500),
    QUERY_TIMEOUT_MS,
    'agent_messages_failed',
  );
  const failedRows = failedResp.data || [];
  if (failedResp.error) {
    findings.push({ kind: 'audit_error', detail: `agent_messages failed read failed: ${failedResp.error.message}`, severity: 'warn' });
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

  // ── 4. agent_state — circuit breakers (any provider) ─────
  const circuitResp = await withTimeout(
    supabase
      .from('agent_state')
      .select('agent_name, key, value')
      .eq('brand_id', brandId)
      .like('key', '%_circuit_open_until')
      .limit(20),
    QUERY_TIMEOUT_MS,
    'agent_state_circuits',
  );
  const circuitRows = circuitResp.data || [];

  let circuitsOpen = 0;
  for (const r of circuitRows) {
    const until = r.value ? new Date(r.value).getTime() : 0;
    if (until > now) {
      circuitsOpen++;
      const remainMin = Math.round((until - now) / 60000);
      const provider = (r.key || '').replace('_circuit_open_until', '');
      findings.push({
        kind: 'circuit_breaker_open',
        agent: r.agent_name,
        detail: `Circuit breaker ${provider} abierto, reabre en ${remainMin} min`,
        severity: 'warn',
      });
    }
  }
  metrics.circuits_open = circuitsOpen;

  // ── 5. Verdict ────────────────────────────────────────────
  const realCriticals = findings.filter((f) => f.severity === 'critical' && f.kind !== 'audit_error');
  let status = 'HEALTHY';
  if (
    crashedCount >= CRITICAL_CRASHED_THRESHOLD ||
    realCriticals.length > 0
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
  metrics.recovered_orphans = recoveredOrphans;
  metrics.audited_at = new Date(now).toISOString();
  metrics.fingerprint = fingerprintFindings(findings);

  // ── 6. Persist audit row ─────────────────────────────────
  let audit_id = null;
  let alerted = false;
  let alertSkippedReason = null;

  const insResp = await withTimeout(
    supabase
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
      .single(),
    QUERY_TIMEOUT_MS,
    'fleet_audits_insert',
  );
  if (insResp.error) {
    log?.warn?.('atlas: failed to persist audit', { err: insResp.error.message });
  } else {
    audit_id = insResp.data?.id ?? null;
  }

  // ── 7. Alert Manager if CRITICAL — with idempotency dedupe ─
  if (status === 'CRITICAL' && messenger) {
    // Look up the last audit before this one to compare fingerprints
    const lastResp = await withTimeout(
      supabase
        .from('fleet_audits')
        .select('id, status, metrics, alerted, created_at')
        .eq('brand_id', brandId)
        .lt('id', audit_id ?? Number.MAX_SAFE_INTEGER)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
      QUERY_TIMEOUT_MS,
      'fleet_audits_last',
    );

    const last = lastResp.data;
    const sameFingerprint =
      last?.status === 'CRITICAL' &&
      last?.metrics?.fingerprint === metrics.fingerprint &&
      last?.alerted === true &&
      last?.created_at &&
      Date.now() - new Date(last.created_at).getTime() < ALERT_DEDUPE_WINDOW_MS;

    if (sameFingerprint) {
      alertSkippedReason = 'duplicate_incident_within_1h';
      log?.info?.('atlas: alert suppressed (duplicate)', { fingerprint: metrics.fingerprint });
    } else {
      try {
        await messenger.send({
          to_agent: 'manager',
          payload: {
            type: 'incident_detected',
            source: 'atlas',
            audit_id,
            severity: 'critical',
            findings: realCriticals,
            summary: shortSummary({ status, crashedCount, staleCount, failedTotal, stuckCount, recoveredOrphans }),
            opened_at: metrics.audited_at,
          },
        });
        alerted = true;
        if (audit_id) {
          await supabase.from('fleet_audits').update({ alerted: true }).eq('id', audit_id);
        }
      } catch (e) {
        log?.warn?.('atlas: failed to send incident_detected to manager', { err: e.message });
      }
    }
  }

  log?.info?.('atlas: audit complete', {
    status, aliveCount, staleCount, crashedCount, stuckCount, failedTotal,
    recoveredOrphans, alerted, alertSkippedReason, audit_id,
  });

  return {
    status,
    alive_count: aliveCount,
    stale_count: staleCount,
    crashed_count: crashedCount,
    stuck_messages: stuckCount,
    failed_1h: failedTotal,
    recovered_orphans: recoveredOrphans,
    findings,
    metrics,
    alerted,
    alert_skipped_reason: alertSkippedReason,
    audit_id,
  };
}

function shortSummary({ status, crashedCount, staleCount, failedTotal, stuckCount, recoveredOrphans }) {
  const parts = [];
  if (crashedCount > 0)    parts.push(`${crashedCount} crashed`);
  if (staleCount   > 0)    parts.push(`${staleCount} sin pulso`);
  if (stuckCount   > 0)    parts.push(`${stuckCount} atascados`);
  if (failedTotal  > 0)    parts.push(`${failedTotal} fallos/1h`);
  if (recoveredOrphans > 0) parts.push(`${recoveredOrphans} mensajes recuperados`);
  return `Atlas · ${status} — ${parts.join(', ') || 'sin issues'}`;
}

// ============================================================
// SKILL — Daily narrative report
//
// Once every 24h Atlas writes a plain-Spanish paragraph
// summarizing what the fleet did, what broke, what was recovered.
// Uses the LLM only for storytelling — verdict logic stays
// deterministic, so an LLM hiccup can't fake an alert.
// ============================================================

const DAILY_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Generate the daily report if it's been > 24h since the last one.
 * Returns the report (or null if skipped).
 */
export async function maybeGenerateDailyReport({ supabase, brandId, runtime, messenger, log }) {
  const lastReportAt = await messenger?.getState?.('last_daily_report_at');
  if (lastReportAt && Date.now() - new Date(lastReportAt).getTime() < DAILY_REPORT_INTERVAL_MS) {
    return null;
  }

  // Pull last 24h of audits.
  const since = new Date(Date.now() - DAILY_REPORT_INTERVAL_MS).toISOString();
  const auditsResp = await withTimeout(
    supabase
      .from('fleet_audits')
      .select('status, alive_count, stale_count, crashed_count, stuck_messages, failed_1h, metrics, created_at')
      .eq('brand_id', brandId)
      .gte('created_at', since)
      .order('created_at', { ascending: true }),
    QUERY_TIMEOUT_MS,
    'fleet_audits_24h',
  );
  const audits = auditsResp.data || [];

  if (audits.length === 0) {
    log?.info?.('atlas: daily report skipped — no audits in window');
    return null;
  }

  const tally = {
    total: audits.length,
    healthy:  audits.filter((a) => a.status === 'HEALTHY').length,
    degraded: audits.filter((a) => a.status === 'DEGRADED').length,
    critical: audits.filter((a) => a.status === 'CRITICAL').length,
    recovered: audits.reduce((s, a) => s + (a.metrics?.recovered_orphans || 0), 0),
    peak_failed: audits.reduce((max, a) => Math.max(max, a.failed_1h || 0), 0),
    peak_stuck:  audits.reduce((max, a) => Math.max(max, a.stuck_messages || 0), 0),
  };

  let narrative;
  if (runtime?.run) {
    try {
      const prompt = `Resumí en UN PÁRRAFO en español neutro (80-120 palabras, sin viñetas, sin emojis) cómo trabajó la flota Empírika las últimas 24 horas. Datos:
- Total chequeos: ${tally.total}
- Saludable: ${tally.healthy} · Degradado: ${tally.degraded} · Crítico: ${tally.critical}
- Mensajes atascados que Atlas recuperó: ${tally.recovered}
- Pico de errores en una hora: ${tally.peak_failed}
- Pico de mensajes atascados simultáneos: ${tally.peak_stuck}

Tono: directo, ejecutivo. Empezá con "En las últimas 24 horas". Si todo estuvo saludable, decilo claro. Si hubo incidentes, mencionalos sin alarmismo. Cerrá con una frase de estado actual.`;

      const reply = await Promise.race([
        runtime.run('atlas', prompt),
        new Promise((resolve) => setTimeout(() => resolve(null), 20_000)),
      ]);
      narrative = typeof reply === 'string' ? reply.trim() : (reply?.text || reply?.content || null);
    } catch (e) {
      log?.warn?.('atlas: LLM narrative failed', { err: e.message });
    }
  }

  if (!narrative) {
    // Deterministic fallback so the dashboard always has something.
    narrative = `En las últimas 24 horas Atlas ejecutó ${tally.total} auditorías sobre la flota Empírika: ${tally.healthy} saludables, ${tally.degraded} degradadas y ${tally.critical} críticas. ${tally.recovered > 0 ? `Se devolvieron ${tally.recovered} mensajes atascados a la cola para reasignación. ` : ''}El pico de errores en una sola hora fue ${tally.peak_failed} y el pico de mensajes simultáneos atascados fue ${tally.peak_stuck}. Estado actual: ${audits[audits.length - 1]?.status ?? 'desconocido'}.`;
  }

  const report = {
    generated_at: new Date().toISOString(),
    window: '24h',
    tally,
    narrative,
  };

  if (messenger) {
    await messenger.setState('last_daily_report_at', report.generated_at);
    await messenger.setState('last_daily_report', report);
  }
  log?.info?.('atlas: daily report generated', { tally });
  return report;
}
