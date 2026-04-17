// officeMap.js
// Static 32x18 tile grid defining the Empírika AI office floorplan.
// Tile codes:
//   0 = floor
//   1 = wall
//   2 = desk (blocks walking, is drawn as desk sprite)
//   3 = chair (walkable, rendered for flavor)
//   4 = door (walkable, rendered distinctly)
//   5 = rug/accent (walkable)
//
// Kept deliberately simple — a senior engineer should find this legible.
// Desks are aligned with AGENTS[*].desk coords in agentRegistry.js.

import { GRID_W, GRID_H } from './agentRegistry.js';

// Convenience builders
const row = (...cells) => cells;

// Row templates
const W = 1, F = 0, D = 2, C = 3, DOOR = 4, R = 5;

// Start from a floor-filled grid with wall border
function buildGrid() {
  const g = [];
  for (let y = 0; y < GRID_H; y++) {
    const r = [];
    for (let x = 0; x < GRID_W; x++) {
      if (y === 0 || y === GRID_H - 1 || x === 0 || x === GRID_W - 1) {
        r.push(W);
      } else {
        r.push(F);
      }
    }
    g.push(r);
  }
  return g;
}

const grid = buildGrid();

// Door on left wall (visual anchor near Scout)
grid[9][0] = DOOR;

// Inner wall separating manager office (top-right)
for (let x = 25; x < GRID_W - 1; x++) grid[4][x] = W;
grid[4][26] = F; // opening

// Inner wall for meeting corner (bottom-left)
for (let x = 1; x < 8; x++) grid[12][x] = W;
grid[12][3] = F; // opening

// Rug accents for bullpen
for (let x = 13; x <= 19; x++) {
  for (let y = 7; y <= 10; y++) {
    if (grid[y][x] === F) grid[y][x] = R;
  }
}

// Place desks + chairs for each agent
// Format: [deskX, deskY, chairX, chairY]
const deskPlacements = [
  // scout — left wall
  [2, 8, 3, 8],
  // helena — top workbench
  [10, 2, 10, 3],
  // angela — right wall
  [28, 6, 27, 6],
  // sam — bullpen
  [14, 8, 14, 9],
  // kai — bullpen
  [18, 8, 18, 9],
  // carlos — meeting corner
  [4, 14, 5, 14],
  // davinci — bottom-right
  [26, 14, 25, 14],
  // verifier — center-front
  [16, 14, 16, 15],
  // manager — top-right corner
  [28, 2, 27, 3],
];

for (const [dx, dy, cx, cy] of deskPlacements) {
  if (grid[dy] && grid[dy][dx] !== undefined) grid[dy][dx] = D;
  if (grid[cy] && grid[cy][cx] !== undefined && grid[cy][cx] === F) {
    grid[cy][cx] = C;
  } else if (grid[cy] && grid[cy][cx] === R) {
    // keep rug; chair is implicit in stand position
  }
}

export const OFFICE_GRID = grid;

// Walkability check — true if an agent can walk onto this tile.
// Desks (2) and walls (1) block movement; everything else is fine.
export function isWalkable(x, y) {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
  const t = grid[y][x];
  return t !== W && t !== D;
}

// Palette for the cached floor render
export const PALETTE = {
  floor: '#1f2937',      // slate-800
  floorAlt: '#111827',   // slate-900 checker
  wall: '#0f172a',       // slate-950
  wallHi: '#334155',     // slate-700 top edge
  desk: '#78350f',       // amber-900
  deskTop: '#b45309',    // amber-700
  chair: '#1e293b',      // slate-800
  door: '#f59e0b',       // amber-500
  rug: '#1e3a8a',        // indigo-900
  rugAlt: '#1e40af',     // indigo-800
  grid: 'rgba(255,255,255,0.03)',
};

export { GRID_W, GRID_H };
