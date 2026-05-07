// ============================================================
// workers/fleet_autonomous.js — Fleet Multiplexed Worker (Phase 5)
//
// ONE long-lived Node process that hosts 7 Empírika agents
// concurrently inside a single Render starter worker ($7-14/mo
// vs $77/mo for 11 separate workers — auditor recommendation I4).
//
// Agents hosted:
//   scout        — lead prospection
//   Carlos Empirika — Chief Sales Strategist
//   Kai          — Social Media Strategist
//   Verifier     — outbound email QA
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
// Real per-agent LLM logic ships in Phase 6.
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

const VERSION = '5.0.0';
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SLEEP_MS = Number(process.env.FLEET_SLEEP_MS_PER_AGENT ?? 25_000);
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
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
          const result = await processIncomingMessage(msg, messenger, canonicalName, log);
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

      // Autonomous cycle (no-op in Phase 5)
      const runCycle = await shouldRunAutonomously(messenger, msgs.length);
      if (runCycle) {
        try {
          await runScaffoldAutonomousCycle(messenger, canonicalName, log);
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
