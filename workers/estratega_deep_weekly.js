// ============================================================
// workers/estratega_deep_weekly.js — Ciclo semanal profundo
//
// Schedule: domingo 12 UTC.
// Gate: process.env.ESTRATEGA_ENABLED === 'true'.
//
// Flujo:
//   1. analyze_fleet_metrics(30d).
//   2. Identificar top 3 bottom_combos; por cada uno investigar
//      Reddit + YouTube.
//   3. Invocar Agente Estratega (LLM) con { metrics, reddit, youtube }
//      y pedir UN SOLO JSON que cumpla el schema.
//   4. Parsear. Si falla → retry 1 vez.
//   5. Validar constitución: si algún check es false → guardar como
//      [STRATEGY_REJECTED] y emitir evento con status='blocked'.
//      Si pasa → guardar como [STRATEGY_PROPOSAL] + puntero
//      [LEARN][fleet][strategy_proposal_latest].
// ============================================================

import { analyzeFleetMetrics } from '../tools/fleetMetrics.js';
import { researchReddit } from '../tools/redditResearch.js';
import { researchYouTube } from '../tools/youtubeResearch.js';
import { saveAgentMemory } from '../lib/supabase.js';
import { recordAgentEvent } from '../lib/agentEventsSink.js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'estratega_deep_weekly' });

