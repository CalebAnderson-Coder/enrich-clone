// agentRegistry.js
// Maps each of the 9 Empírika AI Fleet agents to its desk, display name,
// spritesheet path, and accent color. Desk coords are in TILE units on the
// 32x18 officeMap grid. The character stands on `deskStand` while "at work";
// the desk tile itself is rendered at `desk` (see officeMap.js).

export const TILE_SIZE = 32;
export const GRID_W = 32;
export const GRID_H = 18;

export const AGENTS = {
  scout: {
    id: 'scout',
    display: 'Scout',
    accent: '#4ade80', // green
    spriteSrc: 'sprites/scout.png',
    desk: { x: 2, y: 8 },        // left wall, near the "door"
    deskStand: { x: 3, y: 8 },
    role: 'Prospecting',
  },
  helena: {
    id: 'helena',
    display: 'Helena',
    accent: '#22d3ee', // cyan
    spriteSrc: 'sprites/helena.png',
    desk: { x: 10, y: 2 },       // top wall, enrichment workbench
    deskStand: { x: 10, y: 3 },
    role: 'Enrichment',
  },
  angela: {
    id: 'angela',
    display: 'Ángela',
    accent: '#f472b6', // pink
    spriteSrc: 'sprites/angela.png',
    desk: { x: 28, y: 6 },       // right wall, writer's nook
    deskStand: { x: 27, y: 6 },
    role: 'Writer',
  },
  sam: {
    id: 'sam',
    display: 'Sam',
    accent: '#fb923c', // orange
    spriteSrc: 'sprites/sam.png',
    desk: { x: 14, y: 8 },       // center bullpen
    deskStand: { x: 14, y: 9 },
    role: 'Social / Paid',
  },
  kai: {
    id: 'kai',
    display: 'Kai',
    accent: '#a78bfa', // violet
    spriteSrc: 'sprites/kai.png',
    desk: { x: 18, y: 8 },       // center bullpen
    deskStand: { x: 18, y: 9 },
    role: 'Content',
  },
  carlos: {
    id: 'carlos',
    display: 'Carlos',
    accent: '#facc15', // amber
    spriteSrc: 'sprites/carlos.png',
    desk: { x: 4, y: 14 },       // meeting corner, bottom-left
    deskStand: { x: 5, y: 14 },
    role: 'Empírika Liaison',
  },
  davinci: {
    id: 'davinci',
    display: 'DaVinci',
    accent: '#f87171', // red
    spriteSrc: 'sprites/davinci.png',
    desk: { x: 26, y: 14 },      // bottom-right design island
    deskStand: { x: 25, y: 14 },
    role: 'Design',
  },
  verifier: {
    id: 'verifier',
    display: 'Verifier',
    accent: '#e2e8f0', // slate-200
    spriteSrc: 'sprites/verifier.png',
    desk: { x: 16, y: 14 },      // center-front QA podium
    deskStand: { x: 16, y: 15 },
    role: 'QA',
  },
  manager: {
    id: 'manager',
    display: 'Manager',
    accent: '#fde047', // yellow
    spriteSrc: 'sprites/manager.png',
    desk: { x: 28, y: 2 },       // top-right manager's office
    deskStand: { x: 27, y: 3 },
    role: 'Manager',
  },
};

export const AGENT_IDS = Object.keys(AGENTS);
