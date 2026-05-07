// ============================================================
// workers/helena_autonomous.js — Helena Autonomous Worker (Phase 2)
//
// Long-lived loop that drives Helena's audit agent. Handles
// inbound message dispatch, autonomous cycle scheduling, circuit-
// breaker + pause checks, and graceful shutdown.
//
// Phase 2 wires agents/helena.js with real LLM calls via AgentRuntime.
// Primary provider: NVIDIA NIM (LLaMA). Fallback: Gemini (AgentRuntime
// handles this automatically). Same wiring as outreach_dispatcher.js.
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
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { helena } from '../agents/helena.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '2.0.0';
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
 * Returns a result object for ack payload.
 *
 * Supported types: seo_audit, blog_write, keyword_research, pause
 * Anything else throws → caller nacks the message.
 */
async function processIncomingMessage(msg, messenger, runtime, log, supabase) {
  const { type } = msg.payload ?? {};

  // ── Helper: set circuit breaker on rate-limit errors ────────
  async function handleRateLimitError(err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Helena: rate-limit detected, opening circuit breaker', { until });
    }
  }

  // ── seo_audit ────────────────────────────────────────────────
  if (type === 'seo_audit') {
    const { brand_id, website_url, depth } = msg.payload;
    log.info('Helena: handling seo_audit', { brand_id, website_url, depth });
    try {
      const prompt = `Realiza un SEO audit técnico para el sitio web ${website_url}. Devuelve el JSON radiography_technical.`;
      const result = await runtime.run('Helena', prompt, { brand_id });

      // Persist last_audit_at so the autonomous cycle doesn't re-detect this brand
      const { error: updateErr } = await supabase
        .from('brands')
        .update({ last_audit_at: new Date().toISOString() })
        .eq('id', brand_id);
      if (updateErr) {
        log.warn('Helena: failed to update brands.last_audit_at — audit will repeat next cycle', { err: updateErr.message });
      }

      // Save audit summary to agent_state so Helena can recall recent work
      await messenger.setState(`last_seo_audit:${brand_id}`, {
        audited_at: new Date().toISOString(),
        website_url,
        depth,
        result_preview: (result.response || '').slice(0, 800),
        iterations: result.iterations ?? null,
      });

      // Notify Manager that the audit is complete
      await messenger.send({
        to: 'manager',
        payload: {
          type: 'seo_audit_completed',
          brand_id,
          website_url,
          depth,
          result_preview: (result.response || '').slice(0, 400),
        },
      });

      return {
        ok: true,
        type: 'seo_audit',
        brand_id,
        persisted: true,
        result_preview: (result.response || '').slice(0, 500),
      };
    } catch (err) {
      await handleRateLimitError(err);
      throw err;
    }
  }

  // ── blog_write ───────────────────────────────────────────────
  if (type === 'blog_write') {
    const { brand_id, topic, target_kw, length_target } = msg.payload;
    log.info('Helena: handling blog_write', { brand_id, topic, target_kw, length_target });
    try {
      const prompt = `Escribe un blog post optimizado para SEO sobre ${topic}, keyword principal ${target_kw}, ~${length_target} palabras.`;
      const result = await runtime.run('Helena', prompt, { brand_id });
      return { ok: true, type: 'blog_write', result: result.response?.slice(0, 500) };
    } catch (err) {
      await handleRateLimitError(err);
      throw err;
    }
  }

  // ── keyword_research ─────────────────────────────────────────
  if (type === 'keyword_research') {
    const { brand_id, niche, geo } = msg.payload;
    log.info('Helena: handling keyword_research', { brand_id, niche, geo });
    try {
      const prompt = `Genera un mapa de keywords para ${niche} en ${geo}.`;
      const result = await runtime.run('Helena', prompt, { brand_id });
      return { ok: true, type: 'keyword_research', result: result.response?.slice(0, 500) };
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
        log.info('Helena: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Helena: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', result: { duration_ms } };
  }

  throw new Error(`unknown_message_type: ${type}`);
}

// ── runAutonomousAuditCycle ──────────────────────────────────

/**
 * Proactive coordination: scan Supabase for brands that need an SEO audit
 * and notify the Manager agent instead of running audits unilaterally.
 *
 * Gracefully degrades if last_audit_at column doesn't exist yet.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentMessenger} messenger
 * @param {object} log
 * @returns {{ foundPattern: boolean, detail: any }}
 */
async function runAutonomousAuditCycle(supabase, messenger, log) {
  log.info('Helena: running autonomous audit cycle');

  // ── Query brands due for audit ───────────────────────────────
  // Migration 018 added last_audit_at to brands. If for any reason the column
  // is missing in this DB, Postgres returns code '42703' (undefined column)
  // and we degrade gracefully.
  const { data: candidates, error: queryErr } = await supabase
    .from('brands')
    .select('id, name, last_audit_at')
    .or('last_audit_at.is.null,last_audit_at.lt.' + new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(3);

  if (queryErr) {
    if (queryErr.code === '42703') {
      log.warn('Helena: brands.last_audit_at column missing — apply migration 018', {
        err: queryErr.message,
      });
      return { foundPattern: false, detail: { reason: 'no_last_audit_at_column' } };
    }
    log.warn('Helena: brands query failed in autonomous cycle', { err: queryErr.message });
    return { foundPattern: false, detail: { reason: 'query_error', err: queryErr.message } };
  }

  if (!candidates || candidates.length === 0) {
    log.info('Helena: no brands due for audit');
    await messenger.setState('last_proactive_scan_at', new Date().toISOString());
    return { foundPattern: false, detail: { candidates: 0 } };
  }

  // ── Notify manager for each candidate ───────────────────────
  for (const brand of candidates) {
    const lastAuditAt = brand.last_audit_at ? new Date(brand.last_audit_at) : null;
    const daysSinceAudit = lastAuditAt
      ? Math.floor((Date.now() - lastAuditAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    try {
      await messenger.send({
        to: 'manager',
        payload: {
          type: 'seo_audit_proposal',
          brand_id: brand.id,
          name: brand.name,
          days_since_audit: daysSinceAudit,
        },
      });
      log.info('Helena: seo_audit_proposal sent to manager', {
        brand_id: brand.id,
        name: brand.name,
        days_since_audit: daysSinceAudit,
      });
    } catch (sendErr) {
      log.warn('Helena: failed to send seo_audit_proposal to manager', {
        brand_id: brand.id,
        err: sendErr.message,
      });
    }
  }

  await messenger.setState('last_proactive_scan_at', new Date().toISOString());

  return {
    foundPattern: candidates.length > 0,
    detail: { candidates: candidates.length },
  };
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

  // ── AgentRuntime init (NVIDIA primary, Gemini fallback) ───────
  // Same wiring as outreach_dispatcher.js post-2026-05-06 NVIDIA fix.
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(helena);

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
          const result = await processIncomingMessage(msg, messenger, runtime, log, supabase);
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
          const result = await runAutonomousAuditCycle(supabase, messenger, log);
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
