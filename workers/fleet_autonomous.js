// ============================================================
// workers/fleet_autonomous.js — Fleet Multiplexed Worker (Phase 6.3)
//
// ONE long-lived Node process that hosts 7 Empírika agents
// concurrently inside a single Render starter worker ($7-14/mo
// vs $77/mo for 11 separate workers — auditor recommendation I4).
//
// Agents hosted:
//   scout        — lead prospection  [REAL BRAIN — Phase 6.2]
//   Carlos Empirika — Chief Sales Strategist
//   Kai          — Social Media Strategist
//   Verifier     — outbound email QA  [REAL BRAIN — Phase 6.3]
//   Angela       — Digital Strategy Consultant
//   DaVinci      — visual generation
//   Estratega    — strategic analysis
//
// Each agent gets its own AgentMessenger (own processId, own
// heartbeat row in agent_processes) and appears as ALIVE in
// npm run agents:status independently.
//
// Phase 5 = scaffold: agents heartbeat, ack inbound messages,
// and run a no-op autonomous cycle (log + stamp last_run_at).
// Phase 6.2 = Scout real brain: proactive gap-detection sourcing
// with gosom→apify-signal fallback.
// Phase 6.3 = Verifier real brain: LLM-driven outbound email QA.
//
// Run modes:
//   node workers/fleet_autonomous.js            # production loop
//   node workers/fleet_autonomous.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import os from 'os';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AgentMessenger } from '../lib/AgentMessenger.js';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { scout } from '../agents/scout.js';
import { carlos } from '../agents/carlos.js';
import { kai } from '../agents/kai.js';
import { verifier } from '../agents/verifier.js';
import { angela } from '../agents/angela.js';
import { davinci } from '../agents/davinci.js';
import { estratega } from '../agents/estratega.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '6.3.0';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.FLEET_SLEEP_MS_PER_AGENT ?? 25_000);
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const SCOUT_PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const SCOUT_GAP_THRESHOLD = 30;    // leads per industry+metro before considered full
const SELF_CHECK = process.argv.includes('--self-check');

// ── Agent fleet manifest ─────────────────────────────────────
// Each entry: { agentModule, canonicalName, role }
// canonicalName must match what Manager/other agents route to.

const FLEET = [
  { agentModule: scout,     canonicalName: 'scout',           role: 'lead_prospection' },
  { agentModule: carlos,    canonicalName: 'Carlos Empirika', role: 'chief_sales_strategist' },
  { agentModule: kai,       canonicalName: 'Kai',             role: 'social_media_strategist' },
  { agentModule: verifier,  canonicalName: 'Verifier',        role: 'outbound_email_qa' },
  { agentModule: angela,    canonicalName: 'Angela',          role: 'digital_strategy_consultant' },
  { agentModule: davinci,   canonicalName: 'DaVinci',         role: 'visual_generation' },
  { agentModule: estratega, canonicalName: 'Estratega',       role: 'strategic_analysis' },
];

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

// ── Shared inbound message handler (scaffold) ────────────────

/**
 * Handles a single inbound message for a fleet agent.
 * Phase 5: acks with { ok: true, scaffold: true, agent } for all
 * known types, handles pause correctly, throws for unknowns.
 *
 * @param {object} msg        Claimed message row.
 * @param {AgentMessenger} messenger
 * @param {string} agentName  Canonical agent name for the ack payload.
 * @param {object} log        Child logger.
 * @returns {Promise<object>} Result payload for messenger.ack().
 */
async function processIncomingMessage(msg, messenger, agentName, log) {
  const { type } = msg.payload ?? {};

  log.info('fleet: agent_message_received', { agent: agentName, msgId: msg.id, type });

  // Track last inbound per agent in durable state
  await messenger.setState('last_inbound', {
    type,
    msg_id:      msg.id,
    received_at: new Date().toISOString(),
  });

  // ── pause ────────────────────────────────────────────────────
  if (type === 'pause') {
    const { duration_ms } = msg.payload;
    await messenger.setState('paused_by_owner', true);
    if (duration_ms > 0) {
      setTimeout(async () => {
        await messenger.setState('paused_by_owner', false);
        log.info('fleet: pause expired, resuming', { agent: agentName });
      }, duration_ms);
    }
    log.info('fleet: agent paused by owner', { agent: agentName, duration_ms });
    return { ok: true, type: 'pause', agent: agentName, result: { duration_ms } };
  }

  // ── unknown_message_type ─────────────────────────────────────
  if (!type) {
    throw new Error(`unknown_message_type: ${type}`);
  }

  // ── scaffold ack for all other message types ─────────────────
  // Phase 5 — real per-agent logic ships in Phase 6.
  return { ok: true, scaffold: true, agent: agentName, type };
}

