// scripts/agent_status.js — Owner-facing agent status CLI
// Usage: node scripts/agent_status.js
// Shows live status of every Empírika agent with heartbeat, inbox, and last-run.

import 'dotenv/config';
import { supabase } from '../lib/supabase.js';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  cyan: '\x1b[36m', white: '\x1b[97m' };

const ROSTER = ['Helena','Manager','Scout','Carlos','Sam','Kai','Verifier','Angela','DaVinci','Estratega'];
const STALE_MS = 2 * 60 * 1000; // 2 minutes

function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'future';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function pad(str, len) {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  return str + ' '.repeat(Math.max(0, len - plain.length));
}

async function fetchAll() {
  const [procRes, msgRes, stateRes] = await Promise.all([
    supabase.from('agent_processes').select('agent_name,process_id,started_at,last_heartbeat_at,status,host'),
    supabase.from('agent_messages').select('to_agent,status'),
    supabase.from('agent_state').select('agent_name,last_run_at,gemini_circuit_open_until,paused_by_owner'),
  ]);
  return {
    procs:  procRes.data  || [],
    msgs:   msgRes.data   || [],
    states: stateRes.data || [],
  };
}

function buildRow(name, idx, { procs, msgs, states }) {
  const isDup = ROSTER.indexOf(name) !== idx;
  const label = isDup ? `${name}${C.gray}(?dup?)${C.reset}` : name;

  // agent_processes: pick most-recent row for this agent
  const proc = procs
    .filter(p => p.agent_name === name)
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0];

  // Status + color
  let statusLabel, statusColor;
  if (!proc) {
    statusLabel = 'NOT DEPLOYED'; statusColor = C.gray;
  } else if (proc.status === 'running') {
    const stale = !proc.last_heartbeat_at || Date.now() - new Date(proc.last_heartbeat_at).getTime() > STALE_MS;
    statusLabel = stale ? 'STALE' : 'ALIVE';
    statusColor = stale ? C.yellow : C.green;
  } else if (proc.status === 'crashed') {
    statusLabel = 'CRASHED'; statusColor = C.red;
  } else {
    statusLabel = 'STOPPED'; statusColor = C.dim;
  }
  const icon = { ALIVE:'🟢', STALE:'🟡', CRASHED:'🔴', STOPPED:'⚫', 'NOT DEPLOYED':'⚪' }[statusLabel];
  const statusStr = `${icon} ${statusColor}${statusLabel}${C.reset}`;

  const lastSeen = proc?.last_heartbeat_at ? relTime(proc.last_heartbeat_at) : '—';

  // Inbox: pending / claimed counts
  const agentMsgs = msgs.filter(m => m.to_agent === name);
  const pending = agentMsgs.filter(m => m.status === 'pending').length;
  const claimed = agentMsgs.filter(m => m.status === 'claimed').length;
  const inbox = proc ? `${pending}/${claimed}` : '—';

  // agent_state
  const st = states.find(s => s.agent_name === name);
  const lastRun = st?.last_run_at ? relTime(st.last_run_at) : '—';

  let notes = '—';
  if (st?.paused_by_owner) {
    notes = '⏸ paused';
  } else if (st?.gemini_circuit_open_until) {
    const until = new Date(st.gemini_circuit_open_until);
    if (until > new Date()) notes = `⛔ rate-limited until ${until.toUTCString().slice(17, 22)}`;
  }
  if (!proc) notes = 'Phase 2 pending';

  return { label, statusStr, lastSeen, inbox, lastRun, notes };
}

async function main() {
  if (!supabase) { console.error('FATAL: no supabase client (check env vars)'); process.exit(1); }

  const now = new Date().toISOString();
  console.log(`\n${C.cyan}╭${'─'.repeat(66)}╮`);
  console.log(`│  🤖 Empírika Agent Status — ${now.slice(0,19)}Z${' '.repeat(Math.max(0, 37 - now.slice(0,19).length))}│`);
  console.log(`╰${'─'.repeat(66)}╯${C.reset}\n`);

  const data = await fetchAll();

  const hdr = `${pad('Agent', 16)}${pad('Status', 22)}${pad('Last seen', 17)}${pad('Inbox', 7)}${pad('Last run', 16)}Notes`;
  console.log(C.bold + hdr + C.reset);
  console.log('─'.repeat(84));

  let alive = 0, pending = 0, paused = 0;
  for (let i = 0; i < ROSTER.length; i++) {
    const name = ROSTER[i];
    const r = buildRow(name, i, data);
    if (r.statusStr.includes('ALIVE')) alive++;
    if (r.notes.includes('paused')) paused++;
    const msgParts = data.msgs.filter(m => m.to_agent === name && m.status === 'pending');
    pending += msgParts.length;
    console.log(
      `${pad(r.label, 16)}${pad(r.statusStr, 22)}${pad(r.lastSeen, 17)}${pad(r.inbox, 7)}${pad(r.lastRun, 16)}${r.notes}`
    );
  }

  console.log(`\n${C.dim}Summary: ${C.white}${alive}/${ROSTER.length} agents alive${C.dim} · ${pending} messages pending · ${paused} paused${C.reset}\n`);
  process.exit(0);
}

main().catch(err => { console.error('FATAL:', err?.message || err); process.exit(1); });
