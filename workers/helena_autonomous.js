// ============================================================
// workers/helena_autonomous.js — Helena Autonomous Worker (Phase 1)
//
// Long-lived loop that drives Helena's audit agent. Handles
// inbound message dispatch, autonomous cycle scheduling, circuit-
// breaker + pause checks, and graceful shutdown.
//
// Phase 1 is a SCAFFOLD — runAutonomousAuditCycle() is stubbed.
// Real audit logic (agents/helena.js) is wired in Phase 2.
//
// Run modes:
//   node workers/helena_autonomous.js            # production loop
//   node workers/helena_autonomous.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import os from 'os';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AgentMessenger } from '../lib/AgentMessenger.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '1.0.0-scaffold';
const AGENT_NAME = 'helena';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.HELENA_SLEEP_MS ?? 20_000);
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const SELF_CHECK = process.argv.includes('--self-check');

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── shouldRunAutonomously ────────────────────────────────────

/**
 * Returns true only if ALL guards pass:
 *   1. Cooldown elapsed (last_run_at > 5 min ago)
 *   2. Gemini circuit breaker not open
 *   3. paused_by_owner flag is not true
 *   4. No inbound messages were processed this iteration
 */
async function shouldRunAutonomously(messenger, inboundCount) {
  if (inboundCount > 0) return false;

  const paused = await messenger.getState('paused_by_owner');
  if (paused === true) return false;

  const circuitUntil = await messenger.getState('gemini_circuit_open_until');
  if (circuitUntil && new Date(circuitUntil) > new Date()) return false;

  const lastRunAt = await messenger.getState('last_run_at');
  if (lastRunAt && Date.now() - new Date(lastRunAt).getTime() < COOLDOWN_MS) return false;

  return true;
}

// ── processIncomingMessage ───────────────────────────────────

/**
 * Dispatches a single inbound message to the appropriate handler.
 * Returns a result summary string for ack payload.
 */
async function processIncomingMessage(msg, messenger, log) {
  const { type } = msg.payload ?? {};

  if (type === 'audit_lead') {
    const { lead_id } = msg.payload;
    // Phase 2 will call helena audit here
    log.info('Helena: audit_lead stub (Phase 2 wires real logic)', { lead_id });
    return { status: 'stub', lead_id };
  }

  if (type === 'pause') {
    const { duration_ms } = msg.payload;
    await messenger.setState('paused_by_owner', true);
    if (duration_ms > 0) {
      setTimeout(async () => {
        await messenger.setState('paused_by_owner', false);
        log.info('Helena: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Helena: paused by owner', { duration_ms });
    return { status: 'paused', duration_ms };
  }

  throw new Error(`unknown message type: ${type}`);
}

// ── runAutonomousAuditCycle ──────────────────────────────────

/**
 * STUB — Phase 2 wires agents/helena.js here.
 * @returns {{ foundPattern: boolean, detail: any }}
 */
async function runAutonomousAuditCycle(log) {
  log.info('Helena: running autonomous audit cycle');
  return { foundPattern: false, detail: null };
}

// ── Main loop ────────────────────────────────────────────────

async function run() {
  const processId = randomUUID();
  const host = os.hostname();
  const log = logger.child({ agent: AGENT_NAME, processId, version: VERSION });

  log.info('Helena worker starting', { host, selfCheck: SELF_CHECK });

  const supabase = buildSupabase();
  const messenger = new AgentMessenger({ supabase, agentName: AGENT_NAME, processId, brandId: BRAND_ID });

  await messenger.register({ host });
  log.info('Helena registered', { processId, host });

  // ── Orphan reclamation at boot ─────────────────────────────
  try {
    const reclaimed = await messenger.reclaimOrphans();
    log.info('Helena: orphan reclamation complete', reclaimed);
  } catch (reclaimErr) {
    log.warn('Helena: reclaimOrphans failed at boot (continuing)', { err: reclaimErr.message });
  }

  // ── Graceful shutdown ──────────────────────────────────────
  let shutdownRequested = false;
  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info('Helena: graceful shutdown', { signal });
    try { await messenger.deregister(); } catch (e) { log.warn('deregister failed', e); }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // ── Loop ───────────────────────────────────────────────────
  let iterations = 0;
  let consecutiveFailures = 0;
  do {
    iterations++;
    log.debug('Helena: loop tick', { iteration: iterations });

    try {
      // Heartbeat every iteration
      await messenger.heartbeat();

      // Drain inbound queue
      const msgs = await messenger.recv({ limit: 5 });

      let processedCount = 0;
      for (const msg of msgs) {
        try {
          const result = await processIncomingMessage(msg, messenger, log);
          await messenger.ack(msg.id, { result });
          processedCount++;
        } catch (err) {
          log.error('Helena: message processing failed', { msgId: msg.id, err: err.message });
          try { await messenger.nack(msg.id, err.message); } catch (ne) { log.warn('nack failed', ne); }
        }
      }

      if (processedCount > 0) {
        log.info('Helena: processed inbound messages', { count: processedCount });
      }

      // Autonomous cycle
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          const result = await runAutonomousAuditCycle(log);
          if (result?.foundPattern) {
            await messenger.send({ to: 'manager', payload: { type: 'pattern_detected', detail: result.detail } });
            log.info('Helena: pattern detected, notified manager', { detail: result.detail });
          }
          await messenger.setState('last_run_at', new Date().toISOString());
        } catch (err) {
          log.error('Helena: autonomous cycle failed', err);
        }
      } else if (msgs.length === 0) {
        log.debug('Helena: skipped autonomous cycle', {
          reason: msgs.length > 0 ? 'had_inbound' : 'cooldown_or_paused',
        });
      }

      // Successful iteration — reset backoff counter
      consecutiveFailures = 0;
    } catch (loopErr) {
      consecutiveFailures++;
      const backoffMs = Math.min(60_000, SLEEP_MS * 2 ** consecutiveFailures);
      log.error('Helena: loop iteration failed, backing off', {
        err: loopErr.message,
        consecutiveFailures,
        backoffMs,
      });

      if (SELF_CHECK) break;
      await sleep(backoffMs);
      continue;
    }

    if (SELF_CHECK) break; // --self-check exits after 1 iteration

    await sleep(SLEEP_MS);
  } while (!shutdownRequested);

  log.info('Helena: exiting loop', { iterations });
  await shutdown('loop_end');
}

// ── Entry point ──────────────────────────────────────────────

run().catch((err) => {
  logger.error('Helena worker fatal error', err);
  process.exit(1);
});
