// ============================================================
// scripts/morning_briefing.js — Layer 2 morning ritual (Week 1: REPORT-ONLY)
//
// Reads unacknowledged autonomy_audits rows + heartbeat staleness and
// prints a categorized human-readable report plus a machine-readable
// JSON dispatch plan. The Claude session skill (empirika-briefing)
// consumes the JSON block and decides (per whitelist) whether to
// invoke ralph.
//
// Week 1 mode: --report-only (default) -> no dispatches are declared.
// Week 2+ unlocks dispatch by removing --report-only.
//
// Plan: .omc/plans/autonomy-3layer-v2.md §B.4
//
// Usage:
//   node scripts/morning_briefing.js            # default: report-only
//   node scripts/morning_briefing.js --with-dispatch
//   node scripts/morning_briefing.js --brand=<uuid>  # default: EMPIRIKA
// ============================================================

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { WHITELIST, decisionFor, escalateIfNeeded, _AUTO_ACTIONS } from '../lib/autonomy_whitelist.js';

const EMPIRIKA_BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const HEARTBEAT_STALE_HOURS = 36;
const STALENESS_BANNER_HOURS = 336; // 14d — plan §B.4 A2
const DEFAULT_DISPATCH_CAP = 3;
const DEFAULT_BUDGET_CAP_USD = 10; // plan §B.4 A8 — lowered from $25 until ≥3 successful auto-dispatches/7d

export { WHITELIST, decisionFor, escalateIfNeeded };

function parseArgs(argv) {
  const args = { brand: EMPIRIKA_BRAND_ID, reportOnly: true, dispatchCap: DEFAULT_DISPATCH_CAP, budgetCap: DEFAULT_BUDGET_CAP_USD };
  for (const a of argv.slice(2)) {
    if (a === '--with-dispatch') args.reportOnly = false;
    else if (a === '--report-only') args.reportOnly = true;
    else if (a.startsWith('--brand=')) args.brand = a.slice('--brand='.length);
    else if (a.startsWith('--cap=')) args.dispatchCap = Number(a.slice(6));
    else if (a.startsWith('--budget=')) args.budgetCap = Number(a.slice(9));
  }
  return args;
}