function ymdUtc(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Parse the first JSON object block found in raw LLM output.
function parseProposal(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Strip code fences
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '');
  // Greedy but anchored to balanced braces from the first {.
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  // Attempt naive JSON.parse from start to last `}`.
  const end = cleaned.lastIndexOf('}');
  if (end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function constitutionPasses(proposal) {
  const c = proposal?.constitution_check;
  if (!c || typeof c !== 'object') return false;
  return c.spanish_only_ok === true
      && c.latino_owned_ok === true
      && c.verifier_gate_ok === true
      && c.tos_ok === true;
}

// Lazy runtime bootstrap — mismo patrón que pipelineRunner.js.
let _runtimePromise = null;
async function getRuntime() {
  if (_runtimePromise) return _runtimePromise;
  _runtimePromise = (async () => {
    const { AgentRuntime } = await import('../lib/AgentRuntime.js');
    const { estratega }    = await import('../agents/estratega.js');

    const runtime = new AgentRuntime({
      apiKey: process.env.NVIDIA_API_KEY,
      model: 'meta/llama-3.1-70b-instruct',
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
    runtime.registerAgent(estratega);
    return runtime;
  })();
  return _runtimePromise;
}

// Tests can inject a stubbed runtime.
export function __setRuntimeForTest(instance) {
  _runtimePromise = Promise.resolve(instance);
}

/**
 * @param {object} opts
 * @param {string} opts.brandId
 * @param {function} [opts.saveMemoryFn]
 * @param {function} [opts.metricsFn]
 * @param {function} [opts.redditFn]
 * @param {function} [opts.youtubeFn]
 * @param {function} [opts.runAgentFn] — async (prompt) → { response }
 */
export async function runDeepWeekly({
  brandId,
  saveMemoryFn = saveAgentMemory,
  metricsFn    = analyzeFleetMetrics,
  redditFn     = researchReddit,
  youtubeFn    = researchYouTube,
  runAgentFn,
} = {}) {
  if (process.env.ESTRATEGA_ENABLED !== 'true') {
    return { skipped: 'disabled' };
  }
  if (!brandId) {
    return { ok: false, error: 'brandId required' };
  }

  const startedAt = Date.now();
  const ymd = ymdUtc();
  const traceId = `estratega-deep-${ymd}-${brandId}`;

  let status = 'ok';
  let errMsg = null;
  let proposal = null;
  let rejectedReason = null;

  try {
    // 1. Métricas 30d
    const metrics = await metricsFn({ brandId, period: '30d' });

    // 2. Investigar top 3 bottom_combos
    const combos = (metrics?.bottom_combos || []).slice(0, 3);
    const redditFindings = [];
    const youtubeFindings = [];
    for (const c of combos) {
      const niche = c.niche || '';
      const metro = c.metro || '';
      try {
        const rr = await redditFn({ query: `${niche} ${metro} lead generation` });
        redditFindings.push({ niche, metro, ...rr });
      } catch (err) {
        redditFindings.push({ niche, metro, results: [], note: `error:${err?.message}` });
      }
      try {
        const yr = await youtubeFn({ query: `${niche} marketing ${new Date().getFullYear()}` });
        youtubeFindings.push({ niche, metro, ...yr });
      } catch (err) {
        youtubeFindings.push({ niche, metro, results: [], note: `error:${err?.message}` });
      }
    }

    // 3. Invocar Estratega
    const contextPayload = {
      mode: 'deep',
      period_covered: '30d',
      metrics,
      reddit_findings: redditFindings,
      youtube_findings: youtubeFindings,
    };

    const prompt = `CICLO DEEP WEEKLY.

Contexto (JSON adjunto, leelo y usalo como evidencia):
${JSON.stringify(contextPayload).slice(0, 20000)}

INSTRUCCIÓN:
1. Devolvé UN SOLO JSON válido (y nada más) con el schema obligatorio descrito en tu system prompt.
2. Filtrá las tácticas contra la CONSTITUCIÓN antes de incluirlas. Si una táctica viola, moveéla a risk_notes con el prefix "táctica rechazada por constitución:".
3. Completá constitution_check reflejando el estado del output FINAL (post-filtro).
4. brand_id: ${brandId}. ymd: ${ymd}.`;

    const runner = runAgentFn || (async (p) => {
      const runtime = await getRuntime();
      return runtime.run('Estratega', p, {
        currentAgent: 'Estratega',
        maxIterations: 10,
        brandId,
      });
    });

    let raw = null;
    let attempt = 0;
    while (attempt < 2 && !proposal) {
      attempt++;
      const result = await runner(prompt);
      raw = result?.response || '';
      proposal = parseProposal(raw);
      if (!proposal && attempt < 2) {
        log.warn('proposal parse failed, retrying once', { attempt });
      }
    }

    if (!proposal) {
      status = 'error';
      errMsg = 'proposal_parse_failed';
      // Still persist raw for postmortem
      try {
        await saveMemoryFn('estratega', brandId, `[STRATEGY_PARSE_FAIL][${ymd}]`, String(raw || '').slice(0, 8000));
      } catch {}
    } else {
      // 4. Validar constitución
      if (!constitutionPasses(proposal)) {
        status = 'blocked';
        rejectedReason = 'constitution_check_failed';
        const failingKeys = Object.entries(proposal.constitution_check || {})
          .filter(([, v]) => v !== true)
          .map(([k]) => k);
        log.warn('proposal rejected by constitution', { failingKeys });
        try {
          await saveMemoryFn(
            'estratega',
            brandId,
            `[STRATEGY_REJECTED][${ymd}]`,
            JSON.stringify({ proposal, failing_keys: failingKeys }),
          );
        } catch (err) {
          log.warn('saveMemory rejected failed', { error: err?.message });
        }
      } else {
        // 5. Guardar aprobada
        try {
          await saveMemoryFn(
            'estratega',
            brandId,
            `[STRATEGY_PROPOSAL][${ymd}]`,
            JSON.stringify(proposal),
          );
          await saveMemoryFn(
            'estratega',
            brandId,
            `[LEARN][fleet][strategy_proposal_latest]`,
            JSON.stringify({ ymd, generated_at: proposal.generated_at || new Date().toISOString() }),
          );
        } catch (err) {
          log.warn('saveMemory proposal failed', { error: err?.message });
        }
      }
    }

    recordAgentEvent({
      trace_id: traceId,
      brand_id: brandId,
      agent: 'estratega',
      event_type: 'DEEP_WEEKLY',
      status,
      duration_ms: Date.now() - startedAt,
      error_message: errMsg,
      metadata: {
        period: '30d',
        tactics_count: Array.isArray(proposal?.tactics) ? proposal.tactics.length : 0,
        rejected: status === 'blocked',
        rejected_reason: rejectedReason,
        combos_investigated: combos.length,
      },
    });

    return {
      ok: status === 'ok',
      status,
      ymd,
      proposal: status === 'ok' ? proposal : null,
      rejected: status === 'blocked' ? proposal : null,
      error: errMsg,
    };
  } catch (err) {
    status = 'error';
    errMsg = err?.message || String(err);
    log.warn('runDeepWeekly threw', { error: errMsg });
    recordAgentEvent({
      trace_id: traceId,
      brand_id: brandId,
      agent: 'estratega',
      event_type: 'DEEP_WEEKLY',
      status,
      duration_ms: Date.now() - startedAt,
      error_message: errMsg,
      metadata: { period: '30d' },
    });
    return { ok: false, error: errMsg };
  }
}

// Exposed for unit tests.
export const _internal = { parseProposal, constitutionPasses };