// ── no-op autonomous cycle ───────────────────────────────────

/**
 * Phase 5 no-op autonomous cycle.
 * Logs idle + stamps last_run_at so the cooldown guard works correctly.
 */
async function runScaffoldAutonomousCycle(messenger, agentName, log) {
  log.info(`${agentName}: idle`);
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Scout: proactive sourcing cycle (Phase 6.2) ─────────────

/**
 * Scout's proactive gap-detection and sourcing cycle.
 * Step 1: 2h cooldown guard (skipped when called from sourcing_request handler).
 * Step 2: JS-side GROUP BY to find the industry+metro with fewest leads (<30).
 * Step 3: runtime.run('scout', ...) to drive LLM sourcing.
 * Step 4: ECONNREFUSED/gosom error → signal manager, return.
 * Step 5: Parse JSON leads from LLM response, insert each to leads table.
 * Step 6: Send sourcing_completed to manager.
 * Step 7: Persist last_proactive_scan_at + last_sourcing_target.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentRuntime} runtime
 * @param {AgentMessenger} messenger
 * @param {object} log
 * @param {{ industry?: string, metro_area?: string }|null} [override]
 *   When set, skips gap-detection and sources for the given pair (sourcing_request).
 */
async function runScoutSourcingCycle(supabase, runtime, messenger, log, override = null) {
  // ── 1. Proactive-scan cooldown (skip when override is set) ──
  if (!override) {
    const lastScan = await messenger.getState('last_proactive_scan_at');
    if (lastScan && Date.now() - new Date(lastScan).getTime() < SCOUT_PROACTIVE_COOLDOWN_MS) {
      log.debug('scout: proactive scan skipped — within 2h cooldown', { lastScan });
      return;
    }
  }

  // ── Helper: rate-limit circuit breaker ──────────────────────
  async function handleRateLimitError(err) {
    const errMsg = (err.message || '').toLowerCase();
    if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('scout: rate-limit detected, opening circuit breaker', { until });
    }
  }

  let industry, metro_area;

  if (override) {
    industry   = override.industry;
    metro_area = override.metro_area;
    log.info('scout: sourcing override from message', { industry, metro_area });
  } else {
    // ── 2. Identify pipeline gap via JS grouping ─────────────────
    const { data: allLeads, error: leadsErr } = await supabase
      .from('leads')
      .select('industry, metro_area')
      .eq('brand_id', BRAND_ID)
      .not('industry', 'is', null)
      .not('metro_area', 'is', null);

    if (leadsErr) {
      log.warn('scout: gap query failed', { err: leadsErr.message });
      return;
    }

    // Group by industry+metro and find the bucket with fewest leads below threshold
    const counts = {};
    for (const row of (allLeads || [])) {
      const key = `${row.industry}|||${row.metro_area}`;
      counts[key] = (counts[key] || 0) + 1;
    }

    let minCount = SCOUT_GAP_THRESHOLD;
    let minKey = null;
    for (const [key, cnt] of Object.entries(counts)) {
      if (cnt < minCount) { minCount = cnt; minKey = key; }
    }

    if (!minKey) {
      log.info('scout: no pipeline gap detected — all buckets at threshold or no data');
      await messenger.setState('last_proactive_scan_at', new Date().toISOString());
      return;
    }

    const parts = minKey.split('|||');
    industry   = parts[0];
    metro_area = parts[1];
    log.info('scout: pipeline gap detected', { industry, metro_area, count: minCount });
  }

  // ── 3. Run Scout LLM sourcing cycle ─────────────────────────
  const prompt =
    `Necesito sourcing para industria=${industry} metro=${metro_area}. ` +
    `Usa scrapeGoogleMaps con maxResults=15, minReviews=20, minRating=4.5. ` +
    `Devuelve JSON con leads found.`;

  let runtimeResult;
  try {
    runtimeResult = await runtime.run('scout', prompt, { brand_id: BRAND_ID });
  } catch (err) {
    log.error('scout: runtime.run failed', { err: err.message });
    await handleRateLimitError(err);

    // ── 4. Gosom / connection error → signal manager ─────────────
    const errLower = (err.message || '').toLowerCase();
    if (
      errLower.includes('localhost:9090') ||
      errLower.includes('econnrefused') ||
      errLower.includes('gosom')
    ) {
      log.warn('scout: gosom unreachable, signalling manager', { industry, metro_area });
      try {
        await messenger.send({
          to: 'manager',
          payload: {
            type:    'scout_sourcing_blocked',
            industry,
            metro_area,
            reason:  'gosom_unavailable_no_apify_fallback_yet',
          },
        });
      } catch (sendErr) {
        log.warn('scout: failed to send scout_sourcing_blocked to manager', { err: sendErr.message });
      }
    }
    return;
  }

  // ── 5. Parse JSON leads from LLM response and insert ────────
  const rawResponse = runtimeResult?.response || '';
  let leadsFound = [];

  try {
    const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      leadsFound = JSON.parse(jsonMatch[0]);
    } else {
      const obj = JSON.parse(rawResponse);
      if (Array.isArray(obj))              leadsFound = obj;
      else if (Array.isArray(obj.leads))   leadsFound = obj.leads;
      else if (Array.isArray(obj.results)) leadsFound = obj.results;
    }
  } catch (parseErr) {
    log.warn('scout: could not parse leads JSON from LLM response', {
      err:     parseErr.message,
      preview: rawResponse.slice(0, 200),
    });
    leadsFound = [];
  }

  let countInserted = 0;
  for (const lead of leadsFound) {
    if (!lead || typeof lead !== 'object') continue;
    try {
      const { error: insertErr } = await supabase.from('leads').insert({
        brand_id:        BRAND_ID,
        business_name:   lead.business_name || lead.name || null,
        industry:        lead.industry       || industry,
        metro_area:      lead.metro_area     || metro_area,
        phone:           lead.phone          || null,
        website:         lead.website        || null,
        email:           lead.email          || null,
        rating:          lead.rating         || null,
        review_count:    lead.review_count   || lead.reviewCount || null,
        google_maps_url: lead.google_maps_url || lead.googleMapsUrl || null,
        tier:            lead.tier           || null,
        score:           lead.score          || null,
        status:          'new',
        source:          'scout_autonomous',
      });
      if (insertErr) {
        log.warn('scout: lead insert error (skipping)', {
          err:  insertErr.message,
          name: lead?.business_name || lead?.name,
        });
      } else {
        countInserted++;
      }
    } catch (insertEx) {
      log.warn('scout: lead insert exception (skipping)', { err: insertEx.message });
    }
  }

  log.info('scout: sourcing cycle complete', {
    industry,
    metro_area,
    count_found:    leadsFound.length,
    count_inserted: countInserted,
  });

  // ── 6. Report to manager ─────────────────────────────────────
  try {
    await messenger.send({
      to: 'manager',
      payload: {
        type:           'sourcing_completed',
        industry,
        metro_area,
        count_found:    leadsFound.length,
        count_inserted: countInserted,
      },
    });
  } catch (sendErr) {
    log.warn('scout: failed to send sourcing_completed to manager', { err: sendErr.message });
  }

  // ── 7. Persist state ─────────────────────────────────────────
  await messenger.setState('last_proactive_scan_at', new Date().toISOString());
  await messenger.setState('last_sourcing_target', {
    industry,
    metro_area,
    ran_at: new Date().toISOString(),
  });
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Scout: inbound message handler (Phase 6.2) ──────────────

