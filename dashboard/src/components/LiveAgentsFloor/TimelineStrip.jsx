import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAgentMeta } from './agentMeta';

const WINDOW_MS = 60_000;

function fmtSecAgo(ts, now) {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 1) return 'ahora';
  return `${s}s`;
}

function toolLabel(ev) {
  const t = ev.tool || ev.event_type || '?';
  return t.length > 14 ? `${t.slice(0, 13)}…` : t;
}

export default function TimelineStrip({ events }) {
  const now = Date.now();
  const recent = useMemo(() => {
    if (!events) return [];
    return events
      .filter((e) => now - new Date(e.ts).getTime() < WINDOW_MS)
      .slice(-40); // cap pills rendered
  }, [events, now]);

  return (
    <div className="relative rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-[0.25em] text-white/50">Last 60s · Cross-flota</div>
        <div className="text-[10px] text-white/40 font-mono">{recent.length} eventos</div>
      </div>

      <div className="relative h-[46px] overflow-hidden">
        {/* gradient fade-out left */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface-950/80 to-transparent z-10 pointer-events-none" />
        {/* NOW marker right */}
        <div className="absolute right-3 top-0 bottom-0 z-20 flex items-center gap-1.5 pointer-events-none">
          <div className="w-px h-8 bg-white/30" />
          <span className="text-[9px] font-semibold tracking-widest text-white/60">NOW</span>
        </div>

        <div className="absolute inset-0 flex items-center justify-end pr-16 pl-4 gap-1.5 flex-wrap-reverse">
          <AnimatePresence initial={false}>
            {recent.map((ev) => {
              const meta = getAgentMeta(ev.agent);
              const isErr = ev.event_type === 'zod_error' || ev.status === 'blocked';
              const bg = isErr ? '#ef444422' : `${meta.accent}1f`;
              const border = isErr ? '#ef444477' : `${meta.accent}66`;
              const dotColor = isErr ? '#ef4444' : meta.accent;
              return (
                <motion.div
                  key={ev.id || `${ev.agent}-${ev.ts}-${ev.tool || ev.event_type}`}
                  layout
                  initial={{ x: 24, opacity: 0, scale: 0.9 }}
                  animate={{ x: 0, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: bg, border: `1px solid ${border}` }}
                  title={`${meta.display} · ${ev.tool || ev.event_type} · ${fmtSecAgo(ev.ts, now)}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                  <span style={{ color: meta.accent }} className="font-semibold">{meta.display}</span>
                  <span className="text-white/55 font-mono">{toolLabel(ev)}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {recent.length === 0 && (
            <span className="text-[10px] text-white/30 italic">esperando actividad…</span>
          )}
        </div>
      </div>
    </div>
  );
}
