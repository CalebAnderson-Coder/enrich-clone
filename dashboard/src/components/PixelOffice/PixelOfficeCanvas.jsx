// PixelOfficeCanvas.jsx
// Top-down pixel-art visualization of the Empírika AI Fleet. 9 agents walk
// around their office, typing / reading / getting blocked based on a live
// event stream. Plain Canvas 2D — no pixi/phaser/konva.
//
// Contract: see README_SPRITES.md for swapping in real assets.

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { AGENTS, AGENT_IDS, TILE_SIZE, GRID_W, GRID_H } from './agentRegistry.js';
import { OFFICE_GRID, PALETTE, isWalkable } from './officeMap.js';
import {
  createInitialCharacters,
  tickCharacter,
  applyEvent,
  tickIdleBubbles,
  sendTo,
  STATES,
  DIRS,
} from './characterState.js';

const CANVAS_W = GRID_W * TILE_SIZE; // 1024
const CANVAS_H = GRID_H * TILE_SIZE; // 576

// ----- Mock event pool -------------------------------------------------------

const MOCK_TOOLS = ['save_lead', 'search_web', 'update_mega_profile'];
const MOCK_EVENT_TYPES = ['tool_call', 'tool_result', 'tool_result', 'delegation', 'zod_error'];

function generateMockEvent() {
  const agent = AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)];
  const et = MOCK_EVENT_TYPES[Math.floor(Math.random() * MOCK_EVENT_TYPES.length)];
  const tool = MOCK_TOOLS[Math.floor(Math.random() * MOCK_TOOLS.length)];
  const status = Math.random() > 0.15 ? 'ok' : 'fail';
  let target = null;
  if (et === 'delegation') {
    const others = AGENT_IDS.filter((a) => a !== agent);
    target = others[Math.floor(Math.random() * others.length)];
  }
  return {
    agent,
    event_type: et,
    tool,
    status,
    metadata: { target },
    ts: Date.now(),
  };
}

// ----- Placeholder spritesheet generator ------------------------------------
// Draws a 16x16 character with 4 directions (rows) x 4 walk frames (cols).
// Each sprite is just colored body + simple bobbing accent. Real JIK-A-4
// spritesheets drop in at sprites/{agent}.png with the same layout.

function buildPlaceholderSheet(accentHex) {
  const SPR = 16;
  const canvas = document.createElement('canvas');
  canvas.width = SPR * 4;
  canvas.height = SPR * 4;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let d = 0; d < 4; d++) {
    for (let f = 0; f < 4; f++) {
      const ox = f * SPR;
      const oy = d * SPR;
      // body
      ctx.fillStyle = accentHex;
      ctx.fillRect(ox + 4, oy + 5, 8, 8);
      // head
      ctx.fillStyle = '#fde4c8';
      ctx.fillRect(ox + 5, oy + 2, 6, 5);
      // hair band
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(ox + 5, oy + 2, 6, 2);
      // eyes (direction-aware)
      ctx.fillStyle = '#0b1220';
      if (d === DIRS.DOWN) {
        ctx.fillRect(ox + 6, oy + 5, 1, 1);
        ctx.fillRect(ox + 9, oy + 5, 1, 1);
      } else if (d === DIRS.UP) {
        // back of head, no eyes
      } else if (d === DIRS.LEFT) {
        ctx.fillRect(ox + 6, oy + 5, 1, 1);
      } else if (d === DIRS.RIGHT) {
        ctx.fillRect(ox + 9, oy + 5, 1, 1);
      }
      // legs — animate with frame
      const legOff = f === 1 ? 1 : f === 3 ? -1 : 0;
      ctx.fillStyle = '#111827';
      ctx.fillRect(ox + 5, oy + 13, 2, 3 + legOff);
      ctx.fillRect(ox + 9, oy + 13, 2, 3 - legOff);
    }
  }
  return canvas;
}

// ----- Cached office render --------------------------------------------------

function buildOfficeBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const tile = OFFICE_GRID[y][x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // base floor under everything
      const checker = (x + y) % 2 === 0;
      ctx.fillStyle = checker ? PALETTE.floor : PALETTE.floorAlt;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      if (tile === 1) {
        ctx.fillStyle = PALETTE.wall;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = PALETTE.wallHi;
        ctx.fillRect(px, py, TILE_SIZE, 4);
      } else if (tile === 2) {
        // desk
        ctx.fillStyle = PALETTE.desk;
        ctx.fillRect(px + 2, py + 6, TILE_SIZE - 4, TILE_SIZE - 10);
        ctx.fillStyle = PALETTE.deskTop;
        ctx.fillRect(px + 2, py + 6, TILE_SIZE - 4, 4);
        // monitor
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(px + 8, py + 2, TILE_SIZE - 16, 8);
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(px + 10, py + 4, TILE_SIZE - 20, 4);
      } else if (tile === 3) {
        ctx.fillStyle = PALETTE.chair;
        ctx.fillRect(px + 8, py + 8, TILE_SIZE - 16, TILE_SIZE - 16);
      } else if (tile === 4) {
        ctx.fillStyle = PALETTE.door;
        ctx.fillRect(px, py + 4, TILE_SIZE, TILE_SIZE - 8);
        ctx.fillStyle = '#78350f';
        ctx.fillRect(px + TILE_SIZE - 6, py + TILE_SIZE / 2 - 1, 3, 2);
      } else if (tile === 5) {
        ctx.fillStyle = (x + y) % 2 === 0 ? PALETTE.rug : PALETTE.rugAlt;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }

      // subtle grid
      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }

  // Desk nameplates
  const ctxFont = '10px monospace';
  ctx.font = ctxFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const id of AGENT_IDS) {
    const a = AGENTS[id];
    const px = a.desk.x * TILE_SIZE + TILE_SIZE / 2;
    const py = a.desk.y * TILE_SIZE + TILE_SIZE - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px - 24, py - 6, 48, 10);
    ctx.fillStyle = a.accent;
    ctx.fillText(a.display, px, py);
  }

  return canvas;
}

// ----- Component ------------------------------------------------------------