/**
 * Handles a single inbound message addressed to Scout.
 * Supported types: sourcing_request, pause
 * Anything else throws → caller nacks.
 *
 * @param {object} msg
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} log
 * @returns {Promise<object>} Result payload for messenger.ack().
 */
async function processScoutMessage(msg, messenger, runtime, supabase, log) {
  const { type } = msg.payload ?? {};

  log.info('scout: message_received', { msgId: msg.id, type });

  await messenger.setState('last_inbound', {
    type,
    msg_id:      msg.id,
    received_at: new Date().toISOString(),
  });

  // ── sourcing_request ─────────────────────────────────────────
  if (type === 'sourcing_request') {
    const { industry, metro_area } = msg.payload;
    log.info('scout: handling sourcing_request', { industry, metro_area });
    await runScoutSourcingCycle(supabase, runtime, messenger, log, { industry, metro_area });
    return { ok: true, type: 'sourcing_request', industry, metro_area };
  }

  // ── pause ─────────────────────────────────────────────────────
  if (type === 'pause') {
    const { duration_ms } = msg.payload;
    await messenger.setState('paused_by_owner', true);
    if (duration_ms > 0) {
      setTimeout(async () => {
        await messenger.setState('paused_by_owner', false);
        log.info('scout: pause expired, resuming');
      }, duration_ms);
    }
    log.info('scout: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'scout', result: { duration_ms } };
  }

  throw new Error(`unknown_message_type: ${type}`);
}

// ── Verifier real-brain handler (Phase 6.3) ─────────────────

/**
 * Handles a single inbound message addressed to the Verifier agent.
 * Implements real LLM-driven email QA: scores a draft, returns a JSON verdict.
 *
 * Supported types:
 *   verify_email_draft — run Verifier LLM, parse + persist verdict, reply to sender
 *   pause              — same pause logic as other fleet agents
 *   anything else      — nack with unknown_message_type
 *
 * @param {object} msg        Claimed message row.
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {object} log        Child logger.
 * @returns {Promise<object>} Result payload for messenger.ack().
 */
async function processVerifierMessage(msg, messenger, runtime, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('Verifier: message_received', { msgId: msg.id, type });

  // Track last inbound in durable state (consistent with other fleet agents)
  await messenger.setState('last_inbound', {
    type,
    msg_id:      msg.id,
    received_at: new Date().toISOString(),
  });

  // ── pause ────────────────────────────────────────────────────
  if (type === 'pause') {
    const { duration_ms } = payload;
    await messenger.setState('paused_by_owner', true);
    if (duration_ms > 0) {
      setTimeout(async () => {
        await messenger.setState('paused_by_owner', false);
        log.info('Verifier: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Verifier: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'Verifier', result: { duration_ms } };
  }

  // ── verify_email_draft ───────────────────────────────────────
  if (type === 'verify_email_draft') {
    const { draft_text, lead_id, lead_industry, lead_city, source_message_id, sender } = payload;

    if (!draft_text) {
      throw new Error('missing_draft_text');
    }

    const prompt =
      `Auditá este draft outbound. Devolvé EXCLUSIVAMENTE el JSON con scores, overall, verdict, issues, rewrite_hint. NO markdown. Draft:\n\n${draft_text}`;

    let result;
    try {
      result = await runtime.run('Verifier', prompt, { brand_id: BRAND_ID, max_iterations: 1 });
    } catch (err) {
      // 429 / rate-limit circuit breaker (same pattern as Helena)
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Verifier: rate-limit detected, opening circuit breaker', { until });
      }
      throw err;
    }

    // Also open circuit breaker if the response itself signals quota exhaustion
    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Verifier: quota exhausted in response, opening circuit breaker', { until });
      throw new Error('Verifier LLM quota exhausted');
    }

    const raw = result.response || '';

    // Parse: direct JSON.parse first, then extract first {...} block
    let verdict;
    try {
      verdict = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          verdict = JSON.parse(match[0]);
        } catch (e2) {
          throw new Error(`Verifier JSON parse failed after extraction: ${e2.message}. Raw: ${raw.slice(0, 300)}`);
        }
      } else {
        throw new Error(`Verifier returned non-JSON response. Raw: ${raw.slice(0, 300)}`);
      }
    }

    // Validate required fields
    if (!verdict.scores || !verdict.verdict || verdict.overall === undefined) {
      throw new Error(`Verifier verdict missing required fields. Got: ${JSON.stringify(verdict).slice(0, 200)}`);
    }

    const { scores, overall, verdict: verdictVal, issues = [], rewrite_hint = '' } = verdict;

    // Persist verdict to durable state
    const stateKey = `last_verdict:${lead_id || 'no-lead'}`;
    await messenger.setState(stateKey, {
      scores,
      overall,
      verdict:     verdictVal,
      issues,
      rewrite_hint,
      lead_id:     lead_id ?? null,
      verified_at: new Date().toISOString(),
    });

    // Reply to sender with the verdict
    const replyTo = msg.from_agent || sender;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:              'verify_email_verdict',
            source_message_id: source_message_id ?? msg.id,
            lead_id:           lead_id ?? null,
            scores,
            overall,
            verdict:           verdictVal,
            issues,
            rewrite_hint,
          },
        });
      } catch (sendErr) {
        // Reply failure is non-fatal — verdict was persisted; log and continue
        log.warn('Verifier: failed to send verdict reply', { replyTo, err: sendErr.message });
      }
    }

    log.info('Verifier: verdict generated', {
      lead_id: lead_id ?? 'no-lead',
      verdict: verdictVal,
      overall,
    });

    return { ok: true, verdict: verdictVal, overall };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * Verifier autonomous cycle — no-op. Verifier is reactive only.
 * Logs idle so the cooldown guard works correctly.
 */
