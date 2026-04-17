import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, Target, Sparkles } from 'lucide-react';
import { getAgentMeta } from './agentMeta';
import { getAgentProfile } from './agentProfiles';

export default function AgentDetailModal({ agentId, events, onClose }) {
  useEffect(() => {
    if (!agentId) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [agentId, onClose]);

  const open = Boolean(agentId);
  const meta = open ? getAgentMeta(agentId) : null;
  const profile = open ? getAgentProfile(agentId) : null;

  const runsToday = open ? events.filter((e) => e.event_type === 'run_started').length : 0;
  const completions = open ? events.filter((e) => e.event_type === 'run_completed').length : 0;
  const errors = open ? events.filter((e) => e.event_type === 'zod_error' || e.status === 'blocked').length : 0;
  const denom = completions + errors;
  const successRate = denom > 0 ? Math.round((completions / denom) * 100) : null;
  const lastEvent = open && events.length > 0 ? events[events.length - 1] : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-surface-950/95 border border-white/10 backdrop-blur-2xl shadow-2xl"
            style={{ boxShadow: `0 0 0 1px ${meta.accent}22, 0 20px 60px rgba(0,0,0,0.5)` }}
          >
            {/* gradient glow header */}
            <div
              className="absolute inset-x-0 top-0 h-32 pointer-events-none opacity-60"
              style={{ background: `radial-gradient(ellipse at 50% 0%, ${meta.accent}33, transparent 70%)` }}
            />

            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors z-10"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>

            <div className="relative p-6 pb-5">
              {/* Header */}
              <div className="flex items-start gap-4 mb-5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${meta.accent}22`, border: `1px solid ${meta.accent}55` }}
                >
                  <meta.Icon size={26} style={{ color: meta.accent }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.25em] text-white/40">Agente · Empírika</div>
                  <h2 className="text-2xl font-semibold text-white leading-tight mt-0.5">{meta.display}</h2>
                  <div className="text-sm text-white/60 mt-0.5">{meta.role}</div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <StatBox label="Runs hoy" value={runsToday} />
                <StatBox label="Éxito" value={successRate != null ? `${successRate}%` : '—'} />
                <StatBox label="Errores" value={errors} tone={errors > 0 ? 'warn' : 'ok'} />
              </div>

              {/* Summary */}
              <Section icon={Sparkles} title="Qué hace" accent={meta.accent}>
                <p className="text-sm text-white/80 leading-relaxed">{profile.summary}</p>
              </Section>

              {/* Responsibilities */}
              {profile.responsibilities?.length > 0 && (
                <Section icon={Target} title="Responsabilidades" accent={meta.accent}>
                  <ul className="space-y-1.5">
                    {profile.responsibilities.map((r, i) => (
                      <li key={i} className="text-sm text-white/75 flex gap-2">
                        <span style={{ color: meta.accent }} className="flex-shrink-0 mt-1.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Tools */}
              <Section icon={Wrench} title={`Herramientas · ${profile.tools.length}`} accent={meta.accent}>
                <div className="space-y-1.5">
                  {profile.tools.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"
                    >
                      <code
                        className="text-[11px] font-mono font-semibold whitespace-nowrap"
                        style={{ color: meta.accent }}
                      >
                        {t.name}
                      </code>
                      <span className="text-xs text-white/65 leading-snug">{t.desc}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Last activity */}
              {lastEvent && (
                <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Último evento</div>
                  <div className="text-xs text-white/75 font-mono">
                    {lastEvent.event_type}
                    {lastEvent.tool && <span className="text-white/50"> · {lastEvent.tool}</span>}
                    {lastEvent.ts && (
                      <span className="text-white/40"> · {new Date(lastEvent.ts).toLocaleTimeString('es-MX', { hour12: false })}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatBox({ label, value, tone = 'neutral' }) {
  const toneClass = tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-white';
  return (
    <div className="rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${toneClass}`}>{value}</div>
    </div>
  );
}

function Section({ icon: Icon, title, accent, children }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} style={{ color: accent }} />
        <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-white/65">{title}</div>
      </div>
      {children}
    </div>
  );
}
