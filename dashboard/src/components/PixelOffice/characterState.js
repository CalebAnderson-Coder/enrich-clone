// characterState.js
// Per-character state machine + BFS pathfinder. Pure functions so the
// renderer can stay dumb. Positions are in TILE coords (floats during walk).

import { AGENTS, AGENT_IDS, GRID_W, GRID_H } from './agentRegistry.js';
import { isWalkable } from './officeMap.js';

export const STATES = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
  READ: 'read',
  BLOCKED: 'blocked',
});

export const DIRS = Object.freeze({
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
});

// Initial character set — everyone starts at their desk-stand tile, idle.
export function createInitialCharacters() {
  const chars = {};
  for (const id of AGENT_IDS) {
    const a = AGENTS[id];
    chars[id] = {
      id,
      position: { x: a.deskStand.x, y: a.deskStand.y },
      target: null,
      path: [],
      state: STATES.IDLE,
      dir: DIRS.DOWN,
      frame: 0,
      frameTimer: 0,
      bubble: null,            // { text, color, until }
      stateUntil: 0,           // ms timestamp when current non-walk state expires
      lastEventTs: performance.now(),
      walkSpeed: 3.5,          // tiles per second
    };
  }
  return chars;
}

// Breadth-first path from (sx,sy) to (tx,ty) on the office grid.
// Returns array of {x,y} tile steps (excluding start). Empty array if unreachable.
export function bfsPath(sx, sy, tx, ty) {
  sx = Math.round(sx); sy = Math.round(sy);
  tx = Math.round(tx); ty = Math.round(ty);
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * GRID_W + x;
  const visited = new Uint8Array(GRID_W * GRID_H);
  const prev = new Int32Array(GRID_W * GRID_H).fill(-1);
  const queue = [key(sx, sy)];
  visited[key(sx, sy)] = 1;
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  while (queue.length) {
    const cur = queue.shift();
    const cx = cur % GRID_W, cy = (cur / GRID_W) | 0;
    if (cx === tx && cy === ty) { found = true; break; }
    for (const [dx, dy] of N) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const k = key(nx, ny);
      if (visited[k]) continue;
      // Allow destination even if "not walkable" only if it's the target
      // (agents stand adjacent to desks, so this shouldn't trigger — but safe).
      if (!isWalkable(nx, ny) && !(nx === tx && ny === ty)) continue;
      visited[k] = 1;
      prev[k] = cur;
      queue.push(k);
    }
  }
  if (!found) return [];
  const path = [];
  let c = key(tx, ty);
  while (c !== key(sx, sy)) {
    const cx = c % GRID_W, cy = (c / GRID_W) | 0;
    path.push({ x: cx, y: cy });
    c = prev[c];
    if (c < 0) break;
  }
  return path.reverse();
}

// Set a walk target for a character. Computes the path immediately.
export function sendTo(ch, tx, ty) {
  const path = bfsPath(ch.position.x, ch.position.y, tx, ty);
  if (!path.length) return false;
  ch.path = path;
  ch.target = { x: tx, y: ty };
  ch.state = STATES.WALK;
  return true;
}

// Advance one character by dt seconds. Handles walking along the path and
// timing out temporary states (type/read/blocked → idle).
export function tickCharacter(ch, dt, now) {
  // Expire timed states
  if (ch.state !== STATES.WALK && ch.stateUntil && now > ch.stateUntil) {
    ch.state = STATES.IDLE;
    ch.stateUntil = 0;
  }
  if (ch.bubble && ch.bubble.until && now > ch.bubble.until) {
    ch.bubble = null;
  }

  // Walk animation frame cycle
  ch.frameTimer += dt;
  const frameRate = ch.state === STATES.WALK ? 0.14 : 0.4;
  if (ch.frameTimer >= frameRate) {
    ch.frameTimer = 0;
    ch.frame = (ch.frame + 1) % 4;
  }

  if (ch.state !== STATES.WALK) return;

  // Move toward next path node
  const next = ch.path[0];
  if (!next) {
    ch.state = STATES.IDLE;
    ch.target = null;
    return;
  }
  const dx = next.x - ch.position.x;
  const dy = next.y - ch.position.y;
  const dist = Math.hypot(dx, dy);
  // Facing
  if (Math.abs(dx) > Math.abs(dy)) {
    ch.dir = dx > 0 ? DIRS.RIGHT : DIRS.LEFT;
  } else if (dy !== 0) {
    ch.dir = dy > 0 ? DIRS.DOWN : DIRS.UP;
  }
  const step = ch.walkSpeed * dt;
  if (dist <= step) {
    ch.position.x = next.x;
    ch.position.y = next.y;
    ch.path.shift();
    if (ch.path.length === 0) {
      ch.state = STATES.IDLE;
      ch.target = null;
    }
  } else {
    ch.position.x += (dx / dist) * step;
    ch.position.y += (dy / dist) * step;
  }
}

// --- Event → state translator ----------------------------------------------

const TYPE_TOOLS = new Set(['save_lead', 'search_web', 'update_mega_profile']);

// Apply a single event to the character registry. Idempotent on already-seen
// event ids (caller is responsible for not replaying).
export function applyEvent(characters, event, now) {
  if (!event || !event.agent) return;
  const ch = characters[event.agent];
  if (!ch) return;
  ch.lastEventTs = now;

  const et = event.event_type;
  const tool = event.tool;
  const status = event.status;
  const agentCfg = AGENTS[event.agent];

  if (et === 'run_started') {
    // Walk home to own desk
    sendTo(ch, agentCfg.deskStand.x, agentCfg.deskStand.y);
    return;
  }

  if (et === 'tool_call' && TYPE_TOOLS.has(tool)) {
    ch.state = STATES.TYPE;
    ch.stateUntil = now + 1500;
    ch.bubble = { text: tool, color: agentCfg.accent, until: now + 1500 };
    return;
  }

  if (et === 'tool_result') {
    if (status === 'ok') {
      ch.bubble = { text: '✓', color: '#4ade80', until: now + 900 };
    } else if (status === 'fail') {
      ch.state = STATES.BLOCKED;
      ch.stateUntil = now + 3000;
      ch.bubble = { text: '!', color: '#f87171', until: now + 3000 };
    }
    return;
  }

  if (et === 'zod_error') {
    ch.state = STATES.BLOCKED;
    ch.stateUntil = now + 3000;
    ch.bubble = { text: '!', color: '#f87171', until: now + 3000 };
    return;
  }
  // delegation is rendered as an arrow in the main loop — no state change here.
}

// Idle/zzz check: if no events for >60s, show sleep bubble.
export function tickIdleBubbles(characters, now) {
  for (const id of AGENT_IDS) {
    const ch = characters[id];
    if (now - ch.lastEventTs > 60000 && ch.state === STATES.IDLE && !ch.bubble) {
      ch.bubble = { text: 'zzz', color: '#94a3b8', until: now + 3000 };
      ch.lastEventTs = now - 55000; // re-trigger every ~5s
    }
  }
}
