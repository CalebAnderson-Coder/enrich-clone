// ============================================================
// workers/sam_autonomous.js — Sam Autonomous Worker (Phase 5)
//
// Long-lived loop that drives Sam's paid media agent. Handles
// inbound message dispatch, autonomous queue-pressure scan,
// circuit-breaker + pause checks, and graceful shutdown.
//
// Phase 5 closes the Manager→Sam loop: Sam receives outreach_batch_proposal
// messages from Manager, acknowledges them with a planned_send_at, and
// saves state for the future send flow. No real emails are sent here —
// the existing 48h-FU cron handles current batches.
//
// Run modes:
//   node workers/sam_autonomous.js            # production loop
//   node workers/sam_autonomous.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import os from 'os';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AgentMessenger } from '../lib/AgentMessenger.js';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { sam } from '../agents/sam.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '5.0.0';
const AGENT_NAME = 'sam';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.SAM_SLEEP_MS ?? 20_000);
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
 * Returns a result object for ack payload.
 *
 * Supported types: outreach_batch_proposal, outreach_batch_execute, pause
 * Anything else throws → caller nacks the message.
 */
async function processIncomingMessage(msg, messenger, runtime, log) {
  const { type } = msg.payload ?? {};

  // ── Helper: set circuit breaker on rate-limit errors ────────
  async function handleRateLimitError(err) {
    const errMsg = (err.message || '').toLowerCase();
    if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Sam: rate-limit detected, opening circuit breaker', { until });
    }
  }

  // ── outreach_batch_proposal ──────────────────────────────────
  // Phase 5 v1: acknowledge but do NOT fire emails.
  // The 48h-FU cron handles existing batches. This is a placeholder
  // until Sam's real send flow is wired.
  if (type === 'outreach_batch_proposal') {
    const { tier, count } = msg.payload;
    log.info('Sam: handling outreach_batch_proposal', { tier, count, from: msg.from_agent });

    const received_at = new Date().toISOString();
    const planned_send_at = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    // Save to durable state — no LLM call needed
    await messenger.setState('last_batch_proposal', {
      tier,
      count,
      received_at,
      from: msg.from_agent,
    });

    // Acknowledge back to Manager
    try {
      await messenger.send({
        to: 'manager',
        payload: {
          type: 'batch_acknowledged',
          tier,
          count,
          planned_send_at,
          stub: true,                     // Phase 5 v1: Sam ack-only, no real send yet
          real_send_flow: 'phase_6',      // wires actual SMTP/WA/SMS dispatch in Phase 6
        },
      });
      log.info('Sam: batch_acknowledged sent to Manager', { tier, count, planned_send_at });
    } catch (sendErr) {
      log.warn('Sam: failed to send batch_acknowledged to Manager', { err: sendErr.message });
      // Non-fatal — we still ack the inbound message
    }

    return { ok: true, acknowledged: true };
  }

  // ── outreach_batch_execute ───────────────────────────────────
  // LLM-driven campaign design (future flow from Manager).
  if (type === 'outreach_batch_execute') {
    const { tier, count } = msg.payload;
    log.info('Sam: handling outreach_batch_execute via LLM', { tier, count });

    try {
      const result = await runtime.run(
        'Sam',
        `Diseña una secuencia outreach para tier ${tier}, ${count} leads. Devuelve el JSON campaign_strategy.`
      );
      return { ok: true, type: 'outreach_batch_execute', result: result.response?.slice(0, 500) };
    } catch (err) {
      await handleRateLimitError(err);
      throw err;
    }
  }

  // ── pause ────────────────────────────────────────────────────
  if (type === 'pause') {
    const { duration_ms } = msg.payload;
    await messenger.setState('paused_by_owner', true);
    if (duration_ms > 0) {
      setTimeout(async () => {
        await messenger.setState('paused_by_owner', false);
        log.info('Sam: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Sam: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', result: { duration_ms } };
  }

  throw new Error(`unknown_message_type: ${type}`);
}

// ── runAutonomousQueueScan ───────────────────────────────────

/**
 * Proactive scan: count pending messages addressed to Sam.
 * If >5 accumulate, warn and notify Manager about queue pressure.
 * Otherwise no-op.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentMessenger} messenger
 * @param {object} log
 * @returns {{ foundPattern: boolean, detail: any }}
 */
async function runAutonomousQueueScan(supabase, messenger, log) {
  log.info('Sam: running autonomous queue scan');

  const { count, error: countErr } = await supabase
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('to_agent', AGENT_NAME)
    .eq('brand_id', BRAND_ID)
    .eq('status', 'pending');

  if (countErr) {
    log.warn('Sam: queue scan failed', { err: countErr.message });
    return { foundPattern: false, detail: { reason: 'query_error', err: countErr.message } };
  }

  const pendingCount = count ?? 0;

  if (pendingCount > 5) {
    log.warn('Sam: Manager queue backing up', { pendingCount });
    try {
      await messenger.send({
        to: 'manager',
        payload: { type: 'queue_pressure', count: pendingCount },
      });
      log.info('Sam: queue_pressure notification sent to Manager', { pendingCount });
    } catch (sendErr) {
      log.warn('Sam: failed to send queue_pressure to Manager', { err: sendErr.message });
    }
    return { foundPattern: true, detail: { pendingCount } };
  }

  log.info('Sam: queue healthy', { pendingCount });
  return { foundPattern: false, detail: { pendingCount } };
}

// ── Main loop ────────────────────────────────────────────────

async function run() {
  const processId = randomUUID();
  const host = os.hostname();
  const log = logger.child({ agent: AGENT_NAME, processId, version: VERSION });

  log.info('Sam worker starting', { host, selfCheck: SELF_CHECK });

  const supabase = buildSupabase();
  const messenger = new AgentMessenger({ supabase, agentName: AGENT_NAME, processId, brandId: BRAND_ID });

  await messenger.register({
    host,
    metadata: { version: VERSION, role: 'paid_media_strategist' },
  });
  log.info('Sam registered', { processId, host });

  // ── AgentRuntime init (NVIDIA primary, Gemini fallback) ───────
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(sam);

  // ── Orphan reclamation at boot ─────────────────────────────
  try {
    const reclaimed = await messenger.reclaimOrphans();
    log.info('Sam: orphan reclamation complete', reclaimed);
  } catch (reclaimErr) {
    log.warn('Sam: reclaimOrphans failed at boot (continuing)', { err: reclaimErr.message });
  }

  // ── Graceful shutdown ──────────────────────────────────────
  let shutdownRequested = false;
  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info('Sam: graceful shutdown', { signal });
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
    log.debug('Sam: loop tick', { iteration: iterations });

    try {
      // Heartbeat every iteration
      await messenger.heartbeat();

      // Drain inbound queue
      const msgs = await messenger.recv({ limit: 5 });

      let processedCount = 0;
      for (const msg of msgs) {
        try {
          const result = await processIncomingMessage(msg, messenger, runtime, log);
          await messenger.ack(msg.id, { result });
          processedCount++;
        } catch (err) {
          log.error('Sam: message processing failed', { msgId: msg.id, err: err.message });
          try { await messenger.nack(msg.id, err.message); } catch (ne) { log.warn('nack failed', ne); }
        }
      }

      if (processedCount > 0) {
        log.info('Sam: processed inbound messages', { count: processedCount });
      }

      // Autonomous queue scan
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          const result = await runAutonomousQueueScan(supabase, messenger, log);
          if (result?.foundPattern) {
            log.info('Sam: queue pressure detected', { detail: result.detail });
          }
          await messenger.setState('last_run_at', new Date().toISOString());
        } catch (err) {
          log.error('Sam: autonomous queue scan failed', err);
        }
      } else if (msgs.length === 0) {
        log.debug('Sam: skipped autonomous cycle', {
          reason: msgs.length > 0 ? 'had_inbound' : 'cooldown_or_paused',
        });
      }

      // Successful iteration — reset backoff counter
      consecutiveFailures = 0;
    } catch (loopErr) {
      consecutiveFailures++;
      const backoffMs = Math.min(60_000, SLEEP_MS * 2 ** consecutiveFailures);
      log.error('Sam: loop iteration failed, backing off', {
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

  log.info('Sam: exiting loop', { iterations });
  await shutdown('loop_end');
}

// ── Entry point ──────────────────────────────────────────────

run().catch((err) => {
  logger.error('Sam worker fatal error', err);
  process.exit(1);
});
