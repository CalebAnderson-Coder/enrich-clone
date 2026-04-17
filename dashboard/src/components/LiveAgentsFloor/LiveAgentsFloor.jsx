import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import AgentCard from './AgentCard';
import TimelineStrip from './TimelineStrip';
import AgentDetailModal from './AgentDetailModal';
import { AGENT_ORDER } from './agentMeta';

const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

export default function LiveAgentsFloor({ events }) {
  // Re-render every 5s so status transitions (WORKING→IDLE after 30s) tick without a new event.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const [selectedAgent, setSelectedAgent] = useState(null);

  const eventsByAgent = useMemo(() => {
    const map = {};
    AGENT_ORDER.forEach((id) => { map[id] = []; });
    if (Array.isArray(events)) {
      for (const ev of events) {
        const a = ev.agent;
        if (map[a]) map[a].push(ev);
      }
    }
    // events arrive newest-first in some paths; ensure chronological oldest→newest per agent
    for (const id of AGENT_ORDER) {
      map[id].sort((a, b) => new Date(a.ts) - new Date(b.ts));
    }
    return map;
  }, [events]);

  return (
    <div className={`${GLASS} relative overflow-hidden p-5`} style={{ minHeight: 400 }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(94,106,210,0.18),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(217,70,239,0.12),transparent_55%)] pointer-events-none" />

      <div className="relative flex items-center justify-between mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/50">Flota · Live</div>
          <div className="text-sm text-white/75 mt-1">9 agentes Empírika trabajando ahora</div>
        </div>
        <motion.div
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="flex items-center gap-2 text-[11px] text-white/60"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          stream conectado
        </motion.div>
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
        className="relative grid grid-cols-3 gap-3 mb-3"
      >
        {AGENT_ORDER.map((id) => (
          <AgentCard
            key={id}
            agentId={id}
            events={eventsByAgent[id]}
            onClick={() => setSelectedAgent(id)}
          />
        ))}
      </motion.div>

      <TimelineStrip events={events} />

      <AgentDetailModal
        agentId={selectedAgent}
        events={selectedAgent ? eventsByAgent[selectedAgent] : []}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
