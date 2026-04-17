import React, { useMemo, useRef, useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { getAgentMeta } from './agentMeta';

const STATUS = {
  WORKING: { label: 'WORKING', textClass: 'text-emerald-300', dotClass: 'bg-emerald-400' },
  BLOCKED: { label: 'BLOCKED', textClass: 'text-red-300',     dotClass: 'bg-red-500' },
  THINKING:{ label: 'THINKING',textClass: 'text-sky-300',     dotClass: 'bg-sky-400' },
  IDLE:    { label: 'IDLE',    textClass: 'text-white/40',    dotClass: 'bg-white/30' },
};

function deriveStatus(events, nowMs) {
  if (!events || events.length === 0) return 'IDLE';
  const last = events[events.length - 1];
  const ageMs = nowMs - new Date(last.ts).getTime();
  if (last.event_type === 'zod_error' || last.status === 'blocked') return 'BLOCKED';
  if (ageMs > 30_000) return 'IDLE';
  if (ageMs < 8_000 && (last.event_type === 'tool_call' || last.event_type === 'run_started' || last.event_type === 'delegation')) return 'WORKING';
  return 'THINKING';
}

function lastToolCall(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === 'tool_call') return events[i];
  }
  return null;
}

function sparkBars(events, accent) {
  const last = events.slice(-20);
  if (last.length === 0) return Array.from({ length: 20 }).map(() => ({ h: 2, color: 'rgba(255,255,255,0.12)' }));
  return last.map((e) => {
    if (e.event_type === 'zod_error')     return { h: 14, color: '#ef4444' };
    if (e.event_type === 'tool_call')     return { h: 10, color: accent };
    if (e.event_type === 'delegation')    return { h: 12, color: accent };
    if (e.event_type === 'tool_result' && e.status === 'blocked') return { h: 12, color: '#f59e0b' };
    if (e.event_type === 'tool_result')   return { h: 6,  color: `${accent}88` };
    if (e.event_type === 'run_started')   return { h: 8,  color: accent };
    if (e.event_type === 'run_completed') return { h: 5,  color: `${accent}55` };
    return { h: 4, color: 'rgba(255,255,255,0.2)' };
  });
}

function hint(meta) {
  if (!meta) return '';
  if (meta.business_name) return `"${meta.business_name}"`;
  if (meta.target) return `→ ${meta.target}`;
  if (meta.lead_tier) return `[${meta.lead_tier}]`;
  if (meta.note) return meta.note.slice(0, 40);
  return '';
}

export default function AgentCard({ agentId, events, onClick }) {
  const { display, role, accent, Icon } = getAgentMeta(agentId);
  const nowMs = Date.now();
  const status = useMemo(() => deriveStatus(events, nowMs), [events, nowMs]);
  const last = useMemo(() => lastToolCall(events), [events]);
  const bars = useMemo(() => sparkBars(events, accent), [events, accent]);

  const runsToday = events.filter((e) => e.event_type === 'run_started').length;
  const completions = events.filter((e) => e.event_type === 'run_completed').length;
  const errors = events.filter((e) => e.event_type === 'zod_error' || e.status === 'blocked').length;
  const denom = completions + errors;
  const successRate = denom > 0 ? Math.round((completions / denom) * 100) : null;

  // Bounce + border flash on new event
  const controls = useAnimationControls();
  const prevLenRef = useRef(events.length);
  useEffect(() => {
    if (events.length > prevLenRef.current) {
      controls.start({ scale: [1, 1.03, 1], transition: { duration: 0.35 } });
    }
    prevLenRef.current = events.length;
  }, [events.length, controls]);

  const s = STATUS[status];
  const isWorking = status === 'WORKING';
  const isBlocked = status === 'BLOCKED';
  const glowColor = isBlocked ? 'rgba(239,68,68,0.45)' : `${accent}55`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className="relative rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl overflow-hidden cursor-pointer hover:bg-white/[0.07] transition-colors focus:outline-none focus:ring-1 focus:ring-white/30"
      style={{ minHeight: 116 }}
    >
      <motion.div
        animate={(isWorking || isBlocked)
          ? { boxShadow: [`0 0 0px ${glowColor}`, `0 0 22px ${glowColor}`, `0 0 0px ${glowColor}`] }
          : { boxShadow: '0 0 0px rgba(0,0,0,0)' }}
        transition={(isWorking || isBlocked) ? { repeat: Infinity, duration: 2 } : { duration: 0.3 }}
        className="absolute inset-0 pointer-events-none rounded-xl"
      />
      <motion.div animate={controls} className="relative p-3.5 flex flex-col gap-2 h-full">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${accent}22`, border: `1px solid ${accent}55` }}
            >
              <Icon size={14} style={{ color: accent }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white leading-none truncate">{display}</div>
              <div className="text-[10px] text-white/40 mt-0.5 truncate">{role}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <motion.span
              animate={isWorking ? { scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] } : { scale: 1, opacity: 1 }}
              transition={isWorking ? { repeat: Infinity, duration: 1.2 } : { duration: 0.2 }}
              className={`w-1.5 h-1.5 rounded-full ${s.dotClass}`}
            />
            <span className={`text-[10px] font-semibold tracking-[0.14em] ${s.textClass}`}>{s.label}</span>
          </div>
        </div>

        {/* Action */}
        <div className="flex-1 min-h-0">
          {last ? (
            <div className="text-[11px] text-white/70 leading-snug">
              <span style={{ color: accent }}>▶ </span>
              <span className="font-mono">{last.tool || last.event_type}</span>
              {hint(last.metadata) && (
                <div className="text-[10px] text-white/45 mt-0.5 truncate">{hint(last.metadata)}</div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-white/30 italic">sin actividad reciente</div>
          )}
        </div>

        {/* Footer: sparkline + stats */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-end gap-[2px] h-4">
            {bars.map((b, i) => (
              <div
                key={i}
                style={{ height: `${b.h}px`, background: b.color, width: '3px', borderRadius: '1px' }}
              />
            ))}
          </div>
          <div className="text-[10px] text-white/50 font-mono whitespace-nowrap">
            {runsToday}r · {successRate != null ? `${successRate}%` : '—'}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
