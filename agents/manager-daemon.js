// ============================================================
// agents/manager-daemon.js — Loop 24/7 autónomo del Manager
//
// Sprint 1 rewrite:
//   - Four UTC cycles a day (8 / 12 / 18 / 23), fired within a
//     ±90s window. No more 1h setInterval polling.
//   - Scout rotation cursor is persisted in agent_memory.
//   - Every cycle emits a DAEMON_CYCLE event to agent_events
//     for cockpit observability.
//   - Disabled when AUTONOMY_ENABLED !== 'true' (rollback safe).
// ============================================================

import {
  EMPIRIKA_NICHES,
  LATINO_METROS,
  pickNext,
  runRadarCycle,
  runEnrichBacklog,
} from '../workers/autonomy_orchestrator.js';
import {
  saveAgentMemory,
  getAgentMemory,
  getActiveBrands,
} from '../lib/supabase.js';
import { recordAgentEvent } from '../lib/agentEventsSink.js';
import { runConsolidator } from '../workers/learning_consolidator.js';
import { runLightDaily } from '../workers/estratega_light_daily.js';
import { runDeepWeekly } from '../workers/estratega_deep_weekly.js';

// ── Cycle definitions ────────────────────────────────────────
export const CYCLES = Object.freeze([
  { hourUtc: 8,  type: 'RADAR_PRIORITY' },
  { hourUtc: 12, type: 'RADAR_ICP_PUSH' },
  { hourUtc: 18, type: 'ENRICH_BACKLOG' },
  { hourUtc: 23, type: 'REPORTE'        },
  // Sprint 3: Estratega weekly deep cycle — only fires when dayOfWeekUtc matches.
  // Sunday = 0 (Date.getUTCDay()). Gate ESTRATEGA_ENABLED is evaluated at run time.
  { hourUtc: 12, type: 'STRATEGY_DEEP', dayOfWeekUtc: 0 },
]);

const WINDOW_MS = 90_000;          // ±90s window around the exact hour
const TICK_MS   = 60_000;          // minute-level tick so 90s is enough
const FIRED_KEY_PREFIX = '[DAEMON_FIRED] '; // memory key dedupe per day/cycle

// ── Cursor persistence helpers ───────────────────────────────
async function loadCursor(brandId) {
  try {
    const mem = await getAgentMemory('manager', brandId);
    const raw = mem?.['[AUTO_CURSOR]'];
    if (!raw) return { nicheIdx: 0, metroIdx: 0 };
    const parsed = JSON.parse(raw);
    return {
      nicheIdx: Number.isInteger(parsed?.nicheIdx) ? parsed.nicheIdx : 0,
      metroIdx: Number.isInteger(parsed?.metroIdx) ? parsed.metroIdx : 0,
    };
  } catch {
    return { nicheIdx: 0, metroIdx: 0 };
  }
}

async function saveCursor(brandId, cursor) {
  try {
    await saveAgentMemory('manager', brandId, '[AUTO_CURSOR]', JSON.stringify(cursor));
  } catch (err) {
    console.warn('[Daemon] saveCursor failed', err.message);
  }
}

// ── Daily dedupe: one firing per (UTC day, cycle, brand) ─────
function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

const firedInMemory = new Set(); // process-local dedupe
function markFired(brandId, type) {
  firedInMemory.add(`${brandId}::${type}::${todayKey()}`);
}
function alreadyFired(brandId, type) {
  return firedInMemory.has(`${brandId}::${type}::${todayKey()}`);
}

// ── Cycle runners ────────────────────────────────────────────
async function runRadar({ brandId, count = 2 }) {
  const cursor   = await loadCursor(brandId);
  const { pairs, next } = pickNext(cursor, { count });
  const result   = await runRadarCycle({ brandId, pairs, source: 'daemon' });
  await saveCursor(brandId, next);
  return { pairs, result, cursor: next };
}

async function runBacklog({ brandId }) {
  return runEnrichBacklog({ brandId, limit: 20, concurrency: 3 });
}

