import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, ShieldX, Activity, AlertTriangle, Clock } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const REFRESH_MS = 15000;
const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

const STATUS_META = {
  HEALTHY: {
    label: 'TODO AL MÁXIMO',
    color: '#34d399',
    accent: 'rgba(52,211,153,0.18)',
    border: 'rgba(52,211,153,0.45)',
    icon: ShieldCheck,
    sub: 'Los agentes están operando sin incidentes',
  },
  DEGRADED: {
    label: 'DEGRADADO',
    color: '#facc15',
    accent: 'rgba(250,204,21,0.18)',
    border: 'rgba(250,204,21,0.45)',
    icon: ShieldAlert,
    sub: 'Atlas detectó issues no críticos — el fleet sigue operando',
  },
  CRITICAL: {
    label: 'CRÍTICO',
    color: '#fb7185',
    accent: 'rgba(251,113,133,0.18)',
    border: 'rgba(251,113,133,0.45)',
    icon: ShieldX,
    sub: 'Manager fue alertado · revisión inmediata recomendada',
  },
};

const SEVERITY_META = {
  critical: { color: '#fb7185', label: 'CRÍTICO' },
  warn:     { color: '#facc15', label: 'AVISO'   },
  info:     { color: '#60a5fa', label: 'INFO'    },
};

const FINDING_LABELS = {
  process_crashed:      'Proceso crasheado',
  heartbeat_stale:      'Sin pulso',
  message_stuck:        'Mensaje atascado',
  errors_spiking:       'Errores en aumento',
  circuit_breaker_open: 'Circuit breaker abierto',
  audit_error:          'Error de auditoría',
  audit_failure:        'Falla en Atlas',
};

function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'hace segundos';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

