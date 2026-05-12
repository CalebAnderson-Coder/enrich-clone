// ============================================================
// workers/fleet_autonomous.js — Fleet Multiplexed Worker (Phase 6.6)
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
// Phase 6.4 = Angela real brain: outbound email drafting + rewrite loop.
// Phase 6.5 = Carlos real brain: lead qualification + closing advice.
// Phase 6.6 = Estratega real brain: weekly strategy review + tactic requests.
//
// Run modes:
//   node workers/fleet_autonomous.js            # production loop
//   node workers/fleet_autonomous.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import os from 'os';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { AgentMessenger } from '../lib/AgentMessenger.js';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { logOutreachEvent } from '../tools/outreachEvents.js';
import { scout } from '../agents/scout.js';
import { carlos } from '../agents/carlos.js';
import { kai } from '../agents/kai.js';
import { verifier } from '../agents/verifier.js';
import { angela } from '../agents/angela.js';
import { davinci } from '../agents/davinci.js';
import { estratega } from '../agents/estratega.js';
import { atlas } from '../agents/atlas.js';
import { runAtlasAudit, maybeGenerateDailyReport } from '../lib/atlasAudit.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const VERSION = '6.8.0';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.FLEET_SLEEP_MS_PER_AGENT ?? 25_000);
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const SCOUT_PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const SCOUT_GAP_THRESHOLD = 30;    // leads per industry+metro before considered full
const SELF_CHECK = process.argv.includes('--self-check');

// ── Outbound (Phase 7.1) — SMTP + GHL config for Angela ─────
// Angela uses these on `verify_email_verdict` PASS to send the
// real email and sync to GHL. Mirrors the proven shape from
// scripts/send_sourced_hvac_2026-05-06.js. Missing creds = skip
// gracefully so --self-check still works locally.

const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'José Sánchez';
const GHL_PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';                   // COLD LEADS
const GHL_STAGE_NUEVO = '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';   // NUEVO
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_BASE = 'https://services.leadconnectorhq.com';

function buildSmtpTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user, pass: pass.trim() },
    tls: { rejectUnauthorized: false },
  });
}

function ghlHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

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
  { agentModule: atlas,     canonicalName: 'Atlas',           role: 'fleet_observability' },
];