async function runReport({ brandId }) {
  const ymd = todayKey().replace(/-/g, '');
  const memoryKey = `[DAEMON_REPORT_${ymd}]`;

  // Nightly learning-loop digest (silent no-op when LEARNING_ENABLED!=true).
  let learning = { skipped: 'learning_disabled' };
  if (process.env.LEARNING_ENABLED === 'true') {
    try {
      learning = await runConsolidator({ brandId, windowDays: 7 });
    } catch (err) {
      console.warn('[Daemon] learning consolidator failed:', err?.message);
      learning = { ok: false, error: err?.message };
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    cycles: CYCLES.map(c => c.type),
    note: 'Daily autonomy report — see agent_events for per-cycle status.',
    learning,
  };
  await saveAgentMemory('manager', brandId, memoryKey, JSON.stringify(payload));
  return { ok: true, memory_key: memoryKey, learning };
}

async function executeCycle(brandId, cycle) {
  const startedAt = Date.now();
  let status  = 'ok';
  let metadata = { cycle: cycle.type, brand_id: brandId };
  let errMsg  = null;

  try {
    if (cycle.type === 'RADAR_PRIORITY' || cycle.type === 'RADAR_ICP_PUSH') {
      const out = await runRadar({ brandId });
      metadata.pairs  = out.pairs;
      metadata.cursor = out.cursor;
      metadata.ok     = out.result?.ok !== false;

      // Always follow a RADAR with a bounded backlog sweep.
      const backlog = await runBacklog({ brandId });
      metadata.backlog = {
        processed: backlog?.processed ?? 0,
        succeeded: backlog?.succeeded ?? 0,
        blocked:   backlog?.blocked   ?? null,
      };
    } else if (cycle.type === 'ENRICH_BACKLOG') {
      const backlog = await runBacklog({ brandId });
      metadata.processed = backlog?.processed ?? 0;
      metadata.succeeded = backlog?.succeeded ?? 0;
      metadata.blocked   = backlog?.blocked   ?? null;
    } else if (cycle.type === 'REPORTE') {
      const rep = await runReport({ brandId });
      metadata.memory_key = rep.memory_key;
      // Sprint 3: al cierre del REPORTE, si NO es domingo y el Estratega está
      // habilitado, correr el light-daily del Estratega (7d metrics snapshot).
      const isSundayUtc = new Date().getUTCDay() === 0;
      if (!isSundayUtc && process.env.ESTRATEGA_ENABLED === 'true') {
        try {
          const light = await runLightDaily({ brandId });
          metadata.estratega_light = {
            ok: !!light?.ok,
            skipped: light?.skipped || null,
          };
        } catch (err) {
          metadata.estratega_light = { ok: false, error: err?.message };
        }
      }
    } else if (cycle.type === 'STRATEGY_DEEP') {
      if (process.env.ESTRATEGA_ENABLED !== 'true') {
        metadata.skipped = 'estratega_disabled';
      } else {
        const deep = await runDeepWeekly({ brandId });
        metadata.estratega_deep = {
          ok: !!deep?.ok,
          status: deep?.status || null,
          skipped: deep?.skipped || null,
          ymd: deep?.ymd || null,
        };
        if (deep && deep.ok === false && deep.error) {
          status = 'error';
          errMsg = deep.error;
        }
      }
    } else {
      status = 'error';
      errMsg = `unknown cycle type: ${cycle.type}`;
    }
  } catch (err) {
    status = 'error';
    errMsg = err?.message || String(err);
    console.error(`[Daemon] ${cycle.type} error:`, errMsg);
  }

  recordAgentEvent({
    trace_id:   `daemon-${todayKey()}-${cycle.type}-${brandId}`,
    brand_id:   brandId,
    agent:      'manager',
    event_type: 'DAEMON_CYCLE',
    status,
    duration_ms: Date.now() - startedAt,
    error_message: errMsg,
    metadata,
  });

  markFired(brandId, cycle.type);
}

// ── Tick loop ────────────────────────────────────────────────
function inHourWindow(cycle, now = new Date()) {
  // Fire when we are within ±WINDOW_MS of the top of `hourUtc`.
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    cycle.hourUtc, 0, 0, 0
  ));
  return Math.abs(now.getTime() - target.getTime()) <= WINDOW_MS;
}

async function tick({ brandsProvider } = {}) {
  if (process.env.AUTONOMY_ENABLED !== 'true') return;

  // Default provider: only brands with a brand_quota row (burn protection).
  // A custom provider (tests) can inject any list it wants.
  const provider = brandsProvider || (() => getActiveBrands({ onlyAutonomous: true }));

  let brands;
  try {
    brands = await provider();
  } catch (err) {
    console.warn('[Daemon] getActiveBrands failed:', err.message);
    return;
  }
  if (!Array.isArray(brands) || brands.length === 0) {
    console.warn('[Daemon] AUTONOMY_ENABLED=true but no brand with brand_quota configured — tick no-op');
    return;
  }

  const now = new Date();
  for (const cycle of CYCLES) {
    if (!inHourWindow(cycle, now)) continue;
    // Day-of-week filter (optional per cycle). Sunday=0.
    if (Number.isInteger(cycle.dayOfWeekUtc) && now.getUTCDay() !== cycle.dayOfWeekUtc) continue;

    for (const brand of brands) {
      if (!brand?.id) continue;
      if (alreadyFired(brand.id, cycle.type)) continue;

      // fire-and-await; daemon is meant to be serial per brand
      try {
        await executeCycle(brand.id, cycle);
      } catch (err) {
        console.error('[Daemon] executeCycle threw:', err?.message);
      }
    }
  }
}

let _timer = null;

export function start({ brandsProvider, tickMs = TICK_MS } = {}) {
  if (_timer) return; // idempotent
  if (process.env.AUTONOMY_ENABLED !== 'true') {
    console.log('[Daemon] AUTONOMY_ENABLED!=true — daemon NOT started (rollback-safe)');
    return;
  }

  const validTypes = new Set(CYCLES.map(c => c.type));
  console.log(`[Daemon] starting — cycles: ${[...validTypes].join(', ')} (UTC hours: ${CYCLES.map(c => c.hourUtc).join(',')})`);

  // kick once immediately (no-op if outside any window)
  tick({ brandsProvider }).catch(err => console.warn('[Daemon] initial tick error', err?.message));

  _timer = setInterval(() => {
    tick({ brandsProvider }).catch(err => console.warn('[Daemon] tick error', err?.message));
  }, tickMs);
  if (typeof _timer.unref === 'function') _timer.unref();
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  firedInMemory.clear();
}

// ── Back-compat alias used by index.js (legacy name) ─────────
export function startManagerDaemon() { return start(); }

// ── Internal hooks for tests ─────────────────────────────────
export const _internal = {
  tick,
  executeCycle,
  inHourWindow,
  loadCursor,
  saveCursor,
  firedInMemory,
  EMPIRIKA_NICHES,
  LATINO_METROS,
};