async function runVerifierAutonomousCycle(messenger, log) {
  log.info('Verifier: idle, awaiting verify_email_draft messages');
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Per-agent boot + loop ────────────────────────────────────

/**
 * Boots a single agent: registers, reclaims orphans, runs its loop.
 * Returns a controller object with a `stop()` method.
 *
 * @param {object} entry      Entry from FLEET manifest.
 * @param {object} supabase   Shared Supabase client.
 * @param {AgentRuntime} runtime  Shared runtime (NVIDIA primary, Gemini fallback).
 * @param {string} host       Hostname.
 * @returns {Promise<{ stop: () => void, drainPromise: Promise<void> }>}
 */
async function bootAgent(entry, supabase, runtime, host) {
  const { agentModule, canonicalName, role } = entry;
  const processId = randomUUID();
  const log = logger.child({ agent: canonicalName, processId, version: VERSION });

  // Register agent with runtime (needed for AgentRuntime.run() calls in Phase 6)
  runtime.registerAgent(agentModule);

  const messenger = new AgentMessenger({
    supabase,
    agentName: canonicalName,
    processId,
    brandId: BRAND_ID,
  });

  await messenger.register({
    host,
    metadata: { multiplexed: true, role, version: VERSION },
  });
  log.info(`fleet: ${canonicalName} registered`, { processId, host });

  // Orphan reclamation at boot
  try {
    const reclaimed = await messenger.reclaimOrphans();
    log.info(`fleet: ${canonicalName} orphan reclamation complete`, reclaimed);
  } catch (reclaimErr) {
    log.warn(`fleet: ${canonicalName} reclaimOrphans failed at boot (continuing)`, {
      err: reclaimErr.message,
    });
  }

  // ── Inner loop state ────────────────────────────────────────
  let stopped = false;
  let consecutiveFailures = 0;
  let currentIterationResolve = null;

  // drainPromise resolves when the current iteration finishes (for clean shutdown)
  let drainResolve;
  const drainPromise = new Promise((res) => { drainResolve = res; });

  async function loopIteration() {
    log.debug(`fleet: ${canonicalName} loop tick`);

    try {
      await messenger.heartbeat();

      const msgs = await messenger.recv({ limit: 3 });

      let processedCount = 0;
      for (const msg of msgs) {
        try {
          // ── dispatch: route to per-agent real-brain handler or scaffold ──
          let result;
          if (canonicalName === 'scout') {
            result = await processScoutMessage(msg, messenger, runtime, supabase, log);
          } else if (canonicalName === 'Verifier') {
            result = await processVerifierMessage(msg, messenger, runtime, log);
          } else {
            result = await processIncomingMessage(msg, messenger, canonicalName, log);
          }
          await messenger.ack(msg.id, { result });
          processedCount++;
        } catch (err) {
          log.error(`fleet: ${canonicalName} message processing failed`, {
            msgId: msg.id,
            err: err.message,
          });
          try { await messenger.nack(msg.id, err.message); } catch (ne) {
            log.warn(`fleet: ${canonicalName} nack failed`, ne);
          }
        }
      }

      if (processedCount > 0) {
        log.info(`fleet: ${canonicalName} processed inbound messages`, { count: processedCount });
      }

      // Autonomous cycle — route scout to real sourcing cycle; others use scaffold
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          if (canonicalName === 'scout') {
            await runScoutSourcingCycle(supabase, runtime, messenger, log, null);
          } else if (canonicalName === 'Verifier') {
            await runVerifierAutonomousCycle(messenger, log);
          } else {
            await runScaffoldAutonomousCycle(messenger, canonicalName, log);
          }
        } catch (err) {
          log.error(`fleet: ${canonicalName} autonomous cycle failed`, err);
        }
      } else if (msgs.length === 0) {
        log.debug(`fleet: ${canonicalName} skipped autonomous cycle`, {
          reason: 'cooldown_or_paused',
        });
      }

      consecutiveFailures = 0;
    } catch (loopErr) {
      consecutiveFailures++;
      const backoffMs = Math.min(60_000, SLEEP_MS * 2 ** consecutiveFailures);
      log.error(`fleet: ${canonicalName} loop iteration failed, backing off`, {
        err: loopErr.message,
        consecutiveFailures,
        backoffMs,
      });

      if (!stopped) await sleep(backoffMs);
    }
  }

  // ── Recursive setTimeout loop ────────────────────────────────
  async function scheduleNext() {
    if (stopped) {
      drainResolve();
      return;
    }

    await loopIteration();

    if (SELF_CHECK || stopped) {
      drainResolve();
      return;
    }

    setTimeout(scheduleNext, SLEEP_MS);
  }

  // Stagger agent starts slightly so their heartbeats don't all fire simultaneously
  const staggerMs = FLEET.findIndex((e) => e.canonicalName === canonicalName) * 1000;
  setTimeout(scheduleNext, staggerMs);

  function stop() {
    stopped = true;
  }

  return { messenger, stop, drainPromise, log, canonicalName };
}

