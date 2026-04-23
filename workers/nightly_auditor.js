// ============================================================
// workers/nightly_auditor.js — Layer 1 nightly auditor
//
// Pure SQL, ZERO LLM calls. Writes rows to public.autonomy_audits.
// Invoked from agents/manager-daemon.js cycle type 'AUDIT' at 03:15 UTC.
// Plan: .omc/plans/autonomy-3layer-v2.md §B.3
//
// Contract:
//   runNightlyAudit({ brandId, client? }) -> { run_id, metrics_written, errors }
//
// Rules:
//   - AUDITOR_HEARTBEAT row written FIRST, always, before anything else.
//   - Each metric wrapped in its own try/catch. Failure writes an 'error'
//     severity row; never aborts the run.
//   - No imports of AgentRuntime, agents/*, or any LLM client (tests assert).
// ============================================================

import { randomUUID } from 'node:crypto';
import { supabase as defaultSupa } from '../lib/supabase.js';
import { lintSpanishOnly } from '../lib/spanishOnlyLinter.js';

const RETENTION_DAYS = 90;

function classify(value, thresholds) {
  // thresholds: { greenMax?, yellowMax?, redAbove? } OR { greenMin?, yellowMin?, redBelow? }
  const t = thresholds;
  if (t.direction === 'lower_is_better') {
    if (value <= t.greenMax) return 'green';
    if (value <= t.yellowMax) return 'yellow';
    return 'red';
  }
  // higher_is_better
  if (value >= t.greenMin) return 'green';
  if (value >= t.yellowMin) return 'yellow';
  return 'red';
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export async function runNightlyAudit({ brandId, client } = {}) {
  if (!brandId) throw new Error('runNightlyAudit: brandId required');
  const supa = client || defaultSupa;
  if (!supa) throw new Error('runNightlyAudit: no supabase client (check SUPABASE_SERVICE_ROLE_KEY)');
  const run_id = randomUUID();
  const errors = [];
  let written = 0;

  const insertRow = async (row) => {
    const payload = { ...row, brand_id: brandId, audit_run_id: run_id };
    const { error } = await supa.from('autonomy_audits').insert(payload);
    if (error) {
      errors.push({ metric: row.metric_name, err: error.message });
    } else {
      written++;
    }
  };

  // ── 1. HEARTBEAT (always first) ──────────────────────────────
  await insertRow({
    metric_name: 'AUDITOR_HEARTBEAT',
    value: Math.floor(Date.now() / 1000),
    severity: 'green',
    details: { iso: new Date().toISOString() },
  });

  // Helper: run metric with isolation
  const runMetric = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      await insertRow({
        metric_name: name,
        severity: 'error',
        details: { error: err?.message || String(err) },
      });
    }
  };

  const sinceISO = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

  // ── 2. sent_rate_24h ─────────────────────────────────────────
  await runMetric('sent_rate_24h', async () => {
    const { count, error } = await supa
      .from('campaign_enriched_data')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('outreach_status', 'SENT')
      .gte('email_sent_at', sinceISO(24));
    if (error) throw error;
    const value = count ?? 0;
    const severity = value >= 15 ? 'green' : value >= 5 ? 'yellow' : 'red';
    await insertRow({
      metric_name: 'sent_rate_24h',
      value,
      severity,
      suggested_action: severity === 'red' ? 'INVESTIGATE_SEND_PIPELINE' : null,
      threshold_hit: severity,
    });
  });

  // ── 3. sent_to_failure_rate_14d ──────────────────────────────
  await runMetric('sent_to_failure_rate_14d', async () => {
    const since = sinceISO(24 * 14);
    const { data: rows, error } = await supa
      .from('campaign_enriched_data')
      .select('outreach_status')
      .eq('brand_id', brandId)
      .gte('email_sent_at', since);
    if (error) throw error;
    const FAIL = new Set(['BOUNCED', 'SEND_FAIL', 'SMTP_ERROR', 'DELIVERY_FAILED']);
    const sent = (rows || []).filter(r => ['SENT', ...FAIL].includes(r.outreach_status)).length;
    const fails = (rows || []).filter(r => FAIL.has(r.outreach_status)).length;
    const rate = sent > 0 ? (fails / sent) : 0;
    const pct = Math.round(rate * 10000) / 100;
    const severity = classify(pct, { direction: 'lower_is_better', greenMax: 5, yellowMax: 15 });
    await insertRow({
      metric_name: 'sent_to_failure_rate_14d',
      value: pct,
      severity,
      suggested_action: severity === 'red' ? 'INVESTIGATE_DELIVERABILITY' : null,
      threshold_hit: severity,
      details: { sent, fails, window_days: 14 },
    });
  });

  // ── 4. outreach_events_row_count_24h ─────────────────────────
  await runMetric('outreach_events_row_count_24h', async () => {
    const { count, error } = await supa
      .from('outreach_events')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('occurred_at', sinceISO(24));
    if (error) throw error;
    const value = count ?? 0;
    const severity = value > 20 ? 'green' : value >= 1 ? 'yellow' : 'red';
    await insertRow({
      metric_name: 'outreach_events_row_count_24h',
      value,
      severity,
      suggested_action: severity === 'red' ? 'VERIFY_LEARNING_ENABLED_FLAG' : null,
      threshold_hit: severity,
    });
  });

  // ── 5. top_combos_freshness_hours ────────────────────────────
  await runMetric('top_combos_freshness_hours', async () => {
    const { data, error } = await supa
      .from('agent_memory')
      .select('updated_at')
      .eq('agent_name', 'manager')
      .eq('brand_id', brandId)
      .like('memory_key', '[LEARN][manager][top_combos]%')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) {
      await insertRow({
        metric_name: 'top_combos_freshness_hours',
        severity: 'red',
        suggested_action: 'REVIEW_LEARNING_CONSOLIDATOR',
        threshold_hit: 'no_rows',
        details: { note: 'no top_combos memory rows found' },
      });
      return;
    }
    const ageHours = (Date.now() - new Date(data[0].updated_at).getTime()) / 3600_000;
    const value = Math.round(ageHours * 10) / 10;
    const severity = classify(value, { direction: 'lower_is_better', greenMax: 30, yellowMax: 48 });
    await insertRow({
      metric_name: 'top_combos_freshness_hours',
      value,
      severity,
      suggested_action: severity === 'red' ? 'REVIEW_LEARNING_CONSOLIDATOR' : null,
      threshold_hit: severity,
    });
  });

  // ── 6. agent_error_rate_24h (per agent) ──────────────────────
  await runMetric('agent_error_rate_24h', async () => {
    const since = sinceISO(24);
    const { data, error } = await supa
      .from('agent_events')
      .select('agent, status')
      .eq('brand_id', brandId)
      .gte('created_at', since);
    if (error) throw error;
    const byAgent = {};
    for (const r of data || []) {
      const a = r.agent || 'unknown';
      byAgent[a] = byAgent[a] || { total: 0, errors: 0 };
      byAgent[a].total++;
      if (r.status === 'error') byAgent[a].errors++;
    }
    for (const [agent, { total, errors: errs }] of Object.entries(byAgent)) {
      if (total < 5) continue; // ignore tiny samples
      const rate = Math.round((errs / total) * 10000) / 100;
      const severity = classify(rate, { direction: 'lower_is_better', greenMax: 2, yellowMax: 10 });
      await insertRow({
        metric_name: `agent_error_rate_24h:${agent}`,
        value: rate,
        severity,
        suggested_action: severity === 'red' ? `INVESTIGATE_AGENT_${agent}` : null,
        threshold_hit: severity,
        details: { agent, total, errors: errs },
      });
    }
  });

  // ── 7. scrapling_latency_p95_24h ─────────────────────────────
  await runMetric('scrapling_latency_p95_24h', async () => {
    const { data, error } = await supa
      .from('agent_events')
      .select('duration_ms')
      .eq('brand_id', brandId)
      .eq('tool', 'scrapling')
      .gte('created_at', sinceISO(24))
      .not('duration_ms', 'is', null);
    if (error) throw error;
    const durations = (data || []).map(r => r.duration_ms).filter(Number.isFinite);
    if (durations.length < 5) {
      await insertRow({
        metric_name: 'scrapling_latency_p95_24h',
        severity: 'green',
        details: { sample_size: durations.length, note: 'insufficient_sample' },
      });
      return;
    }
    const p95ms = percentile(durations, 95);
    const p95s  = Math.round((p95ms / 1000) * 10) / 10;
    const severity = classify(p95s, { direction: 'lower_is_better', greenMax: 8, yellowMax: 20 });
    await insertRow({
      metric_name: 'scrapling_latency_p95_24h',
      value: p95s,
      severity,
      suggested_action: severity === 'red' ? 'ADJUST_SCRAPLING_TIMEOUT' : null,
      threshold_hit: severity,
      details: { sample_size: durations.length },
    });
  });

  // ── 8. ghl_api_error_rate_24h ────────────────────────────────
  await runMetric('ghl_api_error_rate_24h', async () => {
    const { data, error } = await supa
      .from('agent_events')
      .select('status')
      .eq('brand_id', brandId)
      .eq('tool', 'ghl')
      .gte('created_at', sinceISO(24));
    if (error) throw error;
    const rows = data || [];
    if (rows.length < 5) {
      await insertRow({
        metric_name: 'ghl_api_error_rate_24h',
        severity: 'green',
        details: { sample_size: rows.length, note: 'insufficient_sample' },
      });
      return;
    }
    const errs = rows.filter(r => r.status === 'error').length;
    const rate = Math.round((errs / rows.length) * 10000) / 100;
    const severity = classify(rate, { direction: 'lower_is_better', greenMax: 3, yellowMax: 10 });
    await insertRow({
      metric_name: 'ghl_api_error_rate_24h',
      value: rate,
      severity,
      suggested_action: severity === 'red' ? 'INVESTIGATE_GHL_API' : null,
      threshold_hit: severity,
      details: { total: rows.length, errors: errs },
    });
  });

  // ── 9a. llm_429_rate_24h + llm_quota_exhausted_24h ───────────
  // Surfaces LLM provider saturation. When this goes red, the SENT=0
  // downstream signal follows within hours — so flagging it here gives
  // the morning briefing a chance to escalate quota/provider BEFORE the
  // pipeline visibly stalls.
  await runMetric('llm_429_rate_24h', async () => {
    const { data, error } = await supa
      .from('agent_events')
      .select('error_message, event_type, status')
      .eq('brand_id', brandId)
      .gte('created_at', sinceISO(24))
      .in('event_type', ['agent_error', 'QUOTA_EXHAUSTED']);
    if (error) throw error;
    const rows = data || [];
    const is429 = (r) =>
      r.event_type === 'QUOTA_EXHAUSTED' ||
      (r.error_message && (/\b429\b/.test(r.error_message) || /rate[_ ]?limit/i.test(r.error_message)));
    const hits = rows.filter(is429).length;
    const quotaExhaustedEvents = rows.filter(r => r.event_type === 'QUOTA_EXHAUSTED').length;
    const severity = hits === 0
      ? 'green'
      : hits < 20
        ? 'yellow'
        : 'red';
    await insertRow({
      metric_name: 'llm_429_rate_24h',
      value: hits,
      severity,
      suggested_action: severity === 'red' ? 'ESCALATE_LLM_QUOTA' : null,
      threshold_hit: severity,
      details: {
        total_error_events: rows.length,
        rate_limit_hits: hits,
        quota_exhausted_events: quotaExhaustedEvents,
      },
    });
  });

  // ── 10. spanish_only_violation_count_24h ─────────────────────
  await runMetric('spanish_only_violation_count_24h', async () => {
    const { data, error } = await supa
      .from('campaign_enriched_data')
      .select('id, outreach_copy')
      .eq('brand_id', brandId)
      .in('outreach_status', ['SENT', 'CONTACTED', 'RESPONDED'])
      .gte('email_sent_at', sinceISO(24))
      .limit(200);
    if (error) throw error;
    let violations = 0;
    const sample = [];
    for (const row of data || []) {
      if (!row.outreach_copy) continue;
      const r = lintSpanishOnly(row.outreach_copy);
      if (!r.ok) {
        violations++;
        if (sample.length < 5) sample.push({ id: row.id, violations: r.violations });
      }
    }
    const severity = violations === 0 ? 'green' : 'red';
    await insertRow({
      metric_name: 'spanish_only_violation_count_24h',
      value: violations,
      severity,
      suggested_action: violations > 0 ? 'SPANISH_VIOLATION_DETECTED' : null,
      threshold_hit: severity,
      details: { scanned: (data || []).length, sample },
    });
  });

  // ── V1. wa_delivery_failure_rate_14d ─────────────────────────
  // Plan §B.2 + §B.3 (v3 iter-2 A1/A4). WA deliverability lives in
  // campaign_enriched_data.lead_magnets_data JSONB; failures stamp
  // wa_delivery_status='failed'. Exposes in_flight_count in details:
  // rows with wa_message_id but no wa_delivery_status yet.
  await runMetric('wa_delivery_failure_rate_14d', async () => {
    const since = sinceISO(24 * 14);
    const { data: rows, error } = await supa
      .from('campaign_enriched_data')
      .select('lead_magnets_data')
      .eq('brand_id', brandId)
      .not('lead_magnets_data->>wa_message_id', 'is', null)
      .gte('updated_at', since);
    if (error) throw error;
    const total = (rows || []).length;
    if (total === 0) {
      await insertRow({
        metric_name: 'wa_delivery_failure_rate_14d',
        severity: 'green',
        details: { sample_size: 0, note: 'insufficient_sample', denom: 0, in_flight_count: 0 },
      });
      return;
    }
    let withStatus = 0;
    let failed = 0;
    let inFlight = 0;
    for (const row of rows) {
      const md = row.lead_magnets_data || {};
      if (md.wa_delivery_status) {
        withStatus++;
        const st = String(md.wa_delivery_status).toLowerCase();
        if (st.includes('fail') || st.includes('undeliver')) failed++;
      } else if (md.wa_message_id) {
        inFlight++;
      }
    }
    const denom = withStatus;
    const rate = denom > 0 ? (failed / denom) * 100 : 0;
    const pct = Math.round(rate * 100) / 100;
    let severity;
    if (denom < 5) severity = 'green';
    else severity = classify(pct, { direction: 'lower_is_better', greenMax: 10, yellowMax: 40 });
    await insertRow({
      metric_name: 'wa_delivery_failure_rate_14d',
      value: pct,
      severity,
      suggested_action: severity === 'red' ? 'INVESTIGATE_WA_DELIVERABILITY' : null,
      threshold_hit: severity,
      details: {
        denom,
        failed,
        in_flight_count: inFlight,
        total_rows_with_wa_id: total,
        window_days: 14,
        note: denom < 5 ? 'insufficient_sample' : undefined,
      },
    });
  });

  // ── V4. outreach_channel_split_24h ──────────────────────────
  // Plan §B.2 (v3 iter-2 A3). Detects channel paralysis: green
  // requires email_sends>=5 AND wa_sends>=5 AND combined>=10.
  // yellow = combined 3-9 OR (email=0 XOR wa=0). red = combined<3.
  await runMetric('outreach_channel_split_24h', async () => {
    const since24 = sinceISO(24);
    // Email channel: SENT rows with email_sent_at in 24h window.
    const { count: emailCount, error: emailErr } = await supa
      .from('campaign_enriched_data')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('outreach_status', 'SENT')
      .gte('email_sent_at', since24);
    if (emailErr) throw emailErr;

    // WA channel: rows with lead_magnets_data.wa_sent_at inside 24h.
    // JSONB timestamp comparison isn't uniformly supported; fetch the
    // subset with wa_message_id and filter in JS (bounded by 14d so
    // cardinality stays small for the Empírika pilot).
    const { data: waRows, error: waErr } = await supa
      .from('campaign_enriched_data')
      .select('lead_magnets_data')
      .eq('brand_id', brandId)
      .not('lead_magnets_data->>wa_sent_at', 'is', null)
      .gte('updated_at', sinceISO(24 * 14));
    if (waErr) throw waErr;
    const waCount = (waRows || []).filter(r => {
      const ts = r.lead_magnets_data?.wa_sent_at;
      if (!ts) return false;
      return new Date(ts).getTime() >= Date.now() - 24 * 3600_000;
    }).length;

    const email = emailCount ?? 0;
    const wa = waCount;
    const combined = email + wa;
    let severity;
    if (combined < 3) severity = 'red';
    else if (email >= 5 && wa >= 5 && combined >= 10) severity = 'green';
    else severity = 'yellow';

    await insertRow({
      metric_name: 'outreach_channel_split_24h',
      value: combined,
      severity,
      suggested_action: severity === 'red' ? 'INVESTIGATE_WA_CHANNEL_PARALYSIS' : null,
      threshold_hit: severity,
      details: { email_sends: email, wa_sends: wa, combined, min_volume_for_green: 10 },
    });
  });

  // ── 10b. whatsapp_spanish_violation_count_24h ────────────────
  // Plan §B.2 + §B.3 (v3 iter-2 A5). Runs spanishOnlyLinter over
  // lead_magnets_data.wa_last_body (stamped by send_whatsapp_outreach.js
  // at dispatch time). If the stamp isn't present yet, emits a green
  // row with note='awaiting_wa_body_stamp' — never false-positive red.
  await runMetric('whatsapp_spanish_violation_count_24h', async () => {
    const { data: rows, error } = await supa
      .from('campaign_enriched_data')
      .select('id, lead_magnets_data')
      .eq('brand_id', brandId)
      .not('lead_magnets_data->>wa_sent_at', 'is', null)
      .gte('updated_at', sinceISO(24 * 7));
    if (error) throw error;
    const window24 = Date.now() - 24 * 3600_000;
    const recent = (rows || []).filter(r => {
      const ts = r.lead_magnets_data?.wa_sent_at;
      return ts && new Date(ts).getTime() >= window24;
    });
    if (recent.length === 0) {
      await insertRow({
        metric_name: 'whatsapp_spanish_violation_count_24h',
        value: 0,
        severity: 'green',
        details: { scanned: 0, note: 'no_wa_sends_in_window' },
      });
      return;
    }
    let scanned = 0;
    let missingBody = 0;
    let violations = 0;
    const sample = [];
    for (const row of recent) {
      const body = row.lead_magnets_data?.wa_last_body;
      if (!body) { missingBody++; continue; }
      scanned++;
      const r = lintSpanishOnly(body);
      if (!r.ok) {
        violations++;
        if (sample.length < 5) sample.push({ id: row.id, violations: r.violations });
      }
    }
    const severity = violations === 0 ? 'green' : 'red';
    await insertRow({
      metric_name: 'whatsapp_spanish_violation_count_24h',
      value: violations,
      severity,
      suggested_action: violations > 0 ? 'WHATSAPP_SPANISH_VIOLATION' : null,
      threshold_hit: severity,
      details: {
        scanned,
        missing_body_stamp: missingBody,
        total_wa_sends_24h: recent.length,
        sample,
        note: (scanned === 0 && missingBody > 0) ? 'awaiting_wa_body_stamp' : undefined,
      },
    });
  });

  // ── Retention prune (acknowledged rows only, >90d) ──────────
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    await supa
      .from('autonomy_audits')
      .delete()
      .lt('created_at', cutoff)
      .not('acknowledged_at', 'is', null);
  } catch (err) {
    errors.push({ metric: '_retention_prune', err: err?.message });
  }

  return { run_id, metrics_written: written, errors };
}
