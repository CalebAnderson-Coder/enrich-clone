import { Radar, Database, PenTool, TrendingUp, Zap, Phone, Palette, ShieldCheck, Crown } from 'lucide-react';

export const AGENT_META = {
  manager:  { display: 'Manager',  role: 'Orchestrator',    accent: '#fde047', Icon: Crown },
  scout:    { display: 'Scout',    role: 'Prospecting',     accent: '#4ade80', Icon: Radar },
  helena:   { display: 'Helena',   role: 'Enrichment',      accent: '#22d3ee', Icon: Database },
  angela:   { display: 'Ángela',   role: 'Writer',          accent: '#f472b6', Icon: PenTool },
  sam:      { display: 'Sam',      role: 'Social / Paid',   accent: '#fb923c', Icon: TrendingUp },
  kai:      { display: 'Kai',      role: 'Content',         accent: '#a78bfa', Icon: Zap },
  carlos:   { display: 'Carlos',   role: 'Empírika Liaison',accent: '#facc15', Icon: Phone },
  davinci:  { display: 'DaVinci',  role: 'Design',          accent: '#f87171', Icon: Palette },
  verifier: { display: 'Verifier', role: 'QA',              accent: '#e2e8f0', Icon: ShieldCheck },
};

export const AGENT_ORDER = ['manager', 'scout', 'helena', 'angela', 'sam', 'kai', 'carlos', 'davinci', 'verifier'];

export function getAgentMeta(id) {
  return AGENT_META[id] || { display: id, role: '—', accent: '#94a3b8', Icon: Radar };
}