// ── Main ─────────────────────────────────────────────────────

async function run() {
  const host = os.hostname();
  const rootLog = logger.child({ worker: 'fleet', version: VERSION });

  rootLog.info('fleet worker starting', { host, selfCheck: SELF_CHECK, agents: FLEET.length });

  // Shared resources (constructed once)
  const supabase = buildSupabase();
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model:   'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });

  // ── Boot all agents ──────────────────────────────────────────
  const agents = [];
  for (const entry of FLEET) {
    try {
      const handle = await bootAgent(entry, supabase, runtime, host);
      agents.push(handle);
    } catch (bootErr) {
      rootLog.error(`fleet: FATAL — failed to boot ${entry.canonicalName}`, {
        err: bootErr.message,
      });
      // Deregister the agents that DID boot before this point so they don't
      // accumulate as orphans in agent_processes.
      for (const booted of agents) {
        try {
          await booted.messenger.deregister();
          booted.log.warn(`fleet: ${booted.canonicalName} deregistered after partial-boot failure`);
        } catch (e) {
          booted.log.warn(`fleet: ${booted.canonicalName} deregister-on-rollback failed`, { err: e.message });
        }
      }
      throw bootErr;
    }
  }

  rootLog.info('fleet: all agents running', {
    agents: agents.map((a) => a.canonicalName),
  });

  // ── Graceful shutdown ────────────────────────────────────────
  let shutdownRequested = false;

  async function shutdown(signal) {
    if (shutdownRequested) return;
    shutdownRequested = true;
    rootLog.info('fleet: graceful shutdown initiated', { signal });

    // Signal all agent loops to stop
    for (const agent of agents) {
      agent.stop();
    }

    // Wait for all current iterations to drain (5 s timeout)
    const DRAIN_TIMEOUT_MS = 5_000;
    await Promise.race([
      Promise.all(agents.map((a) => a.drainPromise)),
      sleep(DRAIN_TIMEOUT_MS),
    ]);

    // Deregister all in parallel
    await Promise.allSettled(
      agents.map(async (agent) => {
        try {
          await agent.messenger.deregister();
          agent.log.info(`fleet: ${agent.canonicalName} deregistered`);
        } catch (e) {
          agent.log.warn(`fleet: ${agent.canonicalName} deregister failed`, e);
        }
      })
    );

    rootLog.info('fleet: shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // ── Self-check: wait for all loops to complete one iteration ──
  if (SELF_CHECK) {
    await Promise.all(agents.map((a) => a.drainPromise));
    await shutdown('self_check');
    return;
  }

  // The 7 recursive setTimeouts above keep the event loop alive on their own.
  // No explicit keepAlive interval needed — if all loops stop scheduling, the
  // process should exit, not be artificially kept alive.
}

// ── Entry point ──────────────────────────────────────────────

run().catch((err) => {
  logger.error('fleet worker fatal error', err);
  process.exit(1);
});