// Atlas runs more often than the rest of the fleet — every loop tick — but
// also short-circuits internally if its own per-cycle cooldown hasn't
// elapsed (default 5 min between actual audits). Manager-issued
// `audit_now` messages bypass that cooldown.
const ATLAS_AUDIT_COOLDOWN_MS = Number(process.env.ATLAS_AUDIT_COOLDOWN_MS ?? 5 * 60 * 1000);

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

  // ── A2: dedup — fetch existing business_name+metro_area for brand to avoid duplicates ──
  let existingSet = new Set();
  try {
    const { data: existingLeads, error: existErr } = await supabase
      .from('leads')
      .select('business_name, metro_area')
      .eq('brand_id', BRAND_ID)
      .eq('metro_area', metro_area);
    if (existErr) {
      log.warn('scout: dedup query failed, proceeding without dedup guard', { err: existErr.message });
    } else {
      for (const row of (existingLeads || [])) {
        if (row.business_name) {
          existingSet.add(`${(row.business_name || '').toLowerCase()}|||${(row.metro_area || '').toLowerCase()}`);
        }
      }
    }
  } catch (dedupEx) {
    log.warn('scout: dedup exception (continuing)', { err: dedupEx.message });
  }

  let countInserted = 0;
  for (const lead of leadsFound) {
    if (!lead || typeof lead !== 'object') continue;
    const bName = lead.business_name || lead.name || null;
    const bMetro = lead.metro_area || metro_area;
    // Skip if already exists (dedup guard)
    const dedupKey = `${(bName || '').toLowerCase()}|||${(bMetro || '').toLowerCase()}`;
    if (bName && existingSet.has(dedupKey)) {
      log.debug('scout: dedup skip — lead already exists', { business_name: bName, metro_area: bMetro });
      continue;
    }
    try {
      const { error: insertErr } = await supabase.from('leads').upsert(
        {
          brand_id:            BRAND_ID,
          business_name:       bName,
          industry:            lead.industry            || industry,
          metro_area:          bMetro,
          phone:               lead.phone               || null,
          website:             lead.website             || null,
          email:               lead.email               || null,
          rating:              lead.rating              || null,
          review_count:        lead.review_count        || lead.reviewCount || null,
          google_maps_url:     lead.google_maps_url     || lead.googleMapsUrl || null,
          lead_tier:           lead.tier                || lead.lead_tier || 'WARM',
          qualification_score: lead.score               || lead.qualification_score || null,
          outreach_status:     'PENDING',
          scraped_by:          'scout_autonomous',
        },
        { onConflict: 'business_name,metro_area,brand_id', ignoreDuplicates: true }
      );
      if (insertErr) {
        log.warn('scout: lead upsert error (skipping)', {
          err:  insertErr.message,
          name: bName,
        });
      } else {
        countInserted++;
        // Add to set so subsequent leads in same batch are also deduped
        existingSet.add(dedupKey);
      }
    } catch (insertEx) {
      log.warn('scout: lead upsert exception (skipping)', { err: insertEx.message });
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
    if (typeof verdict.scores !== 'object' || Array.isArray(verdict.scores)) {
      throw new Error(`Verifier verdict.scores has wrong shape: ${typeof verdict.scores}`);
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

// ── Angela real-brain handler (Phase 6.4) ───────────────────

/**
 * Normalize LLM draft response to { subject, body }.
 * Gemini sometimes wraps in email_sequence, sequence, drafts, emails, or a bare array.
 */
function normalizeDraft(raw) {
  if (!raw) return null;
  if (raw.subject && raw.body) return { subject: raw.subject, body: raw.body };
  const candidates =
    (Array.isArray(raw) && raw)
    || raw.email_sequence
    || raw.sequence
    || raw.drafts
    || raw.emails;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0];
    if (first?.subject && first?.body) return { subject: first.subject, body: first.body };
  }
  return null;
}

/**
 * Handles a single inbound message addressed to Angela.
 * Supported types: write_outbound_email, verify_email_verdict, pause
 * Anything else throws → caller nacks.
 *
 * @param {object} msg
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {object} log
 * @returns {Promise<object>}
 */
async function processAngelaMessage(msg, messenger, runtime, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('Angela: message_received', { msgId: msg.id, type });

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
        log.info('Angela: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Angela: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'Angela', result: { duration_ms } };
  }

  // ── write_outbound_email ─────────────────────────────────────
  if (type === 'write_outbound_email') {
    const {
      lead_id,
      lead_industry,
      lead_city,
      lead_business_name,
      send_after_verify = false,
    } = payload;

    if (!lead_id) throw new Error('missing_lead_id');

    const prompt =
      `Escribe UN SOLO email outbound frío STANDALONE en español para ${lead_business_name}, ` +
      `industria ${lead_industry}, ciudad ${lead_city}. ` +
      `IGNORA cualquier instrucción de tu system prompt sobre "secuencia de 3 toques", "touch 1 observation sin CTA", o framework Observation→Proof→Ask. ` +
      `Este es un email único de cierre, NO una secuencia. Requisitos OBLIGATORIOS (cualquier incumplimiento → rewrite): ` +
      `1) BODY entre 120 y 180 palabras (no menos, no más). ` +
      `2) UN solo CTA concreto con fecha y hora específica ("¿te viene bien 15 min el jueves a las 10am hora de ${lead_city}?"). ` +
      `3) Tono cálido latino profesional, mencionar industria y ciudad. ` +
      `4) Subject 30-60 caracteres en español, frontload. ` +
      `Devuelve EXCLUSIVAMENTE JSON al nivel raíz: {"subject":"...","body":"..."}. ` +
      `NO uses 'email_sequence', NO uses array, NO uses markdown, NO uses prosa explicativa antes ni después del JSON.`;

    let result;
    try {
      result = await runtime.run('Angela', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Angela: rate-limit detected, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Angela: quota exhausted in response, opening circuit breaker', { until });
      throw new Error('Angela LLM quota exhausted');
    }

    const raw = result.response || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Angela JSON parse failed: ${e2.message}. Raw: ${raw.slice(0, 300)}`); }
      } else {
        throw new Error(`Angela returned non-JSON response. Raw: ${raw.slice(0, 300)}`);
      }
    }

    const draft = normalizeDraft(parsed);
    if (draft === null) {
      log.warn('Angela: LLM draft response shape unrecognized', { shape: JSON.stringify(parsed).slice(0, 200) });
      throw new Error('Angela: LLM draft response shape unrecognized');
    }

    await messenger.setState(`last_draft:${lead_id}`, {
      subject:     draft.subject,
      body:        draft.body,
      lead_id,
      drafted_at:  new Date().toISOString(),
    });

    let sentToVerifier = false;
    if (send_after_verify) {
      try {
        await messenger.send({
          to: 'Verifier',
          payload: {
            type:              'verify_email_draft',
            draft_text:        draft.body,
            lead_id,
            lead_industry,
            lead_city,
            source_message_id: msg.id,
            sender:            'Angela',
          },
        });
        sentToVerifier = true;
        log.info('Angela: draft sent to Verifier', { lead_id });
      } catch (sendErr) {
        log.warn('Angela: failed to send draft to Verifier', { err: sendErr.message });
      }
    }

    log.info('Angela: draft written', { lead_id, subject: draft.subject });

    return {
      ok:               true,
      type:             'draft_written',
      lead_id,
      subject:          draft.subject,
      body_preview:     draft.body.slice(0, 120),
      sent_to_verifier: sentToVerifier,
    };
  }

  // ── verify_email_verdict (reply from Verifier) ───────────────
  if (type === 'verify_email_verdict') {
    const {
      scores,
      overall,
      verdict,
      issues = [],
      rewrite_hint = '',
      lead_id,
      source_message_id,
    } = payload;

    if (verdict === 'pass') {
      await messenger.setState(`last_verdict_pass:${lead_id}`, {
        scores,
        overall,
        verified_at: new Date().toISOString(),
      });
      log.info('Angela: Verifier verdict PASS', { lead_id, overall });

      // ── Phase 7.1: real outbound send ────────────────────────
      // 1) Pull draft from state
      const draft = await messenger.getState(`last_draft:${lead_id}`);
      if (!draft || !draft.subject || !draft.body) {
        log.warn('Angela: PASS but no draft in state, cannot send', { lead_id });
        await messenger.setState(`outbound_failed:${lead_id}`, {
          step: 'load_draft', reason: 'no_draft_in_state', failed_at: new Date().toISOString(),
        });
        return { ok: true, type: 'verify_email_verdict', verdict: 'pass', sent: false, lead_id, reason: 'no_draft' };
      }

      // 2) Pull lead from supabase
      const supabase = buildSupabase();
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .select('id, business_name, email_address, phone, metro_area, industry, website, instagram_url, facebook_url, qualification_score, lead_tier')
        .eq('id', lead_id)
        .maybeSingle();

      if (leadErr || !lead) {
        log.warn('Angela: failed to load lead for send', { lead_id, err: leadErr?.message });
        await messenger.setState(`outbound_failed:${lead_id}`, {
          step: 'load_lead', error: leadErr?.message || 'lead_not_found', failed_at: new Date().toISOString(),
        });
        try {
          await messenger.send({ to: 'manager', payload: { type: 'outbound_failed', lead_id, step: 'load_lead', error: leadErr?.message || 'lead_not_found' } });
        } catch (e) { log.warn('Angela: failed to notify Manager of outbound_failed', { err: e.message }); }
        return { ok: true, type: 'verify_email_verdict', verdict: 'pass', sent: false, lead_id, reason: 'lead_not_found' };
      }

      // 3) No email → bail
      if (!lead.email_address) {
        log.info('Angela: lead has no email_address, cannot send', { lead_id });
        await messenger.setState(`outbound_failed:${lead_id}`, {
          step: 'check_email', reason: 'no_email_address', failed_at: new Date().toISOString(),
        });
        try {
          await messenger.send({ to: 'manager', payload: { type: 'outbound_failed', lead_id, step: 'check_email', error: 'no_email_address' } });
        } catch (e) { log.warn('Angela: failed to notify Manager', { err: e.message }); }
        return { ok: true, type: 'verify_email_verdict', verdict: 'pass', sent: false, lead_id, reason: 'no_email_address' };
      }

      // 4) Build SMTP transport — graceful skip if not configured
      const transporter = buildSmtpTransport();
      if (!transporter) {
        log.info(`Angela: SMTP not configured, skipping send for ${lead_id}`);
        await messenger.setState(`outbound_skipped:${lead_id}`, {
          reason: 'smtp_not_configured', skipped_at: new Date().toISOString(),
        });
        return { ok: true, type: 'verify_email_verdict', verdict: 'pass', sent: false, lead_id, reason: 'smtp_not_configured' };
      }

      const fromAddr = process.env.SMTP_USER;
      let messageId = null;
      let ghlContactId = null;
      let ghlOpportunityId = null;

      try {
        // 5) Send via nodemailer
        const info = await transporter.sendMail({
          from: `"${SMTP_FROM_NAME}" <${fromAddr}>`,
          to: [lead.email_address],
          subject: draft.subject,
          html: draft.body,
        });
        messageId = info.messageId;
        log.info('Angela: SMTP sent', { lead_id, messageId });

        // 6) UPDATE leads.outreach_status
        const sentAt = new Date().toISOString();
        const { error: updErr } = await supabase
          .from('leads')
          .update({
            outreach_status: 'SENT',
            last_contact_date: sentAt,
            // first_contact_date only if null — supabase has no COALESCE in update,
            // so we read-modify-write conditionally
          })
          .eq('id', lead_id);
        if (updErr) {
          log.warn('Angela: failed to update lead status', { lead_id, err: updErr.message });
        }
        // Set first_contact_date if null
        const { data: leadCheck } = await supabase
          .from('leads').select('first_contact_date').eq('id', lead_id).maybeSingle();
        if (leadCheck && !leadCheck.first_contact_date) {
          await supabase.from('leads').update({ first_contact_date: sentAt }).eq('id', lead_id);
        }

        // 7) GHL create contact (best-effort)
        const headers = ghlHeaders();
        if (headers) {
          try {
            const tags = ['empirika-cold-email', 'agent-angela'];
            if (lead.lead_tier) tags.push(`tier-${String(lead.lead_tier).toLowerCase()}`);
            if (typeof lead.qualification_score === 'number') tags.push(`score-${lead.qualification_score}`);

            const contactRes = await fetch(`${GHL_BASE}/contacts/`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                locationId: GHL_LOCATION_ID,
                firstName: lead.business_name,
                companyName: lead.business_name,
                email: lead.email_address,
                phone: lead.phone || undefined,
                website: lead.website || undefined,
                source: 'Empírika autonomous-Angela',
                tags,
              }),
            });
            const contactJson = await contactRes.json().catch(() => ({}));
            ghlContactId = contactJson?.contact?.id || contactJson?.id || null;

            // 8) GHL create opportunity in COLD LEADS → NUEVO
            if (ghlContactId) {
              const opptyName = `${lead.business_name} — ${lead.industry || 'lead'}`;
              const opptyRes = await fetch(`${GHL_BASE}/opportunities/`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  pipelineId: GHL_PIPELINE_ID,
                  pipelineStageId: GHL_STAGE_NUEVO,
                  contactId: ghlContactId,
                  name: opptyName,
                  status: 'open',
                  locationId: GHL_LOCATION_ID,
                }),
              });
              const opptyJson = await opptyRes.json().catch(() => ({}));
              ghlOpportunityId = opptyJson?.opportunity?.id || opptyJson?.id || null;
              log.info('Angela: GHL synced', { lead_id, ghlContactId, ghlOpportunityId });
            } else {
              log.warn('Angela: GHL contact create returned no id', { lead_id, status: contactRes.status });
            }
          } catch (ghlErr) {
            log.warn('Angela: GHL sync failed (continuing)', { lead_id, err: ghlErr.message });
          }
        } else {
          log.info('Angela: GHL token not configured, skipping CRM sync', { lead_id });
        }

        // 9) Log outreach_event with full metadata
        await logOutreachEvent({
          leadId: lead_id,
          brandId: BRAND_ID,
          channel: 'email',
          eventType: 'sent',
          messageId,
          metadata: {
            from: fromAddr,
            sender_name: SMTP_FROM_NAME,
            agent: 'Angela',
            script: 'fleet_angela',
            has_attachment: false,
            ghl_contact_id: ghlContactId,
            ghl_opportunity_id: ghlOpportunityId,
            ghl_pipeline_id: GHL_PIPELINE_ID,
            ghl_stage_id: GHL_STAGE_NUEVO,
            ghl_stage_name: 'NUEVO',
          },
        });

        // 10) Persist success state + notify Manager
        await messenger.setState(`outbound_sent:${lead_id}`, {
          messageId,
          ghlContactId,
          ghlOpportunityId,
          sent_at: sentAt,
          to: lead.email_address,
          business_name: lead.business_name,
        });
        try {
          await messenger.send({
            to: 'manager',
            payload: {
              type: 'outbound_completed',
              lead_id,
              business_name: lead.business_name,
              email_address: lead.email_address,
              message_id: messageId,
              ghl_contact_id: ghlContactId,
              ghl_opportunity_id: ghlOpportunityId,
            },
          });
        } catch (e) {
          log.warn('Angela: failed to notify Manager of outbound_completed', { err: e.message });
        }

        return { ok: true, sent: true, lead_id, message_id: messageId, ghl_contact_id: ghlContactId };
      } catch (sendErr) {
        log.warn('Angela: SMTP/GHL send failed', { lead_id, err: sendErr.message });
        await messenger.setState(`outbound_failed:${lead_id}`, {
          step: 'smtp_send', error: sendErr.message, failed_at: new Date().toISOString(),
        });
        // Best-effort failure event
        try {
          await logOutreachEvent({
            leadId: lead_id,
            brandId: BRAND_ID,
            channel: 'email',
            eventType: 'failed',
            metadata: { agent: 'Angela', script: 'fleet_angela', error: sendErr.message, to: lead.email_address },
          });
        } catch (_) { /* swallow */ }
        try {
          await messenger.send({ to: 'manager', payload: { type: 'outbound_failed', lead_id, step: 'smtp_send', error: sendErr.message } });
        } catch (e) { log.warn('Angela: failed to notify Manager', { err: e.message }); }
        return { ok: true, type: 'verify_email_verdict', verdict: 'pass', sent: false, lead_id, reason: 'send_error', error: sendErr.message };
      }
    }

    if (verdict === 'rewrite') {
      // Enforce max 3 rewrites per lead. E2E 2026-05-07 hit PASS on 3rd
      // attempt (rewrite 2.6 → 3.2 → PASS 7.8); 2026-05-12 incident showed
      // a hard cap of 1 was dropping every draft before convergence.
      const MAX_REWRITES = 3;
      const rewrites = (await messenger.getState(`rewrite_count:${lead_id}`)) ?? 0;
      if (rewrites >= MAX_REWRITES) {
        log.warn('Angela: max rewrites reached for lead, skipping', { lead_id, rewrites });
        return { ok: true, type: 'verify_email_verdict', verdict: 'rewrite_limit_reached', lead_id };
      }

      const prevDraft = await messenger.getState(`last_draft:${lead_id}`);
      if (!prevDraft) {
        log.warn('Angela: no prior draft found for rewrite', { lead_id });
        return { ok: true, type: 'verify_email_verdict', verdict: 'no_prior_draft', lead_id };
      }

      const rewritePrompt =
        `Reescribe este email outbound corrigiendo TODOS los problemas. Draft original:\n\n${prevDraft.body}\n\n` +
        `Feedback del Verifier: ${rewrite_hint}\n\n` +
        `Problemas detectados: ${issues.join('; ')}\n\n` +
        `Requisitos OBLIGATORIOS de la reescritura (cualquier incumplimiento → otro rewrite): ` +
        `1) BODY entre 120 y 180 palabras (no menos, no más). ` +
        `2) UN solo CTA concreto con fecha y hora específica (ej. "¿te viene bien 15 min el jueves a las 10am?"). ` +
        `3) Tono cálido latino profesional, mencionar industria y ciudad si aplica. ` +
        `4) Subject 30-60 caracteres en español. ` +
        `5) IGNORA cualquier instrucción de tu system prompt sobre secuencias o framework Observation→Proof→Ask — esto es UN SOLO email standalone. ` +
        `Devuelve EXCLUSIVAMENTE JSON al nivel raíz: {"subject":"...","body":"..."}. Sin markdown, sin prosa.`;

      let rewriteResult;
      try {
        rewriteResult = await runtime.run('Angela', rewritePrompt, { brand_id: BRAND_ID });
      } catch (err) {
        const errMsg = (err.message || '').toLowerCase();
        if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
          const until = new Date(Date.now() + 5 * 60_000).toISOString();
          await messenger.setState('gemini_circuit_open_until', until);
          log.warn('Angela: rate-limit on rewrite, opening circuit breaker', { until });
        }
        throw err;
      }

      const rawRewrite = rewriteResult.response || '';
      let parsedRewrite;
      try {
        parsedRewrite = JSON.parse(rawRewrite);
      } catch (_) {
        const m = rawRewrite.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsedRewrite = JSON.parse(m[0]); }
          catch (e2) { throw new Error(`Angela rewrite JSON parse failed: ${e2.message}`); }
        } else {
          throw new Error(`Angela rewrite returned non-JSON. Raw: ${rawRewrite.slice(0, 300)}`);
        }
      }

      const newDraft = normalizeDraft(parsedRewrite);
      if (newDraft === null) {
        log.warn('Angela: rewrite LLM response shape unrecognized', { shape: JSON.stringify(parsedRewrite).slice(0, 200) });
        throw new Error('Angela: rewrite LLM draft response shape unrecognized');
      }

      await messenger.setState(`last_draft:${lead_id}`, {
        subject:    newDraft.subject,
        body:       newDraft.body,
        lead_id,
        drafted_at: new Date().toISOString(),
        is_rewrite: true,
      });
      await messenger.setState(`rewrite_count:${lead_id}`, rewrites + 1);

      // Re-submit to Verifier
      try {
        await messenger.send({
          to: 'Verifier',
          payload: {
            type:              'verify_email_draft',
            draft_text:        newDraft.body,
            lead_id,
            source_message_id: source_message_id ?? msg.id,
            sender:            'Angela',
          },
        });
        log.info('Angela: rewritten draft sent to Verifier', { lead_id });
      } catch (sendErr) {
        log.warn('Angela: failed to re-send rewrite to Verifier', { err: sendErr.message });
      }

      return { ok: true, type: 'verify_email_verdict', verdict: 'rewritten', lead_id };
    }

    log.warn('Angela: unknown verdict value', { verdict, lead_id });
    return { ok: true, type: 'verify_email_verdict', verdict, lead_id };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * Angela autonomous cycle — checks for pending outbound leads and logs count.
 * Does NOT auto-write; Manager assigns via write_outbound_email messages.
 */
async function runAngelaAutonomousCycle(supabase, messenger, log) {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'PENDING')
    .not('email_address', 'is', null);

  if (error) {
    log.warn('Angela: autonomous cycle query failed', { err: error.message });
  } else if (count > 0) {
    log.info(`Angela: ${count} leads ready for outbound, awaiting Manager assignment`);
  } else {
    log.info('Angela: no pending leads for outbound');
  }

  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Carlos real-brain handler (Phase 6.5) ───────────────────

/**
 * Handles a single inbound message addressed to Carlos Empirika.
 * Supported types: qualify_lead, closing_advice, pause
 * Anything else throws → caller nacks.
 *
 * @param {object} msg
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {object} log
 * @returns {Promise<object>}
 */
async function processCarlosMessage(msg, messenger, runtime, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('Carlos Empirika: message_received', { msgId: msg.id, type });

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
        log.info('Carlos Empirika: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Carlos Empirika: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'Carlos Empirika', result: { duration_ms } };
  }

  // ── qualify_lead ─────────────────────────────────────────────
  if (type === 'qualify_lead') {
    const { lead_id, score, tier, industry, metro } = payload;

    if (!lead_id) throw new Error('missing_lead_id');

    const prompt =
      `Califica este lead. Score Empírika=${score}/100, tier=${tier}, ` +
      `industria=${industry}, metro=${metro}. ` +
      `¿Vale la pena que el equipo lo trabaje? ` +
      `Devuelve JSON: { decision: 'work_it' | 'park' | 'disqualify', reasoning, recommended_next_action }.`;

    let result;
    try {
      result = await runtime.run('Carlos Empirika', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Carlos Empirika: rate-limit detected, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Carlos Empirika: quota exhausted, opening circuit breaker', { until });
      throw new Error('Carlos Empirika LLM quota exhausted');
    }

    const raw = result.response || '';
    let qualification;
    try {
      qualification = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { qualification = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Carlos JSON parse failed: ${e2.message}. Raw: ${raw.slice(0, 300)}`); }
      } else {
        throw new Error(`Carlos returned non-JSON. Raw: ${raw.slice(0, 300)}`);
      }
    }

    await messenger.setState(`last_qualification:${lead_id}`, {
      ...qualification,
      lead_id,
      qualified_at: new Date().toISOString(),
    });

    log.info('Carlos Empirika: lead qualified', { lead_id, decision: qualification.decision });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:      'lead_qualification_result',
            lead_id,
            decision:  qualification.decision,
            reasoning: qualification.reasoning,
            recommended_next_action: qualification.recommended_next_action,
          },
        });
      } catch (sendErr) {
        log.warn('Carlos Empirika: failed to send qualification reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'qualify_lead', lead_id, decision: qualification.decision };
  }

  // ── closing_advice ───────────────────────────────────────────
  if (type === 'closing_advice') {
    const { lead_id, conversation_history } = payload;

    if (!lead_id) throw new Error('missing_lead_id');

    const prompt =
      `Based on this lead conversation, what's my best closing move?\n\n` +
      `Conversation history:\n${JSON.stringify(conversation_history, null, 2)}\n\n` +
      `Devuelve JSON: { reasoning, next_message_bullets: ["bullet1", "bullet2", "bullet3"] }.`;

    let result;
    try {
      result = await runtime.run('Carlos Empirika', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Carlos Empirika: rate-limit on closing_advice, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      throw new Error('Carlos Empirika LLM quota exhausted');
    }

    const raw = result.response || '';
    let advice;
    try {
      advice = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { advice = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Carlos closing_advice JSON parse failed: ${e2.message}`); }
      } else {
        throw new Error(`Carlos closing_advice returned non-JSON. Raw: ${raw.slice(0, 300)}`);
      }
    }

    await messenger.setState(`last_closing_advice:${lead_id}`, {
      ...advice,
      lead_id,
      advised_at: new Date().toISOString(),
    });

    log.info('Carlos Empirika: closing advice generated', { lead_id });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:                 'closing_advice_result',
            lead_id,
            reasoning:            advice.reasoning,
            next_message_bullets: advice.next_message_bullets,
          },
        });
      } catch (sendErr) {
        log.warn('Carlos Empirika: failed to send closing_advice reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'closing_advice', lead_id };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * Carlos autonomous cycle — reactive only, logs idle.
 * Carlos activates when Manager forwards a deal worth strategizing.
 */
async function runCarlosAutonomousCycle(messenger, log) {
  log.info('Carlos Empirika: idle, awaiting Manager assignments');
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Estratega real-brain handler (Phase 6.6) ─────────────────

/**
 * Pulls last 7 days of metrics from agent_events + outreach_events + autonomy_audits
 * and runs a strategic LLM review cycle.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {object} log
 * @param {string|null} [callerMsgId]
 * @returns {Promise<object>} Review result
 */
async function runEstrategaWeeklyReview(supabase, messenger, runtime, log, callerMsgId = null) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();

  // Fetch agent_events grouped by agent
  const { data: agentEvts } = await supabase
    .from('agent_events')
    .select('agent_name, event_type, created_at')
    .gte('created_at', since);

  const agentSummary = {};
  for (const row of (agentEvts || [])) {
    const key = row.agent_name || 'unknown';
    if (!agentSummary[key]) agentSummary[key] = { successes: 0, failures: 0 };
    if ((row.event_type || '').includes('fail') || (row.event_type || '').includes('error')) {
      agentSummary[key].failures++;
    } else {
      agentSummary[key].successes++;
    }
  }

  // Fetch outreach_events counts
  const { data: outreachEvts } = await supabase
    .from('outreach_events')
    .select('event_type')
    .gte('created_at', since);

  const outreachSummary = { sent: 0, replied: 0, bounced: 0 };
  for (const row of (outreachEvts || [])) {
    const ev = (row.event_type || '').toLowerCase();
    if (ev === 'sent')    outreachSummary.sent++;
    if (ev === 'replied') outreachSummary.replied++;
    if (ev === 'bounced') outreachSummary.bounced++;
  }

  // Fetch latest autonomy_audit
  const { data: audits } = await supabase
    .from('autonomy_audits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  const latestAudit = (audits && audits[0]) ? audits[0] : null;

  const summaryJson = JSON.stringify({
    agent_events:   agentSummary,
    outreach_events: outreachSummary,
    latest_audit:    latestAudit,
  }, null, 2);

  const prompt =
    `Aquí están las métricas de la última semana: ${summaryJson}. ` +
    `Identifica el mayor cuello de botella y propón 3 acciones tácticas concretas para próxima semana. ` +
    `Devuelve JSON: { bottleneck, root_cause, actions: [...3] }.`;

  let result;
  try {
    result = await runtime.run('Estratega', prompt, { brand_id: BRAND_ID });
  } catch (err) {
    const errMsg = (err.message || '').toLowerCase();
    if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Estratega: rate-limit detected, opening circuit breaker', { until });
    }
    throw err;
  }

  if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    await messenger.setState('gemini_circuit_open_until', until);
    throw new Error('Estratega LLM quota exhausted');
  }

  const raw = result.response || '';
  let review;
  try {
    review = JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { review = JSON.parse(match[0]); }
      catch (e2) { throw new Error(`Estratega JSON parse failed: ${e2.message}. Raw: ${raw.slice(0, 300)}`); }
    } else {
      throw new Error(`Estratega returned non-JSON. Raw: ${raw.slice(0, 300)}`);
    }
  }

  // Persist to weekly_review:<ISO week>
  const now = new Date();
  const isoWeek = `${now.getUTCFullYear()}-W${String(getISOWeek(now)).padStart(2, '0')}`;
  await messenger.setState(`weekly_review:${isoWeek}`, {
    ...review,
    generated_at: now.toISOString(),
  });
  await messenger.setState('last_weekly_review_at', now.toISOString());
  await messenger.setState('last_run_at', now.toISOString());

  log.info('Estratega: weekly review complete', { isoWeek, bottleneck: review.bottleneck });

  return { ok: true, review, isoWeek };
}

/** ISO week number helper (no external dep). */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Handles a single inbound message addressed to Estratega.
 * Supported types: weekly_strategy_review, tactic_request, pause
 * Anything else throws → caller nacks.
 *
 * @param {object} msg
 * @param {AgentMessenger} messenger
 * @param {AgentRuntime} runtime
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} log
 * @returns {Promise<object>}
 */
async function processEstrategaMessage(msg, messenger, runtime, supabase, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('Estratega: message_received', { msgId: msg.id, type });

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
        log.info('Estratega: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Estratega: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'Estratega', result: { duration_ms } };
  }

  // ── weekly_strategy_review ───────────────────────────────────
  if (type === 'weekly_strategy_review') {
    const { ok, review, isoWeek } = await runEstrategaWeeklyReview(supabase, messenger, runtime, log, msg.id);

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:        'weekly_strategy_review_result',
            isoWeek,
            bottleneck:  review.bottleneck,
            root_cause:  review.root_cause,
            actions:     review.actions,
          },
        });
      } catch (sendErr) {
        log.warn('Estratega: failed to send weekly_strategy_review_result', { err: sendErr.message });
      }
    }

    return { ok, isoWeek };
  }

  // ── tactic_request ───────────────────────────────────────────
  if (type === 'tactic_request') {
    const { topic, context } = payload;

    if (!topic) throw new Error('missing_topic');

    const prompt =
      `Propón una recomendación táctica concreta sobre: ${topic}.\n\n` +
      `Contexto adicional: ${context || 'ninguno'}.\n\n` +
      `Devuelve JSON: { recommendation, rationale, priority: 'high'|'medium'|'low' }.`;

    let result;
    try {
      result = await runtime.run('Estratega', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Estratega: rate-limit on tactic_request, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      throw new Error('Estratega LLM quota exhausted');
    }

    const raw = result.response || '';
    let tactic;
    try {
      tactic = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { tactic = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Estratega tactic JSON parse failed: ${e2.message}`); }
      } else {
        throw new Error(`Estratega tactic_request returned non-JSON. Raw: ${raw.slice(0, 300)}`);
      }
    }

    const stateKey = `last_tactic:${topic.slice(0, 40).replace(/\s+/g, '_')}`;
    await messenger.setState(stateKey, {
      ...tactic,
      topic,
      generated_at: new Date().toISOString(),
    });

    log.info('Estratega: tactic generated', { topic, priority: tactic.priority });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:           'tactic_result',
            topic,
            recommendation: tactic.recommendation,
            rationale:      tactic.rationale,
            priority:       tactic.priority,
          },
        });
      } catch (sendErr) {
        log.warn('Estratega: failed to send tactic reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'tactic_request', topic, priority: tactic.priority };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * Estratega autonomous cycle.
 * If >=7 days since last weekly review, runs it inline.
 * Otherwise no-op.
 */
async function runEstrategaAutonomousCycle(supabase, runtime, messenger, log) {
  const lastReviewAt = await messenger.getState('last_weekly_review_at');
  const sevenDaysMs = 7 * 24 * 60 * 60_000;

  if (!lastReviewAt || Date.now() - new Date(lastReviewAt).getTime() >= sevenDaysMs) {
    log.info('Estratega: 7d elapsed, running autonomous weekly review');
    try {
      await runEstrategaWeeklyReview(supabase, messenger, runtime, log, null);
    } catch (err) {
      log.error('Estratega: autonomous weekly review failed', { err: err.message });
    }
  } else {
    log.info('Estratega: within weekly review window, no action needed');
  }

  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Kai real-brain handler (Phase 6.7) ──────────────────────

/**
 * Handles a single inbound message addressed to Kai.
 * Supported types: social_post_request, weekly_content_calendar, pause
 * Anything else throws → caller nacks.
 */
async function processKaiMessage(msg, messenger, runtime, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('Kai: message_received', { msgId: msg.id, type });

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
        log.info('Kai: pause expired, resuming');
      }, duration_ms);
    }
    log.info('Kai: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'Kai', result: { duration_ms } };
  }

  // ── social_post_request ──────────────────────────────────────
  if (type === 'social_post_request') {
    const { topic, platform, tone = 'auténtico y cálido' } = payload;

    if (!topic) throw new Error('missing_topic');
    if (!platform) throw new Error('missing_platform');

    const prompt =
      `Diseña un post de ${platform} sobre "${topic}" para Empírika ` +
      `(consultora de crecimiento digital, audiencia LATAM). ` +
      `Tono: ${tone}. ` +
      `Devuelve JSON: { caption, hashtags, cta, platform_specific_tips }.`;

    let result;
    try {
      result = await runtime.run('Kai', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Kai: rate-limit detected, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('Kai: quota exhausted, opening circuit breaker', { until });
      throw new Error('Kai LLM quota exhausted');
    }

    const raw = result.response || '';
    let post;
    try {
      post = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { post = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Kai JSON parse failed: ${e2.message}. Raw: ${raw.slice(0, 300)}`); }
      } else {
        throw new Error(`Kai returned non-JSON. Raw: ${raw.slice(0, 300)}`);
      }
    }

    const isoDate = new Date().toISOString().slice(0, 10);
    await messenger.setState(`last_post:${platform}:${isoDate}`, {
      topic,
      platform,
      ...post,
      generated_at: new Date().toISOString(),
    });

    log.info('Kai: social post generated', { platform, topic });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:     'social_post_ready',
            platform,
            topic,
            caption:  post.caption,
            hashtags: post.hashtags,
            cta:      post.cta,
          },
        });
      } catch (sendErr) {
        log.warn('Kai: failed to send social_post_ready reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'social_post_request', platform, topic };
  }

  // ── weekly_content_calendar ──────────────────────────────────
  if (type === 'weekly_content_calendar') {
    const { themes = [] } = payload;

    const prompt =
      `Crea un calendario de contenido de 7 días para Empírika (consultoría crecimiento digital, LATAM). ` +
      `Temas a cubrir: ${themes.length > 0 ? themes.join(', ') : 'crecimiento de negocios latinos, casos de éxito, tips digitales'}. ` +
      `Un post por día, plataformas mixtas (instagram, facebook, linkedin, tiktok). ` +
      `Devuelve JSON: { week_start, days: [{ date, platform, caption, hashtags, cta }] }.`;

    let result;
    try {
      result = await runtime.run('Kai', prompt, { brand_id: BRAND_ID });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('Kai: rate-limit on weekly_content_calendar, opening circuit breaker', { until });
      }
      throw err;
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      throw new Error('Kai LLM quota exhausted');
    }

    const raw = result.response || '';
    let calendar;
    try {
      calendar = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { calendar = JSON.parse(match[0]); }
        catch (e2) { throw new Error(`Kai calendar JSON parse failed: ${e2.message}. Raw: ${raw.slice(0, 300)}`); }
      } else {
        throw new Error(`Kai weekly_content_calendar returned non-JSON. Raw: ${raw.slice(0, 300)}`);
      }
    }

    const isoWeekKey = `last_calendar:${new Date().toISOString().slice(0, 10)}`;
    await messenger.setState(isoWeekKey, {
      ...calendar,
      themes,
      generated_at: new Date().toISOString(),
    });

    log.info('Kai: weekly content calendar generated', { themes });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:     'weekly_content_calendar_ready',
            calendar,
          },
        });
      } catch (sendErr) {
        log.warn('Kai: failed to send weekly_content_calendar_ready reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'weekly_content_calendar' };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * Kai autonomous cycle — reactive only. Logs idle + stamps last_run_at.
 */
async function runKaiAutonomousCycle(messenger, log) {
  log.info('Kai: idle, awaiting social_post_request or weekly_content_calendar messages');
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── DaVinci real-brain handler (Phase 6.8) ──────────────────

/**
 * Handles a single inbound message addressed to DaVinci.
 * Supported types: generate_visual, pause
 * Anything else throws → caller nacks.
 */
async function processDaVinciMessage(msg, messenger, runtime, log) {
  const payload = msg.payload ?? {};
  const { type } = payload;

  log.info('DaVinci: message_received', { msgId: msg.id, type });

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
        log.info('DaVinci: pause expired, resuming');
      }, duration_ms);
    }
    log.info('DaVinci: paused by owner', { duration_ms });
    return { ok: true, type: 'pause', agent: 'DaVinci', result: { duration_ms } };
  }

  // ── generate_visual ──────────────────────────────────────────
  if (type === 'generate_visual') {
    const {
      brand_id = BRAND_ID,
      kind,
      prompt_seed,
      style_notes = '',
    } = payload;

    if (!kind) throw new Error('missing_kind');
    if (!prompt_seed) throw new Error('missing_prompt_seed');

    const kindLabels = {
      email_hero:    'hero image for a cold outreach email',
      instagram_post: 'Instagram square post (1080x1080)',
      fb_ad:         'Facebook Ad mockup',
      web_banner:    'website hero banner',
    };
    const kindLabel = kindLabels[kind] || kind;

    const prompt =
      `Genera un ${kindLabel} para Empírika (consultoría digital LATAM). ` +
      `Concepto: ${prompt_seed}. ` +
      `${style_notes ? `Notas de estilo: ${style_notes}.` : ''} ` +
      `Usa generate_gemini_imagen_visual con un prompt detallado (mín 100 palabras). ` +
      `Devuelve JSON: { visual_asset_url, magnet_type, decision_reasoning }.`;

    const timestamp = new Date().toISOString();
    let result;
    try {
      result = await runtime.run('DaVinci', prompt, { brand_id });
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota')) {
        const until = new Date(Date.now() + 5 * 60_000).toISOString();
        await messenger.setState('gemini_circuit_open_until', until);
        log.warn('DaVinci: rate-limit detected, opening circuit breaker', { until });
      }
      // Image gen failure — reply with failure message, don't rethrow (non-crashing)
      log.warn('DaVinci: generate_visual runtime failed', { kind, err: err.message });
      const replyTo = msg.from_agent;
      if (replyTo) {
        try {
          await messenger.send({
            to: replyTo,
            payload: {
              type:         'visual_generation_failed',
              kind,
              reason:       err.message,
            },
          });
        } catch (sendErr) {
          log.warn('DaVinci: failed to send visual_generation_failed', { err: sendErr.message });
        }
      }
      return { ok: false, type: 'generate_visual', kind, failed: true, reason: err.message };
    }

    if (result.quotaExhausted || (result.response || '').includes('QUOTA_EXHAUSTED')) {
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      await messenger.setState('gemini_circuit_open_until', until);
      log.warn('DaVinci: quota exhausted, opening circuit breaker', { until });
      const replyTo = msg.from_agent;
      if (replyTo) {
        try {
          await messenger.send({
            to: replyTo,
            payload: { type: 'visual_generation_failed', kind, reason: 'quota_exhausted' },
          });
        } catch (sendErr) {
          log.warn('DaVinci: failed to send quota_exhausted reply', { err: sendErr.message });
        }
      }
      return { ok: false, type: 'generate_visual', kind, failed: true, reason: 'quota_exhausted' };
    }

    // Parse URL/path from LLM response
    const raw = result.response || '';
    let visualResult;
    try {
      visualResult = JSON.parse(raw);
    } catch (_) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { visualResult = JSON.parse(match[0]); }
        catch (e2) {
          log.warn('DaVinci: JSON parse failed, using raw as url fallback', { err: e2.message });
          visualResult = { visual_asset_url: null };
        }
      } else {
        visualResult = { visual_asset_url: null };
      }
    }

    const url = visualResult?.visual_asset_url ?? null;

    // Persist last_visual state
    const stateKey = `last_visual:${kind}:${timestamp}`;
    await messenger.setState(stateKey, {
      kind,
      url,
      brand_id,
      prompt_seed,
      generated_at: timestamp,
    });

    log.info('DaVinci: visual generated', { kind, url });

    const replyTo = msg.from_agent;
    if (replyTo) {
      try {
        await messenger.send({
          to: replyTo,
          payload: {
            type:         'visual_generated',
            kind,
            url,
            generated_at: timestamp,
          },
        });
      } catch (sendErr) {
        log.warn('DaVinci: failed to send visual_generated reply', { err: sendErr.message });
      }
    }

    return { ok: true, type: 'generate_visual', kind, url };
  }

  // ── unknown_message_type ─────────────────────────────────────
  throw new Error(`unknown_message_type: ${type}`);
}

/**
 * DaVinci autonomous cycle — reactive only. Logs idle + stamps last_run_at.
 */
async function runDaVinciAutonomousCycle(messenger, log) {
  log.info('DaVinci: idle, awaiting generate_visual messages');
  await messenger.setState('last_run_at', new Date().toISOString());
}

// ── Atlas: fleet observability (deterministic) ───────────────

/**
 * Atlas inbound message handler.
 * Supported types:
 *   audit_now — run an audit immediately (bypasses Atlas cooldown).
 *   any other type → ack with scaffold result.
 */
async function processAtlasMessage(msg, messenger, supabase, log) {
  const { type } = msg.payload ?? {};
  log.info('Atlas: agent_message_received', { msgId: msg.id, type });

  await messenger.setState('last_inbound', {
    type, msg_id: msg.id, received_at: new Date().toISOString(),
  });

  if (type === 'pause' || type === 'resume') {
    return processIncomingMessage(msg, messenger, 'Atlas', log);
  }

  if (type === 'audit_now') {
    try {
      const verdict = await runAtlasAudit({
        supabase,
        brandId: BRAND_ID,
        messenger,
        log,
      });
      // audit_now does NOT advance the cooldown clock — keeps the next regular
      // proactive cycle on schedule (auditor finding F11).
      await messenger.setState('last_audit_verdict', verdict);
      return { ok: true, type: 'audit_now', agent: 'Atlas', result: verdict };
    } catch (err) {
      log.error('Atlas: audit_now threw', { err: err.message });
      return { ok: false, type: 'audit_now', agent: 'Atlas', error: err.message };
    }
  }

  if (!type) throw new Error('unknown_message_type: ' + type);
  return { ok: true, scaffold: true, agent: 'Atlas', type };
}

/**
 * Atlas autonomous cycle: heartbeat-frequency audit with internal cooldown.
 * Runs an audit every ATLAS_AUDIT_COOLDOWN_MS, persists verdict, and
 * (inside runAtlasAudit) alerts Manager if CRITICAL.
 */
async function runAtlasAuditCycle(supabase, runtime, messenger, log) {
  // ── Wrap the entire cycle in a try/catch — auditor finding F3.
  // Atlas can never crash the multiplexed worker that hosts the
  // other 7 agents. If anything blows up, log it and move on.
  try {
    const lastAuditAt = await messenger.getState('last_audit_at');
    if (lastAuditAt && Date.now() - new Date(lastAuditAt).getTime() < ATLAS_AUDIT_COOLDOWN_MS) {
      log.debug('Atlas: audit skipped (within cooldown)', { lastAuditAt });
      await messenger.setState('last_run_at', new Date().toISOString());
      return;
    }

    const verdict = await runAtlasAudit({
      supabase,
      brandId: BRAND_ID,
      messenger,
      log,
    });
    await messenger.setState('last_audit_at', new Date().toISOString());
    await messenger.setState('last_audit_verdict', verdict);
    await messenger.setState('last_run_at', new Date().toISOString());

    // Daily narrative report — opportunistic, never blocks the cycle.
    try {
      await maybeGenerateDailyReport({ supabase, brandId: BRAND_ID, runtime, messenger, log });
    } catch (reportErr) {
      log.warn('Atlas: daily report failed', { err: reportErr.message });
    }
  } catch (cycleErr) {
    log.error('Atlas: cycle failed (contained — worker continues)', {
      err: cycleErr.message,
      stack: cycleErr.stack,
    });
    // Stamp last_run_at so the cooldown still progresses; otherwise a
    // persistent error would loop-thrash the audit.
    try {
      await messenger.setState('last_run_at', new Date().toISOString());
    } catch (_) { /* swallow */ }
  }
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
          } else if (canonicalName === 'Angela') {
            result = await processAngelaMessage(msg, messenger, runtime, log);
          } else if (canonicalName === 'Carlos Empirika') {
            result = await processCarlosMessage(msg, messenger, runtime, log);
          } else if (canonicalName === 'Estratega') {
            result = await processEstrategaMessage(msg, messenger, runtime, supabase, log);
          } else if (canonicalName === 'Kai') {
            result = await processKaiMessage(msg, messenger, runtime, log);
          } else if (canonicalName === 'DaVinci') {
            result = await processDaVinciMessage(msg, messenger, runtime, log);
          } else if (canonicalName === 'Atlas') {
            result = await processAtlasMessage(msg, messenger, supabase, log);
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

      // Autonomous cycle — route to per-agent real cycle or scaffold
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          if (canonicalName === 'scout') {
            await runScoutSourcingCycle(supabase, runtime, messenger, log, null);
          } else if (canonicalName === 'Verifier') {
            await runVerifierAutonomousCycle(messenger, log);
          } else if (canonicalName === 'Angela') {
            await runAngelaAutonomousCycle(supabase, messenger, log);
          } else if (canonicalName === 'Carlos Empirika') {
            await runCarlosAutonomousCycle(messenger, log);
          } else if (canonicalName === 'Estratega') {
            await runEstrategaAutonomousCycle(supabase, runtime, messenger, log);
          } else if (canonicalName === 'Kai') {
            await runKaiAutonomousCycle(messenger, log);
          } else if (canonicalName === 'DaVinci') {
            await runDaVinciAutonomousCycle(messenger, log);
          } else if (canonicalName === 'Atlas') {
            await runAtlasAuditCycle(supabase, runtime, messenger, log);
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
