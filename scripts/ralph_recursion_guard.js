// ============================================================
// scripts/ralph_recursion_guard.js — Week 0 P2
//
// Prevents ralph runs spawned by the morning_briefing skill from
// spawning additional ralph / autopilot sub-runs. Ralph itself
// has no native recursion guard (confirmed by Architect review
// against ~/.claude/skills/ralph/SKILL.md).
//
// Usage:
//   node scripts/ralph_recursion_guard.js acquire --spawned-by=morning_briefing
//   node scripts/ralph_recursion_guard.js check        # exit 0 if safe to spawn
//   node scripts/ralph_recursion_guard.js release      # remove lock after run
//
// Lock file: .omc/state/ralph-spawn-lock (JSON)
// Stale lock TTL: 2 hours (morning_briefing session wallclock ceiling).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const LOCK_DIR  = path.join(REPO_ROOT, '.omc', 'state');
const LOCK_PATH = path.join(LOCK_DIR, 'ralph-spawn-lock');
const TTL_MS    = 2 * 60 * 60 * 1000;

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > TTL_MS) {
      fs.unlinkSync(LOCK_PATH);
      return null;
    }
    return obj;
  } catch {
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    return null;
  }
}

function acquire(args) {
  const spawnedBy = (args.find(a => a.startsWith('--spawned-by=')) || '').split('=')[1] || 'unknown';
  const existing = readLock();
  if (existing) {
    console.error(`[guard] lock already held by ${existing.spawned_by} pid=${existing.parent_pid} ts=${new Date(existing.ts).toISOString()}`);
    process.exit(2);
  }
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const payload = { spawned_by: spawnedBy, parent_pid: process.ppid, ts: Date.now() };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2));
  console.log(`[guard] acquired by ${spawnedBy}`);
  process.exit(0);
}

function check() {
  const lock = readLock();
  if (!lock) {
    process.exit(0);
  }
  console.error(`[guard] REFUSE: inside ralph spawn-lock (spawned_by=${lock.spawned_by}). Sub-spawning another ralph/autopilot run is forbidden.`);
  process.exit(3);
}

function release() {
  if (fs.existsSync(LOCK_PATH)) {
    fs.unlinkSync(LOCK_PATH);
    console.log('[guard] released');
  } else {
    console.log('[guard] no lock to release');
  }
  process.exit(0);
}

const cmd = process.argv[2];
const rest = process.argv.slice(3);

switch (cmd) {
  case 'acquire': acquire(rest); break;
  case 'check':   check(); break;
  case 'release': release(); break;
  default:
    console.error('usage: ralph_recursion_guard.js <acquire|check|release> [--spawned-by=X]');
    process.exit(1);
}
