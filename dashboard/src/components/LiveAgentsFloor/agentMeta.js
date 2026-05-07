import { Radar, Database, PenTool, TrendingUp, Zap, Phone, Palette, ShieldCheck, Crown, BarChart3 } from 'lucide-react';

export const AGENT_META = {
  manager:   { display: 'Manager',   role: 'Orchestrator',     accent: '#fde047', Icon: Crown },
  scout:     { display: 'Scout',     role: 'Prospecting',      accent: '#4ade80', Icon: Radar },
  helena:    { display: 'Helena',    role: 'Enrichment',       accent: '#22d3ee', Icon: Database },
  angela:    { display: 'Ángela',    role: 'Writer',           accent: '#f472b6', Icon: PenTool },
  sam:       { display: 'Sam',       role: 'Social / Paid',    accent: '#fb923c', Icon: TrendingUp },
  kai:       { display: 'Kai',       role: 'Content',          accent: '#a78bfa', Icon: Zap },
  carlos:    { display: 'Carlos',    role: 'Empírika Liaison', accent: '#facc15', Icon: Phone },
  davinci:   { display: 'DaVinci',   role: 'Design',           accent: '#f87171', Icon: Palette },
  verifier:  { display: 'Verifier',  role: 'QA',               accent: '#e2e8f0', Icon: ShieldCheck },
  estratega: { display: 'Estratega', role: 'Strategic Analyst', accent: '#a3e635', Icon: BarChart3 },
};

export const AGENT_ORDER = [
  'manager', 'scout', 'helena', 'angela', 'sam',
  'kai', 'carlos', 'davinci', 'verifier', 'estratega',
];

export function getAgentMeta(id) {
  return AGENT_META[id] || { display: id, role: '—', accent: '#94a3b8', Icon: Radar };
}

/**
 * Look up agent metadata by the raw DB name stored in agent_processes.
 * Handles mixed-case names like 'Carlos Empirika', 'DaVinci', 'Estratega', etc.
 */
export function getAgentMetaByDbName(dbName) {
  if (!dbName) return { display: dbName || '?', role: '—', accent: '#94a3b8', Icon: Radar };
  const normalized = dbName.toLowerCase().replace(/\s+empirika$/i, '').trim();
  return AGENT_META[normalized] || { display: dbName, role: '—', accent: '#94a3b8', Icon: Radar };
}
