// ============================================================
// workers/sam_autonomous.js — Sam Autonomous Worker (Phase 6.1)
//
// Long-lived loop that drives Sam's paid media agent. Handles
// inbound message dispatch, autonomous pipeline scan,
// circuit-breaker + pause checks, and graceful shutdown.
//
// Phase 6.1: Sam now does real work — LLM-driven paid ads strategy
// via outreach_batch_proposal and paid_ads_request handlers.
// Email outreach is handled by the FU48h cron; Sam complements it
// with Google + Meta retargeting campaigns.
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

const VERSION = '6.1.0';
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
 * Supported types: outreach_batch_proposal, paid_ads_request, outreach_batch_execute, pause
 * Anything else throws → caller nacks the message.
 */
async function processIncomingMessage(msg, messenger, runtime, log, supabase) {
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
  // Phase 6.1: LLM-driven paid ads strategy that COMPLEMENTS email outreach.
  // Email FU48h cron handles existing send batches; Sam designs retargeting
  // campaigns (Google + Meta) to accelerate HOT lead conversion.
  if (type === 'outreach_batch_proposal') {
    const { tier, count } = msg.payload;
    log.info('Sam: handling outreach_batch_proposal — designing paid ads strategy', {
      tier,
      count,
      from: msg.from_agent,
    });

    try {
      // Pull brand profile for industry context
      const { data: brandRows, error: brandErr } = await supabase
        .from('brands')
        .select('name, industry, brand_profile')
        .eq('id', BRAND_ID)
        .limit(1);

      if (brandErr) {
        log.warn('Sam: failed to fetch brand profile, using defaults', { err: brandErr.message });
      }

      const brand = brandRows?.[0] ?? { name: 'Empírika client', industry: 'service business', brand_profile: null };

      const prompt =
        `Tenemos ${count} leads HOT de la industria ${brand.industry} esperando follow-up. ` +
        `Email outreach ya está corriendo (FU48h cron). ` +
        `Diseña una campaña paid-ads (Google + Meta) de retargeting que COMPLEMENTE este outreach. ` +
        `Presupuesto $500-1500/mo. ` +
        `Devuelve JSON: { campaign_name, channels: [{platform, budget_monthly, ad_copy_es, audience}], ` +
        `total_budget_monthly, est_cpa, est_leads_per_month, rationale }. ` +
        `Idioma español, ROI-focused.`;

      const result = await runtime.run('Sam', prompt, { brand_id: BRAND_ID });

      // Persist strategy to agent_state
      await messenger.setState(`paid_ads_strategy:${BRAND_ID}`, {
        tier,
        count,
        strategy: result.response,
        planned_at: new Date().toISOString(),
      });

      // Notify Manager that strategy is ready
      try {
        await messenger.send({
          to: 'manager',
          payload: {
            type: 'paid_ads_strategy_ready',
            brand_id: BRAND_ID,
            tier,
            count,
            strategy_preview: (result.response || '').slice(0, 600),
            full_strategy_state_key: `paid_ads_strategy:${BRAND_ID}`,
          },
        });
        log.info('Sam: paid_ads_strategy_ready sent to Manager', { tier, count });
      } catch (sendErr) {
        log.warn('Sam: failed to send paid_ads_strategy_ready to Manager', { err: sendErr.message });
        // Non-fatal — strategy is persisted; Manager can poll state
      }

      return {
        ok: true,
        type: 'outreach_batch_proposal',
        brand_id: BRAND_ID,
        persisted: true,
        strategy_preview: (result.response || '').slice(0, 400),
      };
    } catch (err) {
      await handleRateLimitError(err);
      throw err;
    }
  }

  // ── paid_ads_request ─────────────────────────────────────────
  // Explicit paid ads request from Manager with channel/budget hints.
  // Payload: { brand_id, channel ('google'|'meta'|'both'), budget_monthly, focus ('lead_gen'|'awareness'|'retargeting') }
  if (type === 'paid_ads_request') {
    const {
      brand_id = BRAND_ID,
      channel = 'both',
      budget_monthly = 1000,
      focus = 'retargeting',
    } = msg.payload;
    log.info('Sam: handling paid_ads_request', { brand_id, channel, budget_monthly, focus });

    try {
      // Pull brand profile
      const { data: brandRows, error: brandErr } = await supabase
        .from('brands')
        .select('name, industry, brand_profile')
        .eq('id', brand_id)
        .limit(1);

      if (brandErr) {
        log.warn('Sam: failed to fetch brand profile for paid_ads_request', { err: brandErr.message });
      }

      const brand = brandRows?.[0] ?? { name: 'Empírika client', industry: 'service business', brand_profile: null };

      const channelLabel = channel === 'both' ? 'Google + Meta' : channel === 'google' ? 'Google Ads' : 'Meta Ads';
      const prompt =
        `Diseña una campaña de paid ads en ${channelLabel} con enfoque en ${focus}. ` +
        `Industria: ${brand.industry}. Presupuesto mensual: $${budget_monthly}. ` +
        `Devuelve JSON: { campaign_name, channels: [{platform, budget_monthly, ad_copy_es, audience}], ` +
        `total_budget_monthly, est_cpa, est_leads_per_month, rationale }. ` +
        `Idioma español, ROI-focused.`;

      const result = await runtime.run('Sam', prompt, { brand_id });

      await messenger.setState(`paid_ads_strategy:${brand_id}`, {
        channel,
        budget_monthly,
        focus,
        strategy: result.response,
        planned_at: new Date().toISOString(),
      });

      try {
        await messenger.send({
          to: 'manager',
          payload: {
            type: 'paid_ads_strategy_ready',
            brand_id,
            channel,
            budget_monthly,
            focus,
            strategy_preview: (result.response || '').slice(0, 600),
            full_strategy_state_key: `paid_ads_strategy:${brand_id}`,
          },
        });
        log.info('Sam: paid_ads_strategy_ready sent (paid_ads_request)', { brand_id });
      } catch (sendErr) {
        log.warn('Sam: failed to send paid_ads_strategy_ready (paid_ads_request)', { err: sendErr.message });
      }

      return {
        ok: true,
        type: 'paid_ads_request',
        brand_id,
        persisted: true,
        strategy_preview: (result.response || '').slice(0, 400),
      };
    } catch (err) {
      await handleRateLimitError(err);
      throw err;
    }
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

// ── runAutonomousCycle ───────────────────────────────────────

/**
 * Proactive scan: inspect pipeline lead tiers and propose budget actions,
 * plus the existing queue-pressure check.
 *
 * Pipeline rules:
 *   - HOT > 50 → pipeline saturated → propose budget increase (retargeting can convert faster)
 *   - HOT < 10 → pipeline starved  → suggest pausing paid spend (email FU sufficient for now)
 *   - 10 ≤ HOT ≤ 50 → healthy, no action
 *
 * Queue pressure: if Sam's own pending queue > 5, notify Manager.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentMessenger} messenger
 * @param {object} log
 * @returns {{ foundPattern: boolean, detail: any }}
 */
async function runAutonomousCycle(supabase, messenger, log) {
  log.info('Sam: running autonomous cycle');

  // ── Pipeline tier scan ───────────────────────────────────────
  const { data: tierRows, error: tierErr } = await supabase
    .from('leads')
    .select('lead_tier')
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'SENT');

  let hot_count = 0;
  let warm_count = 0;

  if (tierErr) {
    log.warn('Sam: pipeline tier scan failed', { err: tierErr.message });
  } else if (tierRows) {
    for (const row of tierRows) {
      if (row.lead_tier === 'HOT') hot_count++;
      else if (row.lead_tier === 'WARM') warm_count++;
    }
  }

  await messenger.setState('last_pipeline_scan', {
    hot_count,
    warm_count,
    scanned_at: new Date().toISOString(),
  });

  log.info('Sam: pipeline scan complete', { hot_count, warm_count });

  if (hot_count > 50) {
    log.info('Sam: pipeline saturated — proposing budget increase', { hot_count });
    try {
      await messenger.send({
        to: 'manager',
        payload: {
          type: 'budget_increase_proposed',
          tier: 'HOT',
          count: hot_count,
          rationale: 'pipeline saturated, paid retargeting can convert faster than email-only follow-up',
        },
      });
      log.info('Sam: budget_increase_proposed sent to Manager', { hot_count });
    } catch (sendErr) {
      log.warn('Sam: failed to send budget_increase_proposed', { err: sendErr.message });
    }
    return { foundPattern: true, detail: { hot_count, warm_count, action: 'budget_increase_proposed' } };
  }

  if (hot_count < 10) {
    log.info('Sam: pipeline thin — suggesting budget pause', { hot_count });
    try {
      await messenger.send({
        to: 'manager',
        payload: {
          type: 'budget_pause_suggested',
          count: hot_count,
          rationale: 'pipeline thin, email FU should suffice for now',
        },
      });
      log.info('Sam: budget_pause_suggested sent to Manager', { hot_count });
    } catch (sendErr) {
      log.warn('Sam: failed to send budget_pause_suggested', { err: sendErr.message });
    }
    return { foundPattern: true, detail: { hot_count, warm_count, action: 'budget_pause_suggested' } };
  }

  // ── Queue-pressure check (existing guard) ────────────────────
  const { count: pendingCount, error: countErr } = await supabase
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('to_agent', AGENT_NAME)
    .eq('brand_id', BRAND_ID)
    .eq('status', 'pending');

  if (countErr) {
    log.warn('Sam: queue pressure scan failed', { err: countErr.message });
    return { foundPattern: false, detail: { hot_count, warm_count, reason: 'queue_count_error' } };
  }

  const queueDepth = pendingCount ?? 0;

  if (queueDepth > 5) {
    log.warn('Sam: message queue backing up', { queueDepth });
    try {
      await messenger.send({
        to: 'manager',
        payload: { type: 'queue_pressure', count: queueDepth },
      });
      log.info('Sam: queue_pressure notification sent to Manager', { queueDepth });
    } catch (sendErr) {
      log.warn('Sam: failed to send queue_pressure to Manager', { err: sendErr.message });
    }
    return { foundPattern: true, detail: { hot_count, warm_count, queueDepth } };
  }

  log.info('Sam: pipeline healthy, queue healthy', { hot_count, warm_count, queueDepth });
  return { foundPattern: false, detail: { hot_count, warm_count, queueDepth } };
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
          const result = await processIncomingMessage(msg, messenger, runtime, log, supabase);
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

      // Autonomous pipeline + queue scan
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          const result = await runAutonomousCycle(supabase, messenger, log);
          if (result?.foundPattern) {
            log.info('Sam: autonomous cycle detected pattern', { detail: result.detail });
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
