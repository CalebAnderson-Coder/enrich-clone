import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { getAgentMetaByDbName } from '../LiveAgentsFloor/agentMeta';

// Thresholds
const STALE_MS = 2 * 60 * 1000; // 2 minutes

function deriveHeartbeatStatus(processRow) {
  if (!processRow) return 'NOT_DEPLOYED';
  if (processRow.status === 'crashed') return 'CRASHED';
  if (processRow.status === 'stopped') return 'STOPPED';
  if (!processRow.last_heartbeat_at) return 'STOPPED';
  const ageMs = Date.now() - new Date(processRow.last_heartbeat_at).getTime();
  if (ageMs > STALE_MS) return 'STALE';
  return 'ALIVE';
}

const STATUS_CFG = {
  ALIVE:        { label: 'ALIVE',        dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  STALE:        { label: 'STALE',        dot: 'bg-yellow-400',  text: 'text-yellow-300',  border: 'border-yellow-500/30' },
  CRASHED:      { label: 'CRASHED',      dot: 'bg-red-500',     text: 'text-red-400',     border: 'border-red-500/30' },
  STOPPED:      { label: 'STOPPED',      dot: 'bg-white/20',    text: 'text-white/40',    border: 'border-white/10' },
  NOT_DEPLOYED: { label: 'NOT DEPLOYED', dot: 'bg-white/10',    text: 'text-white/30',    border: 'border-white/5' },
};

function fmtRelative(iso, nowMs) {
  if (!iso) return '—';
  const diffMs = nowMs - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 5)  return 'ahora mismo';
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  return `hace ${h}h ${m % 60}m`;
}

function fmtUptime(startedAt, nowMs) {
  if (!startedAt) return null;
  const diffMs = nowMs - new Date(startedAt).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Pulse aura animation — only rendered when ALIVE
const AURA_VARIANTS = {
  pulse: (accent) => ({
    boxShadow: [
      `0 0 0px ${accent}00`,
      `0 0 20px ${accent}55`,
      `0 0 0px ${accent}00`,
    ],
    transition: { repeat: Infinity, duration: 1.5, ease: 'easeInOut' },
  }),
  idle: { boxShadow: '0 0 0px rgba(0,0,0,0)' },
};

const ICON_SCALE = {
  pulse: { scale: [1, 1.04, 1], transition: { repeat: Infinity, duration: 1.5, ease: 'easeInOut' } },
  idle: { scale: 1 },
};

export default function AgentHeartbeatCard({ agentDbName, processRow, stats, nowMs, onClick }) {
  const meta = useMemo(() => getAgentMetaByDbName(agentDbName), [agentDbName]);
  const heartbeatStatus = useMemo(() => deriveHeartbeatStatus(processRow), [processRow]);
  const cfg = STATUS_CFG[heartbeatStatus];
  const isAlive = heartbeatStatus === 'ALIVE';
  const isCrashed = heartbeatStatus === 'CRASHED';

  const relativeHb = fmtRelative(processRow?.last_heartbeat_at, nowMs);
  const uptime = fmtUptime(processRow?.started_at, nowMs);
  const { Icon, accent, display, role } = meta;

  const glowColor = isCrashed ? 'rgba(239,68,68,0.4)' : `${accent}44`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.975 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className={`relative rounded-2xl bg-white/5 border backdrop-blur-xl overflow-hidden cursor-pointer hover:bg-white/[0.08] transition-colors focus:outline-none focus:ring-1 focus:ring-white/20 ${cfg.border}`}
    >
      {/* Glow layer for alive / crashed */}
      <motion.div
        animate={isAlive || isCrashed ? AURA_VARIANTS.pulse(glowColor) : AURA_VARIANTS.idle}
        className="absolute inset-0 pointer-events-none rounded-2xl"
      />

      <div className="relative p-4 flex flex-col gap-3">
        {/* Top row: icon + name + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon with pulsing aura when ALIVE */}
            <motion.div
              animate={isAlive ? ICON_SCALE.pulse : ICON_SCALE.idle}
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 relative"
              style={{ background: `${accent}1a`, border: `1px solid ${accent}44` }}
            >
              <Icon size={18} style={{ color: accent }} />
              {isAlive && (
                <motion.div
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="absolute inset-0 rounded-xl"
                  style={{ background: `radial-gradient(circle, ${accent}33, transparent 70%)` }}
                />
              )}
            </motion.div>

            <div className="min-w-0">
              <div className="text-sm font-semibold text-white leading-tight truncate">{display}</div>
              <div className="text-[10px] text-white/40 truncate mt-0.5">{role}</div>
            </div>
          </div>

          {/* Status badge */}
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <motion.span
              animate={isAlive ? { scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] } : {}}
              transition={isAlive ? { repeat: Infinity, duration: 1.5 } : {}}
              className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
            />
            <span className={`text-[9px] font-bold tracking-[0.12em] ${cfg.text}`}>{cfg.label}</span>
          </div>
        </div>

        {/* Heartbeat timestamp */}
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] text-white/35 uppercase tracking-widest">Último pulso</div>
          <div className="text-xs text-white/75 font-mono">{relativeHb}</div>
        </div>

        {/* Uptime */}
        {uptime && (
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] text-white/35 uppercase tracking-widest">Activo</div>
            <div className="text-xs font-mono" style={{ color: accent }}>{uptime}</div>
          </div>
        )}

        {/* Optional stats row */}
        {stats && (stats.emailsToday > 0 || stats.messagesToday > 0) && (
          <div className="flex gap-3 pt-1 border-t border-white/5">
            {stats.emailsToday > 0 && (
              <div className="flex flex-col">
                <span className="text-[9px] text-white/30 uppercase tracking-widest">Emails hoy</span>
                <span className="text-xs font-semibold text-white/70">{stats.emailsToday}</span>
              </div>
            )}
            {stats.messagesToday > 0 && (
              <div className="flex flex-col">
                <span className="text-[9px] text-white/30 uppercase tracking-widest">Mensajes</span>
                <span className="text-xs font-semibold text-white/70">{stats.messagesToday}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