export default function PixelOfficeCanvas({
  events = [],
  useMockEvents = true,
  width = CANVAS_W,
  height = CANVAS_H,
  onAgentClick,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const charactersRef = useRef(createInitialCharacters());
  const bgRef = useRef(null);
  const spritesRef = useRef({}); // { agentId: HTMLCanvasElement | HTMLImageElement }
  const lastTimeRef = useRef(performance.now());
  const seenEventsRef = useRef(new Set());
  const mockTimerRef = useRef(0);
  const delegationsRef = useRef([]); // active delegation arrows: {from,to,until}
  const [summary, setSummary] = useState('');

  // Build placeholders + try real sprites once
  useEffect(() => {
    bgRef.current = buildOfficeBackground();
    for (const id of AGENT_IDS) {
      const fallback = buildPlaceholderSheet(AGENTS[id].accent);
      spritesRef.current[id] = fallback;
      // attempt to load real sprite
      const img = new Image();
      img.onload = () => { spritesRef.current[id] = img; };
      img.onerror = () => { /* keep placeholder */ };
      // vite serves /src assets relatively — use public path if provided.
      img.src = new URL(`./${AGENTS[id].spriteSrc}`, import.meta.url).href;
    }
  }, []);

  // Ingest events — walk only the tail we haven't seen.
  useEffect(() => {
    if (!events || !events.length) return;
    const now = performance.now();
    for (const ev of events) {
      const key = ev.id || `${ev.agent}-${ev.ts}-${ev.event_type}-${ev.tool || ''}`;
      if (seenEventsRef.current.has(key)) continue;
      seenEventsRef.current.add(key);
      applyEvent(charactersRef.current, ev, now);
      if (ev.event_type === 'delegation' && ev.metadata?.target) {
        delegationsRef.current.push({
          from: ev.agent,
          to: ev.metadata.target,
          until: now + 2500,
        });
      }
    }
    // Bound the seen set
    if (seenEventsRef.current.size > 500) {
      seenEventsRef.current = new Set(
        Array.from(seenEventsRef.current).slice(-300)
      );
    }
  }, [events]);

  // Handle canvas click → onAgentClick
  const handleClick = useCallback((e) => {
    if (!onAgentClick) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    // Find closest character within 24px
    let best = null, bestD = 28;
    for (const id of AGENT_IDS) {
      const ch = charactersRef.current[id];
      const px = ch.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = ch.position.y * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) onAgentClick(best);
  }, [onAgentClick]);

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let running = true;
    const shouldMock = () => useMockEvents && (!events || events.length === 0);

    const loop = (t) => {
      if (!running) return;
      const now = t;
      const dt = Math.min(0.1, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      // Mock event injection
      if (shouldMock()) {
        mockTimerRef.current += dt;
        if (mockTimerRef.current > 2) {
          mockTimerRef.current = 0;
          const ev = generateMockEvent();
          applyEvent(charactersRef.current, ev, now);
          if (ev.event_type === 'delegation' && ev.metadata?.target) {
            delegationsRef.current.push({
              from: ev.agent,
              to: ev.metadata.target,
              until: now + 2500,
            });
          }
          // Occasionally tell a random agent to wander to a nearby floor tile
          if (Math.random() < 0.4) {
            const id = AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)];
            const ch = charactersRef.current[id];
            if (ch.state === STATES.IDLE) {
              // try up to 6 random adjacent targets
              for (let i = 0; i < 6; i++) {
                const tx = Math.max(1, Math.min(GRID_W - 2,
                  Math.round(ch.position.x) + Math.floor(Math.random() * 7) - 3));
                const ty = Math.max(1, Math.min(GRID_H - 2,
                  Math.round(ch.position.y) + Math.floor(Math.random() * 7) - 3));
                if (isWalkable(tx, ty) && sendTo(ch, tx, ty)) break;
              }
            }
          }
        }
      }

      // Tick characters
      for (const id of AGENT_IDS) {
        tickCharacter(charactersRef.current[id], dt, now);
      }
      tickIdleBubbles(charactersRef.current, now);

      // --- RENDER ---
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      if (bgRef.current) ctx.drawImage(bgRef.current, 0, 0);

      // Delegation arrows (beneath characters)
      delegationsRef.current = delegationsRef.current.filter((d) => d.until > now);
      for (const d of delegationsRef.current) {
        const a = charactersRef.current[d.from];
        const b = charactersRef.current[d.to];
        if (!a || !b) continue;
        const ax = a.position.x * TILE_SIZE + TILE_SIZE / 2;
        const ay = a.position.y * TILE_SIZE + TILE_SIZE / 2;
        const bx = b.position.x * TILE_SIZE + TILE_SIZE / 2;
        const by = b.position.y * TILE_SIZE + TILE_SIZE / 2;
        const alpha = Math.max(0, (d.until - now) / 2500);
        ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        // arrowhead
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.fillStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - 8 * Math.cos(ang - 0.4), by - 8 * Math.sin(ang - 0.4));
        ctx.lineTo(bx - 8 * Math.cos(ang + 0.4), by - 8 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
      }

      // Sort characters by y for depth
      const ordered = AGENT_IDS
        .map((id) => charactersRef.current[id])
        .sort((a, b) => a.position.y - b.position.y);

      for (const ch of ordered) {
        const sheet = spritesRef.current[ch.id];
        const drawX = Math.round(ch.position.x * TILE_SIZE + (TILE_SIZE - 16) / 2);
        const drawY = Math.round(ch.position.y * TILE_SIZE + (TILE_SIZE - 16) / 2);

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(drawX + 8, drawY + 15, 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();

        if (sheet) {
          const sx = ch.frame * 16;
          const sy = ch.dir * 16;
          ctx.drawImage(sheet, sx, sy, 16, 16, drawX, drawY, 16, 16);
        }

        // Typing indicator
        if (ch.state === STATES.TYPE) {
          ctx.fillStyle = '#facc15';
          const dots = Math.floor((now / 200) % 3) + 1;
          for (let i = 0; i < dots; i++) {
            ctx.fillRect(drawX + 2 + i * 4, drawY - 4, 2, 2);
          }
        }

        // Blocked ring
        if (ch.state === STATES.BLOCKED) {
          ctx.strokeStyle = '#f87171';
          ctx.lineWidth = 1;
          ctx.strokeRect(drawX - 1, drawY - 1, 18, 18);
        }

        // Speech bubble
        if (ch.bubble) {
          drawBubble(ctx, ch.bubble.text, ch.bubble.color, drawX + 8, drawY - 8);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [useMockEvents, events]);

  // a11y summary — updated ~1Hz
  useEffect(() => {
    const t = setInterval(() => {
      const parts = AGENT_IDS.map((id) => {
        const ch = charactersRef.current[id];
        return `${AGENTS[id].display}: ${ch.state}`;
      });
      setSummary(parts.join(', '));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const ariaLabel = useMemo(
    () => `Empírika AI Fleet pixel office. ${summary}`,
    [summary]
  );

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ width, height, lineHeight: 0 }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
          cursor: onAgentClick ? 'pointer' : 'default',
          display: 'block',
          background: '#0b1220',
        }}
      />
    </div>
  );
}

// Draw an 8-bit-ish speech bubble above a point.
function drawBubble(ctx, text, color, x, y) {
  ctx.font = '10px monospace';
  const w = Math.max(14, ctx.measureText(text).width + 8);
  const h = 14;
  const bx = Math.round(x - w / 2);
  const by = Math.round(y - h - 4);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = color || '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  // tail
  ctx.fillRect(Math.round(x) - 1, by + h, 2, 2);
  ctx.fillStyle = color || '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5);
}
