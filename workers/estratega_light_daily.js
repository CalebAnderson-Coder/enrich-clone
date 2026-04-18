// ============================================================
// workers/estratega_light_daily.js — Ciclo diario del Estratega
//
// Schedule: lun-sáb 23 UTC (domingo corre el deep-weekly en su lugar).
// Gate: process.env.ESTRATEGA_ENABLED === 'true'. Si off → skipped.
//
// Flujo: analyze_fleet_metrics({period: '7d'}) → saveMemory
//        [METRICS_DAILY_YYYYMMDD] → recordAgentEvent LIGHT_DAILY.
//
// NO invoca al LLM. Es SQL puro + memoria. El objetivo es construir
// una serie temporal que el deep-weekly pueda consultar.
// ============================================================

import { analyzeFleetMetrics } from '../tools/fleetMetrics.js';
import { saveAgentMemory } from '../lib/supabase.js';
import { recordAgentEvent } from '../lib/agentEventsSink.js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'estratega_light_daily' });

function ymdUtc(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * @param {object} opts
 * @param {string} opts.brandId
 * @param {function} [opts.saveMemoryFn] — inyectable para tests
 * @param {function} [opts.metricsFn]    — inyectable para tests
 */
export async function runLightDaily({
  brandId,
  saveMemoryFn = saveAgentMemory,
  metricsFn = analyzeFleetMetrics,
} = {}) {
  if (process.env.ESTRATEGA_ENABLED !== 'true') {
    return { skipped: 'disabled' };
  }
  if (!brandId) {
    return { ok: false, error: 'brandId required' };
  }

  const startedAt = Date.now();
  let status = 'ok';
  let errMsg = null;
  let metrics = null;

  try {
    metrics = await metricsFn({ brandId, period: '7d' });
    const ymd = ymdUtc();
    await saveMemoryFn('estratega', brandId, `[METRICS_DAILY_${ymd}]`, JSON.stringify(metrics));
  } catch (err) {
    status = 'error';
    errMsg = err?.message || String(err);
    log.warn('estratega light daily failed', { error: errMsg });
  }

  recordAgentEvent({
    trace_id: `estratega-light-${ymdUtc()}-${brandId}`,
    brand_id: brandId,
    agent: 'estratega',
    event_type: 'LIGHT_DAILY',
    status,
    duration_ms: Date.now() - startedAt,
    error_message: errMsg,
    metadata: {
      period: '7d',
      low_confidence: metrics?.low_confidence ?? null,
      sent: metrics?.funnel?.sent ?? 0,
      replied: metrics?.funnel?.replied ?? 0,
    },
  });

  return {
    ok: status === 'ok',
    ymd: ymdUtc(),
    metrics,
    error: errMsg,
  };
}
