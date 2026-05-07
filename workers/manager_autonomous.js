// ============================================================
// workers/manager_autonomous.js — Manager Autonomous Worker (Phase 3)
//
// Long-lived loop that drives the Manager orchestrator agent.
// Handles inbound message dispatch, autonomous coordination cycle,
// circuit-breaker + pause checks, and graceful shutdown.
//
// Phase 3 closes the inter-agent loop: Manager processes Helena's
// queued seo_audit_proposal + pattern_detected messages and proactively
// scans the lead pipeline to coordinate with Sam.
//
// Run modes:
//   node workers/manager_autonomous.js            # production loop
//   node workers/manager_autonomous.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import os from 'os';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AgentMessenger } from '../lib/AgentMessenger.js';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { manager } from '../agents/manager.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '3.0.0';
const AGENT_NAME = 'manager';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.MANAGER_SLEEP_MS ?? 20_000);
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
 * Supported types: seo_audit_proposal, pattern_detected, delegate_request, pause
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
      log.warn('Manager: rate-limit detected, opening circuit breaker', { until });
    }
  }

  // ── seo_audit_proposal ──────────────────────────────────────
  if (type === 'seo_audit_proposal') {
    const { brand_id, name, days_since_audit } = msg.payload;
    log.info('Manager: handling seo_audit_proposal', { brand_id, name, days_since_audit });

    // Phase 3 v1 approval logic: ALWAYS approve if days_since_audit === null OR >= 7
    const shouldApprove = days_since_audit === null || days_since_audit >= 7;

    if (!shouldApprove) {
      log.info('Manager: seo_audit_proposal rejected — audit is recent', { brand_id, days_since_audit });
      return { ok: true, decision: 'rejected', reason: 'recent_audit', days_since_audit };
    }

    // Derive website from brand profile — query brands table directly
    let websiteUrl = null;
    try {
      const supabase = buildSupabase();
      const { data: brand, error: brandErr } = await supabase
        .from('brands')
        .select('website')
        .eq('id', brand_id)
        .maybeSingle();
      if (!brandErr && brand?.website) {
        websiteUrl = brand.website;
      }
    } catch (lookupErr) {
      log.warn('Manager: failed to look up brand website, using placeholder', { err: lookupErr.message });
    }
    websiteUrl = websiteUrl ?? `https://placeholder-${brand_id}.com`;

    // Approve: send seo_audit back to Helena
    try {
      await messenger.send({
        to: 'helena',
        payload: {
          type: 'seo_audit',
          brand_id,
          website_url: websiteUrl,
          depth: 'quick',
        },
      });
      log.info('Manager: seo_audit dispatched to Helena', { brand_id, websiteUrl });
    } catch (sendErr) {
      log.warn('Manager: failed to send seo_audit to Helena', { err: sendErr.message });
      throw sendErr;
    }

    return { ok: true, decision: 'approved', queued_to: 'helena', website_url: websiteUrl };
  }

  // ── pattern_detected ────────────────────────────────────────
  if (type === 'pattern_detected') {
    const fromAgent = msg.from_agent ?? 'unknown';
    log.info('Manager: handling pattern_detected', { from: fromAgent, detail: msg.payload.detail });

    // Save to durable state — no LLM call
    const stateKey = `last_pattern_${fromAgent}`;
    await messenger.setState(stateKey, {
      payload: msg.payload,
      received_at: new Date().toISOString(),
    });

    log.info('Manager: pattern_detected recorded', { stateKey });
    return { ok: true, recorded: true };
  }

  // ── delegate_request ────────────────────────────────────────
  if (type === 'delegate_request') {
    const { payload } = msg;
    log.info('Manager: handling delegate_request via LLM', { payload });

    try {
      const result = await runtime.run(
        'Manager',
        'Un agente está pidiendo delegación: ' + JSON.stringify(payload) + '. ¿A quién deberíamos delegar y por qué?'
      );
      return { ok: true, type: 'delegate_request', result: result.response?.slice(0, 500) };
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
        log.info('Manager: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Manager: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', result: { duration_ms } };
  }

  throw new Error(`unknown_message_type: ${type}`);
}

// ── runAutonomousCoordinationCycle ───────────────────────────

/**
 * Proactive coordination: scan the lead pipeline and delegate work
 * to Sam if there are pending HOT or WARM leads.
 *
 * Gracefully degrades if the leads table is missing or query errors.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentMessenger} messenger
 * @param {object} log
 * @returns {{ foundPattern: boolean, detail: any }}
 */
