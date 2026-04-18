// ============================================================
// lib/agentEventsSink.js — Fire-and-forget event sink for agent_events
//
// Contract:
//   recordAgentEvent(event)   → void (never throws)
//   recordBatch(events[])     → void (never throws)
//
// Behaviour:
//   - Writes are queued and flushed in micro-batches (every ~500ms
//     or when the buffer hits FLUSH_THRESHOLD rows) so a single
//     agent run doesn't generate N round-trips.
//   - All failures are swallowed + warn-logged. The runtime loop
//     must NEVER be blocked or crashed by the observability path.
//   - When supabase isn't configured (local/mock mode), events
//     are silently dropped after a single warn on first attempt.
// ============================================================

import { supabase } from './supabase.js';
import { logger as rootLogger } from './logger.js';

const FLUSH_INTERVAL_MS = 500;
const FLUSH_THRESHOLD   = 25;
const MAX_BUFFER        = 500;   // hard cap to avoid unbounded memory

const log = rootLogger.child({ module: 'agentEventsSink' });

let buffer = [];
let flushTimer = null;
let warnedNoSupabase = false;

// Allowed event_type values (matches migration + cockpit consumers).
const ALLOWED_EVENT_TYPES = new Set([
  'run_started',
  'run_completed',
  'tool_call',
  'tool_result',
  'zod_error',
  'delegation',
  'agent_error',
  // Sprint-1 autonomy observability
  'DAEMON_CYCLE',
  'AUTO_APPROVED',
  // Sprint-4 lead magnet observability
  'LEAD_MAGNET_NO_NICHE',
]);

function normalize(event) {
  if (!event || typeof event !== 'object') return null;

  const { trace_id, agent, event_type } = event;
  if (!trace_id || !agent || !event_type) return null;
  if (!ALLOWED_EVENT_TYPES.has(event_type))  return null;

  // Coerce / whitelist columns — JSONB catches the rest.
  return {
    trace_id:      String(trace_id),
    brand_id:      event.brand_id || null,
    agent:         String(agent),
    event_type:    String(event_type),
    tool:          event.tool || null,
    status:        event.status || null,
    duration_ms:   Number.isFinite(event.duration_ms) ? Math.round(event.duration_ms) : null,
    tokens_in:     Number.isFinite(event.tokens_in)   ? Math.round(event.tokens_in)   : null,
    tokens_out:    Number.isFinite(event.tokens_out)  ? Math.round(event.tokens_out)  : null,
    error_message: event.error_message ? String(event.error_message).slice(0, 4000) : null,
    metadata:      event.metadata && typeof event.metadata === 'object' ? event.metadata : null,
  };
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the event loop alive just for flushes.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

async function flush() {
  if (buffer.length === 0) return;
  if (!supabase) {
    if (!warnedNoSupabase) {
      log.warn('supabase client unavailable — dropping agent events', { dropped: buffer.length });
      warnedNoSupabase = true;
    }
    buffer = [];
    return;
  }

  const toWrite = buffer;
  buffer = [];

  try {
    const { error } = await supabase.from('agent_events').insert(toWrite);
    if (error) {
      log.warn('agent_events insert failed', { error: error.message, count: toWrite.length });
    }
  } catch (err) {
    log.warn('agent_events insert threw', { error: err?.message, count: toWrite.length });
  }
}

/**
 * Queue a single agent event for async persistence.
 * Safe to call from hot paths — returns immediately, never throws.
 */
export function recordAgentEvent(event) {
  try {
    const row = normalize(event);
    if (!row) return;

    if (buffer.length >= MAX_BUFFER) {
      // Drop oldest to protect memory under extreme bursts.
      buffer.shift();
    }
    buffer.push(row);

    if (buffer.length >= FLUSH_THRESHOLD) {
      void flush();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    // Absolute last-resort guard.
    try { log.warn('recordAgentEvent error (swallowed)', { error: err?.message }); } catch {}
  }
}

/**
 * Queue multiple events at once.
 */
export function recordBatch(events) {
  if (!Array.isArray(events)) return;
  for (const ev of events) recordAgentEvent(ev);
}

/**
 * Force a flush (used by tests + graceful shutdown).
 * Returns the underlying promise for the in-flight insert.
 */
export async function flushAgentEvents() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flush();
}

/**
 * Internal: expose buffer size for tests.
 */
export function _bufferSize() { return buffer.length; }