export default function AtlasView() {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    async function fetchAudits() {
      try {
        const { data, error: err } = await supabaseAuth
          .from('fleet_audits_public')
          .select('id, status, alive_count, stale_count, crashed_count, stuck_messages, failed_1h, findings, metrics, alerted, created_at')
          .eq('brand_id', BRAND_ID)
          .order('created_at', { ascending: false })
          .limit(40);
        if (err) throw err;
        if (!alive) return;
        setAudits(data || []);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message || 'Error cargando auditorías');
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchAudits();
    const id = setInterval(fetchAudits, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const latest = audits[0] || null;
  const meta = STATUS_META[latest?.status || 'HEALTHY'];
  const Icon = meta.icon;

  // 24h trend buckets — cuántas auditorías por status
  const trend24h = useMemo(() => {
    const now = Date.now();
    const cut = now - 24 * 3600 * 1000;
    const recent = audits.filter((a) => new Date(a.created_at).getTime() >= cut);
    const tally = { HEALTHY: 0, DEGRADED: 0, CRITICAL: 0 };
    for (const a of recent) tally[a.status] = (tally[a.status] || 0) + 1;
    const total = recent.length || 1;
    return {
      total: recent.length,
      pct: {
        HEALTHY: Math.round((tally.HEALTHY / total) * 100),
        DEGRADED: Math.round((tally.DEGRADED / total) * 100),
        CRITICAL: Math.round((tally.CRITICAL / total) * 100),
      },
    };
  }, [audits]);

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <Activity className="text-emerald-400" size={22} />
          Atlas · Salud del Fleet
        </h1>
        <p className="text-sm text-white/50 mt-1">
          El agente Atlas audita continuamente al resto de la flota para garantizar máximo rendimiento
        </p>
      </motion.div>

      {loading && <div className="text-white/40 text-sm py-12 text-center">cargando auditorías…</div>}
      {error && <div className="text-rose-400 text-sm py-12 text-center">{error}</div>}

      {!loading && !error && (
        <>
          {/* Hero verdict */}
          <motion.div
            key={latest?.id || 'empty'}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`${GLASS} p-6 mb-6`}
            style={{ borderColor: meta.border, background: `linear-gradient(135deg, ${meta.accent} 0%, rgba(255,255,255,0.04) 100%)` }}
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div style={{
                  width: 64, height: 64, borderRadius: '16px',
                  background: meta.accent, border: `1px solid ${meta.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={32} style={{ color: meta.color }} />
                </div>
                <div>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em',
                    color: meta.color, textTransform: 'uppercase',
                  }}>
                    {meta.label}
                  </div>
                  <div className="text-2xl text-white font-semibold mt-1">
                    Atlas reporta · {latest ? timeAgo(latest.created_at) : 'sin auditorías aún'}
                  </div>
                  <div className="text-sm text-white/55 mt-1">{meta.sub}</div>
                </div>
              </div>
              {latest?.alerted && (
                <div style={{
                  padding: '6px 12px', borderRadius: '999px',
                  background: 'rgba(251,113,133,0.15)', border: '1px solid rgba(251,113,133,0.4)',
                  color: '#fb7185', fontSize: '0.75rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <AlertTriangle size={14} />
                  Manager alertado
                </div>
              )}
            </div>

            {latest && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
                {[
                  { label: 'Vivos',     value: latest.alive_count,    color: '#34d399' },
                  { label: 'Sin pulso', value: latest.stale_count,    color: '#facc15' },
                  { label: 'Crashed',   value: latest.crashed_count,  color: '#fb7185' },
                  { label: 'Atascados', value: latest.stuck_messages, color: '#a78bfa' },
                  { label: 'Fallos · 1h', value: latest.failed_1h,    color: '#fb923c' },
                ].map((s) => (
                  <div key={s.label} style={{
                    padding: '10px 14px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    <div style={{ fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', marginTop: 2 }}>{s.value}</div>
                    <div style={{ marginTop: 4, height: 2, width: 24, background: s.color, borderRadius: 2 }} />
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Findings list */}
          {latest?.findings && latest.findings.length > 0 && (
            <div className={`${GLASS} p-5 mb-6`}>
              <h3 className="text-sm font-semibold text-white tracking-tight mb-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                Hallazgos del último audit ({latest.findings.length})
              </h3>
              <div className="space-y-2">
                {latest.findings.map((f, i) => {
                  const sev = SEVERITY_META[f.severity] || SEVERITY_META.info;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '10px 12px', borderRadius: '10px',
                        background: 'rgba(255,255,255,0.03)',
                        borderLeft: `3px solid ${sev.color}`,
                      }}
                    >
                      <div style={{
                        fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em',
                        color: sev.color, padding: '2px 6px', borderRadius: '4px',
                        background: `${sev.color}1A`, marginTop: 2, flexShrink: 0,
                      }}>{sev.label}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium">
                          {FINDING_LABELS[f.kind] || f.kind}
                          {f.agent && (
                            <span className="text-white/40 font-normal"> · {f.agent}</span>
                          )}
                        </div>
                        <div className="text-xs text-white/55 mt-0.5">{f.detail}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 24h trend */}
          <div className={`${GLASS} p-5 mb-6`}>
            <h3 className="text-sm font-semibold text-white tracking-tight mb-3">
              Distribución de auditorías · últimas 24h
              <span className="text-white/40 font-normal ml-2">({trend24h.total} audits)</span>
            </h3>
            <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
              {['HEALTHY', 'DEGRADED', 'CRITICAL'].map((s) => (
                <motion.div
                  key={s}
                  initial={{ width: 0 }}
                  animate={{ width: `${trend24h.pct[s]}%` }}
                  transition={{ duration: 0.6 }}
                  style={{ background: STATUS_META[s].color }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs mt-2">
              {['HEALTHY', 'DEGRADED', 'CRITICAL'].map((s) => (
                <span key={s} style={{ color: STATUS_META[s].color }}>
                  ● {STATUS_META[s].label} <span className="text-white/45">{trend24h.pct[s]}%</span>
                </span>
              ))}
            </div>
          </div>

          {/* History */}
          <div className={`${GLASS} p-5`}>
            <h3 className="text-sm font-semibold text-white tracking-tight mb-3 flex items-center gap-2">
              <Clock size={14} className="text-white/55" />
              Historial reciente (últimas {audits.length})
            </h3>
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-2">
              {audits.map((a) => {
                const m = STATUS_META[a.status];
                return (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.02)',
                    fontSize: '0.78rem',
                  }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '999px',
                      background: m.accent, color: m.color,
                      fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.08em',
                    }}>{m.label}</span>
                    <span className="text-white/55 flex-1 truncate">
                      Vivos {a.alive_count} · Stale {a.stale_count} · Crashed {a.crashed_count} · Atascados {a.stuck_messages} · Fallos {a.failed_1h}
                    </span>
                    <span className="text-white/35 text-xs">{timeAgo(a.created_at)}</span>
                    {a.alerted && <AlertTriangle size={12} className="text-rose-400" />}
                  </div>
                );
              })}
              {audits.length === 0 && (
                <div className="text-white/40 text-sm py-4 text-center">
                  Atlas todavía no ha generado auditorías. Espera ~1 minuto tras el próximo deploy del fleet.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