async function fetchHeartbeat(brandId) {
  const { data, error } = await supabase
    .from('autonomy_audits')
    .select('created_at, value, details')
    .eq('brand_id', brandId)
    .eq('metric_name', 'AUDITOR_HEARTBEAT')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function fetchUnackedAudits(brandId) {
  const { data, error } = await supabase
    .from('autonomy_audits')
    .select('id, metric_name, value, severity, suggested_action, threshold_hit, details, created_at')
    .eq('brand_id', brandId)
    .is('acknowledged_at', null)
    .neq('metric_name', 'AUDITOR_HEARTBEAT')
    .order('severity', { ascending: false })  // 'red' > 'yellow' > 'green' > 'error' lexicographically; adjust below
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  // Re-sort severity by explicit priority (red > error > yellow > green).
  const order = { red: 0, error: 1, yellow: 2, green: 3 };
  return (data || []).sort((a, b) => {
    const d = (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    if (d !== 0) return d;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

// Plan §B.4 A2 — on-boot helper: surface AUTO whitelist entries whose
// oldest unacked audit exceeds the staleness banner threshold. Pure
// read, never writes a row to autonomy_audits (retired V3 metric).
async function fetchStaleAutoActions(brandId) {
  const since = new Date(Date.now() - STALENESS_BANNER_HOURS * 3600_000).toISOString();
  const { data, error } = await supabase
    .from('autonomy_audits')
    .select('suggested_action, created_at')
    .eq('brand_id', brandId)
    .is('acknowledged_at', null)
    .lt('created_at', since)
    .in('suggested_action', _AUTO_ACTIONS);
  if (error) return [];
  const byAction = {};
  for (const r of data || []) {
    if (!r.suggested_action) continue;
    const prev = byAction[r.suggested_action];
    if (!prev || new Date(r.created_at) < new Date(prev.oldest_created_at)) {
      byAction[r.suggested_action] = {
        action: r.suggested_action,
        oldest_created_at: r.created_at,
        age_hours: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 3600_000),
      };
    }
  }
  return Object.values(byAction);
}

async function fetchTodayBudgetSpent(brandId) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('autonomy_briefings')
    .select('budget_spent_usd')
    .eq('brand_id', brandId)
    .gte('created_at', startOfDay.toISOString());
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + Number(r.budget_spent_usd || 0), 0);
}

function fmtAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function sevBadge(sev) {
  return { red: '🔴', yellow: '🟡', green: '🟢', error: '⚠️' }[sev] || '·';
}

function printStalenessBanner(staleActions) {
  if (!staleActions || staleActions.length === 0) return;
  console.log(`\n⏰ STALE AUTO-ACTIONS (unacked >${STALENESS_BANNER_HOURS}h / ${(STALENESS_BANNER_HOURS/24)|0}d):`);
  for (const s of staleActions) {
    console.log(`   · ${s.action.padEnd(40)} oldest=${s.age_hours}h — rule may be dead or threshold wrong`);
  }
}

function printReport({ brand, heartbeat, audits, budgetSpent, cap, reportOnly, staleActions }) {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  EMPÍRIKA MORNING BRIEFING — ${today} UTC`);
  console.log(`  brand_id=${brand}`);
  console.log(`  mode=${reportOnly ? 'REPORT_ONLY' : 'DISPATCH_ACTIVE'}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Heartbeat check
  if (!heartbeat) {
    console.log(`❗ HEARTBEAT: NEVER WRITTEN — auditor may not be running`);
  } else {
    const age = fmtAge(heartbeat.created_at);
    const ms = Date.now() - new Date(heartbeat.created_at).getTime();
    const stale = ms > HEARTBEAT_STALE_HOURS * 3600_000;
    console.log(`${stale ? '🚨' : '💓'} heartbeat: ${age} ago (${heartbeat.created_at})${stale ? ' — STALE >36h — ALERT' : ''}`);
  }
  console.log(`💵 budget spent today: $${budgetSpent.toFixed(2)} / $${cap.toFixed(2)}`);
  printStalenessBanner(staleActions);

  // Categorize
  const reds   = audits.filter(a => a.severity === 'red');
  const errors = audits.filter(a => a.severity === 'error');
  const yels   = audits.filter(a => a.severity === 'yellow');
  const grns   = audits.filter(a => a.severity === 'green');

  console.log(`\n  🔴 ${reds.length} red   ⚠️  ${errors.length} error   🟡 ${yels.length} yellow   🟢 ${grns.length} green   (total unacked: ${audits.length})\n`);

  const printBucket = (title, rows) => {
    if (rows.length === 0) return;
    console.log(`\n── ${title} ─────────────────────────────────────────────`);
    for (const r of rows) {
      const action = r.suggested_action || '—';
      const val = r.value != null ? `= ${r.value}` : '';
      console.log(`  ${sevBadge(r.severity)} ${r.metric_name.padEnd(40)} ${val.padEnd(12)} → ${action}   (${fmtAge(r.created_at)} ago)`);
      if (r.details && Object.keys(r.details).length > 0) {
        const keys = Object.keys(r.details).slice(0, 3);
        const bits = keys.map(k => `${k}=${JSON.stringify(r.details[k]).slice(0, 40)}`).join(' ');
        console.log(`      └─ ${bits}`);
      }
    }
  };

  printBucket('RED (requires attention)',         reds);
  printBucket('ERROR (auditor sub-query failed)', errors);
  printBucket('YELLOW (watch)',                   yels);
  if (grns.length > 0) console.log(`\n  (🟢 green rows omitted from report: ${grns.length})`);
}

export function buildDispatchPlan({ audits, reportOnly, cap, budgetSpent, budgetCap }) {
  const candidates = audits
    .filter(a => a.severity === 'red')
    .map(a => {
      // A1 escalation: WA delivery red with denom≥10 AND rate>60 → override action.
      const esc = escalateIfNeeded(a);
      const effective_action = esc?.suggested_action || a.suggested_action;
      const { decision, rationale } = decisionFor(effective_action);
      return {
        audit_id: a.id,
        metric: a.metric_name,
        suggested_action: effective_action,
        original_action: esc ? a.suggested_action : undefined,
        escalated: !!esc,
        decision,
        rationale,
      };
    });

  if (reportOnly) {
    return {
      mode: 'REPORT_ONLY',
      dispatches: [],
      downgraded: candidates.map(c => ({ ...c, effective_decision: 'REPORT_ONLY', reason: 'week1_report_only_flag' })),
      budget: { spent_usd: budgetSpent, cap_usd: budgetCap },
    };
  }

  const dispatches = [];
  const downgraded = [];
  for (const c of candidates) {
    if (dispatches.length >= cap) {
      downgraded.push({ ...c, effective_decision: 'REPORT_ONLY', reason: 'session_dispatch_cap_hit' });
      continue;
    }
    if (c.decision !== 'AUTO') {
      downgraded.push({ ...c, effective_decision: 'REPORT_ONLY', reason: `whitelist=${c.decision}` });
      continue;
    }
    // Budget pre-check: assume worst-case $15/dispatch (plan S2).
    if (budgetSpent + (dispatches.length + 1) * 15 > budgetCap) {
      downgraded.push({ ...c, effective_decision: 'REPORT_ONLY', reason: 'budget_cap_pre_flight' });
      continue;
    }
    dispatches.push({ ...c, effective_decision: 'AUTO' });
  }

  return {
    mode: 'DISPATCH_ACTIVE',
    dispatches,
    downgraded,
    budget: { spent_usd: budgetSpent, cap_usd: budgetCap },
  };
}

async function writeBriefingLedger({ brandId, sessionId, audits, plan, budgetSpent }) {
  try {
    await supabase.from('autonomy_briefings').insert({
      brand_id: brandId,
      session_id: sessionId,
      audits_read_count: audits.length,
      audits_dispatched_count: plan.dispatches.length,
      budget_spent_usd: budgetSpent,
      details: { mode: plan.mode, downgraded_count: plan.downgraded.length },
    });
  } catch (err) {
    console.error(`[briefing] ledger write failed: ${err.message}`);
  }
}

async function main() {
  if (!supabase) {
    console.error('FATAL: no supabase client (check SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
  }
  const args = parseArgs(process.argv);
  const sessionId = randomUUID();

  const [heartbeat, audits, budgetSpent, staleActions] = await Promise.all([
    fetchHeartbeat(args.brand),
    fetchUnackedAudits(args.brand),
    fetchTodayBudgetSpent(args.brand),
    fetchStaleAutoActions(args.brand),
  ]);

  printReport({
    brand: args.brand,
    heartbeat,
    audits,
    budgetSpent,
    cap: args.budgetCap,
    reportOnly: args.reportOnly,
    staleActions,
  });

  const plan = buildDispatchPlan({
    audits,
    reportOnly: args.reportOnly,
    cap: args.dispatchCap,
    budgetSpent,
    budgetCap: args.budgetCap,
  });

  console.log(`\n═══ DISPATCH PLAN (JSON for skill consumption) ═══`);
  console.log(JSON.stringify({ session_id: sessionId, brand_id: args.brand, generated_at: new Date().toISOString(), plan }, null, 2));
  console.log(`═══════════════════════════════════════════════════\n`);

  await writeBriefingLedger({ brandId: args.brand, sessionId, audits, plan, budgetSpent });
}

// Run as CLI only when invoked directly (not when imported by tests).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[briefing] FATAL:', err?.message || err);
    process.exit(1);
  });
}