async function runAutonomousCoordinationCycle(supabase, messenger, log) {
  log.info('Manager: running autonomous coordination cycle');

  // Query pending leads by tier for this brand
  const { data: rows, error: queryErr } = await supabase
    .from('leads')
    .select('lead_tier')
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'PENDING');

  if (queryErr) {
    log.warn('Manager: leads query failed in coordination cycle', { err: queryErr.message });
    return { foundPattern: false, detail: { reason: 'query_error', err: queryErr.message } };
  }

  if (!rows || rows.length === 0) {
    log.info('Manager: no pending leads — nothing to coordinate');
    await messenger.setState('last_coordination_scan_at', new Date().toISOString());
    return { foundPattern: false, detail: { reason: 'no_pending_leads' } };
  }

  // Tally by tier
  const counts = { HOT: 0, WARM: 0 };
  for (const row of rows) {
    const tier = row.lead_tier;
    if (tier === 'HOT') counts.HOT++;
    else if (tier === 'WARM') counts.WARM++;
  }

  log.info('Manager: pending lead counts', counts);

  let foundPattern = false;

  if (counts.HOT > 0) {
    try {
      await messenger.send({
        to: 'sam',
        payload: { type: 'outreach_batch_proposal', tier: 'HOT', count: counts.HOT },
      });
      log.info('Manager: outreach_batch_proposal (HOT) queued to Sam', { count: counts.HOT });
      foundPattern = true;
    } catch (sendErr) {
      log.warn('Manager: failed to send HOT proposal to Sam', { err: sendErr.message });
    }
  }

  if (counts.WARM > 5) {
    try {
      await messenger.send({
        to: 'sam',
        payload: { type: 'outreach_batch_proposal', tier: 'WARM', count: counts.WARM },
      });
      log.info('Manager: outreach_batch_proposal (WARM) queued to Sam', { count: counts.WARM });
      foundPattern = true;
    } catch (sendErr) {
      log.warn('Manager: failed to send WARM proposal to Sam', { err: sendErr.message });
    }
  }

  await messenger.setState('last_coordination_scan_at', new Date().toISOString());

  return {
    foundPattern,
    detail: { hot: counts.HOT, warm: counts.WARM },
  };
}

// ── Main loop ────────────────────────────────────────────────

async function run() {
  const processId = randomUUID();
  const host = os.hostname();
  const log = logger.child({ agent: AGENT_NAME, processId, version: VERSION });

  log.info('Manager worker starting', { host, selfCheck: SELF_CHECK });

  const supabase = buildSupabase();
  const messenger = new AgentMessenger({ supabase, agentName: AGENT_NAME, processId, brandId: BRAND_ID });

  await messenger.register({
    host,
    metadata: { version: VERSION, role: 'orchestrator' },
  });
  log.info('Manager registered', { processId, host });

  // ── AgentRuntime init (NVIDIA primary, Gemini fallback) ───────
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(manager);

  // ── Orphan reclamation at boot ─────────────────────────────
  try {
    const reclaimed = await messenger.reclaimOrphans();
    log.info('Manager: orphan reclamation complete', reclaimed);
  } catch (reclaimErr) {
    log.warn('Manager: reclaimOrphans failed at boot (continuing)', { err: reclaimErr.message });
  }

  // ── Graceful shutdown ──────────────────────────────────────
  let shutdownRequested = false;
  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info('Manager: graceful shutdown', { signal });
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
    log.debug('Manager: loop tick', { iteration: iterations });

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
          log.error('Manager: message processing failed', { msgId: msg.id, err: err.message });
          try { await messenger.nack(msg.id, err.message); } catch (ne) { log.warn('nack failed', ne); }
        }
      }

      if (processedCount > 0) {
        log.info('Manager: processed inbound messages', { count: processedCount });
      }

      // Autonomous coordination cycle
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          const result = await runAutonomousCoordinationCycle(supabase, messenger, log);
          if (result?.foundPattern) {
            log.info('Manager: coordination pattern found', { detail: result.detail });
          }
          await messenger.setState('last_run_at', new Date().toISOString());
        } catch (err) {
          log.error('Manager: autonomous coordination cycle failed', err);
        }
      } else if (msgs.length === 0) {
        log.debug('Manager: skipped autonomous cycle', {
          reason: msgs.length > 0 ? 'had_inbound' : 'cooldown_or_paused',
        });
      }

      // Successful iteration — reset backoff counter
      consecutiveFailures = 0;
    } catch (loopErr) {
      consecutiveFailures++;
      const backoffMs = Math.min(60_000, SLEEP_MS * 2 ** consecutiveFailures);
      log.error('Manager: loop iteration failed, backing off', {
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

  log.info('Manager: exiting loop', { iterations });
  await shutdown('loop_end');
}

// ── Entry point ──────────────────────────────────────────────

run().catch((err) => {
  logger.error('Manager worker fatal error', err);
  process.exit(1);
});
