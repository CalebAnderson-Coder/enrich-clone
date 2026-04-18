import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Users, ShieldCheck, DollarSign, Brain,
  Radio, AlertTriangle, CheckCircle2, CircleDot,
} from 'lucide-react';
import { apiGet, API_BASE_URL } from '../lib/apiClient';
import {
  getMockStats, getMockBootstrapEvents, subscribeMockStream,
} from '../lib/cockpitMock';
import LiveAgentsFloor from '../components/LiveAgentsFloor';

// ─────────────────────────────────────────────────────────
// Mock flag. Flip to false to wire live /api/cockpit/* endpoints.
// This is the ONLY line to change once backend stream is ready.
const USE_MOCK = false;
// ─────────────────────────────────────────────────────────

const STATS_POLL_MS = 5000;
const MAX_EVENT_ROWS = 200;

const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

const AGENT_ROSTER = [
  { key: 'scout',    label: 'Scout',    emoji: '🛰️' },
  { key: 'angela',   label: 'Angela',   emoji: '✉️' },
  { key: 'helena',   label: 'Helena',   emoji: '🧭' },
  { key: 'sam',      label: 'Sam',      emoji: '📊' },
  { key: 'kai',      label: 'Kai',      emoji: '⚡' },
  { key: 'carlos',   label: 'Carlos',   emoji: '📞' },
  { key: 'davinci',  label: 'DaVinci',  emoji: '🎨' },
  { key: 'manager',  label: 'Manager',  emoji: '👔' },
  { key: 'verifier', label: 'Verifier', emoji: '🛡️' },
];

// ───────── Helpers ─────────

function fmtNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('es-MX');
}

function fmtPct(x, digits = 0) {
  if (x == null) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtUsd(n) {
  if (n == null) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return 'ahora';
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function fmtTime(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour12: false });
}

function statusColor(status) {
  if (status === 'ok') return 'bg-emerald-400';
  if (status === 'blocked') return 'bg-amber-400';
  return 'bg-red-500';
}

function agentColor(agent) {
  // Stable hue based on agent name, keeps the feed colorful on video.
  const palette = {
    scout:    'text-emerald-300',
    angela:   'text-sky-300',
    helena:   'text-fuchsia-300',
    sam:      'text-amber-300',
    kai:      'text-cyan-300',
    carlos:   'text-orange-300',
    davinci:  'text-purple-300',
    manager:  'text-slate-200',
    verifier: 'text-lime-300',
  };
  return palette[agent] || 'text-surface-200';
}

// ───────── Sub-components ─────────

function KpiCard({ icon: Icon, label, value, sub, accent = 'from-primary-500/30 to-fuchsia-500/20', children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`${GLASS} p-5 relative overflow-hidden`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-40 pointer-events-none`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-widest font-semibold text-white/60">{label}</span>
          {Icon && <Icon size={16} className="text-white/70" />}
        </div>
        <div className="text-3xl font-semibold text-white tracking-tight">{value}</div>
        {sub && <div className="text-xs text-white/50 mt-1">{sub}</div>}
        {children}
      </div>
    </motion.div>
  );
}

function TierBars({ hot = 0, warm = 0, cool = 0 }) {
  const total = Math.max(hot + warm + cool, 1);
  return (
    <div className="mt-3 flex items-center gap-1">
      <div className="h-1.5 bg-red-500 rounded-l" style={{ width: `${(hot / total) * 100}%` }} />
      <div className="h-1.5 bg-amber-400" style={{ width: `${(warm / total) * 100}%` }} />
      <div className="h-1.5 bg-sky-400 rounded-r" style={{ width: `${(cool / total) * 100}%` }} />
      <div className="ml-2 flex gap-2 text-[10px] font-mono text-white/70">
        <span className="text-red-300">H {hot}</span>
        <span className="text-amber-200">W {warm}</span>
        <span className="text-sky-200">C {cool}</span>
      </div>
    </div>
  );
}

function Funnel({ funnel }) {
  const stages = [
    { key: 'prospected', label: 'Prospectados' },
    { key: 'saved',      label: 'Guardados' },
    { key: 'enriched',   label: 'Enriquecidos' },
    { key: 'drafted',    label: 'Redactados' },
    { key: 'sent',       label: 'Enviados' },
    { key: 'replied',    label: 'Respondidos' },
  ];
  const max = Math.max(...stages.map(s => funnel?.[s.key] || 0), 1);

  return (
    <div className={`${GLASS} p-6`}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-white tracking-tight">Embudo de Producción · 24h</h3>
        <span className="text-[10px] uppercase tracking-widest text-white/50">Prospectado → Respondido</span>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {stages.map((s, i) => {
          const count = funnel?.[s.key] ?? 0;
          const prev  = i === 0 ? count : (funnel?.[stages[i - 1].key] ?? count);
          const drop  = prev > 0 ? 1 - (count / prev) : 0;
          const w     = `${Math.max((count / max) * 100, 6)}%`;
          return (
            <div key={s.key} className="flex flex-col">
              <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1.5">{s.label}</div>
              <div className="h-16 relative bg-white/5 rounded-lg overflow-hidden border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: w }}
                  transition={{ duration: 0.6, delay: i * 0.07 }}
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-500 via-fuchsia-500 to-amber-400"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-semibold text-white drop-shadow">{fmtNumber(count)}</span>
                </div>
              </div>
              {i > 0 && (
                <div className="mt-1 text-[10px] font-mono text-white/50 text-right">
                  -{(drop * 100).toFixed(0)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TranscriptFeed({ events }) {
  const [paused, setPaused] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (paused || !containerRef.current) return;
    containerRef.current.scrollTop = 0;
  }, [events, paused]);

  return (
    <div className={`${GLASS} flex flex-col`} style={{ height: 520 }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-emerald-400 animate-pulse" />
          <h3 className="text-sm font-semibold text-white tracking-tight">Transmisión en Vivo</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-white/50">
          <span>{events.length} eventos</span>
          {paused && <span className="text-amber-300">pausado</span>}
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed"
      >
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-3 px-5 py-1.5 border-b border-white/5 hover:bg-white/5"
            >
              <span className={`w-2 h-2 rounded-full ${statusColor(e.status)}`} />
              <span className="text-white/40 w-[70px] shrink-0">{fmtTime(e.ts)}</span>
              <span className={`w-[80px] shrink-0 font-semibold ${agentColor(e.agent)}`}>{e.agent}</span>
              <span className="w-[110px] shrink-0 text-white/60">{e.event_type}</span>
              <span className="w-[130px] shrink-0 text-white/80">{e.tool || '—'}</span>
              <span className="text-white/70 truncate">
                {e.metadata?.business_name && (
                  <>
                    {e.metadata.business_name}
                    {e.metadata.lead_tier && (
                      <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        e.metadata.lead_tier === 'HOT' ? 'bg-red-500/20 text-red-300'
                          : e.metadata.lead_tier === 'WARM' ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-sky-500/20 text-sky-300'
                      }`}>
                        {e.metadata.lead_tier}
                      </span>
                    )}
                  </>
                )}
                {e.metadata?.touch && <span className="text-white/50"> · touch {e.metadata.touch}</span>}
                {e.metadata?.note && <span className="text-red-300"> · {e.metadata.note}</span>}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {events.length === 0 && (
          <div className="p-10 text-center text-white/40 text-sm">Esperando eventos…</div>
        )}
      </div>
    </div>
  );
}

function AgentScoreboard({ agents }) {
  const byName = useMemo(() => {
    const map = new Map();
    (agents || []).forEach(a => map.set(a.agent, a));
    return map;
  }, [agents]);

  return (
    <div className={`${GLASS} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white tracking-tight">Marcador de Agentes</h3>
        <span className="text-[10px] uppercase tracking-widest text-white/50">9 activos</span>
      </div>

      <div className="space-y-2">
        {AGENT_ROSTER.map((a, i) => {
          const row = byName.get(a.key) || {};
          const success = row.success_rate ?? 0;
          return (
            <motion.div
              key={a.key}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10"
            >
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-base shrink-0">
                {a.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${agentColor(a.key)}`}>{a.label}</span>
                  <span className="text-[10px] font-mono text-white/50">{fmtRelative(row.last_seen)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1 bg-white/10 rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-primary-400"
                      style={{ width: `${success * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/60 w-10 text-right">{fmtPct(success)}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-white/50">
                  <span>{row.calls ?? 0} llamadas</span>
                  <span>·</span>
                  <span>{row.avg_duration_ms ?? 0}ms</span>
                  {row.zod_errors > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-semibold">
                      <AlertTriangle size={10} /> {row.zod_errors}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({ values = [], width = 180, height = 40 }) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(94,106,210)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="rgb(94,106,210)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="rgb(165,180,252)"
        strokeWidth="1.5"
        points={points}
      />
      <polygon
        fill="url(#sparkFill)"
        points={`0,${height} ${points} ${width},${height}`}
      />
    </svg>
  );
}

function LearningCurve({ memory }) {
  return (
    <div className={`${GLASS} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-fuchsia-300" />
          <h3 className="text-sm font-semibold text-white tracking-tight">Curva de Aprendizaje</h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/50">Memoria · 7d</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-xl font-semibold text-white">{fmtNumber(memory?.total_rows)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/50">aprendizajes</div>
        </div>
        <div>
          <div className="text-xl font-semibold text-emerald-300">+{fmtNumber(memory?.last_24h_added)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/50">últimas 24h</div>
        </div>
        <div>
          <div className="text-xl font-semibold text-primary-300">{fmtNumber(memory?.recall_hits)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/50">recall hits</div>
        </div>
      </div>

      <Sparkline values={memory?.sparkline || []} />
    </div>
  );
}

// ───────── Main view ─────────

export default function CockpitView() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);

  // ── Stats polling ──
  useEffect(() => {
    let alive = true;

    async function fetchStats() {
      try {
        if (USE_MOCK) {
          if (alive) setStats(getMockStats());
          return;
        }
        const res = await apiGet('/cockpit/stats?window=24h');
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setStats(data);
      } catch (err) {
        console.error('[cockpit] stats error:', err);
      }
    }

    fetchStats();
    const id = setInterval(fetchStats, STATS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ── Events bootstrap + live stream ──
  useEffect(() => {
    let alive = true;
    let unsubscribeMock = null;
    let eventSource = null;
    let reconnectTimer = null;
    let backoffMs = 1000;

    function prependEvent(ev) {
      if (!alive) return;
      setEvents(prev => {
        const next = [ev, ...prev];
        return next.length > MAX_EVENT_ROWS ? next.slice(0, MAX_EVENT_ROWS) : next;
      });
    }

    async function bootstrap() {
      if (USE_MOCK) {
        setEvents(getMockBootstrapEvents(30));
        unsubscribeMock = subscribeMockStream(prependEvent);
        setConnected(true);
        return;
      }

      // Real backend path
      try {
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const res = await apiGet(`/cockpit/events?since=${encodeURIComponent(since)}&limit=50`);
        if (res.ok) {
          const data = await res.json();
          if (alive) setEvents((data.events || []).slice().reverse());
        }
      } catch (err) {
        console.error('[cockpit] bootstrap error:', err);
      }

      connectStream();
    }

    function connectStream() {
      if (!alive) return;
      try {
        eventSource = new EventSource(`${API_BASE_URL}/cockpit/stream`);
        eventSource.onopen = () => {
          backoffMs = 1000;
          setConnected(true);
        };
        eventSource.onmessage = (msg) => {
          try {
            const ev = JSON.parse(msg.data);
            prependEvent(ev);
          } catch (err) {
            console.error('[cockpit] bad event payload', err);
          }
        };
        eventSource.onerror = () => {
          setConnected(false);
          eventSource?.close();
          if (!alive) return;
          reconnectTimer = setTimeout(connectStream, backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30000);
        };
      } catch (err) {
        console.error('[cockpit] stream init error:', err);
      }
    }

    bootstrap();

    return () => {
      alive = false;
      if (unsubscribeMock) unsubscribeMock();
      if (eventSource) eventSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const leads = stats?.leads;
  const agentsRunning = stats?.agents?.length || 0;
  const lastSeen = useMemo(() => {
    if (!stats?.agents) return null;
    const sorted = [...stats.agents].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    return sorted[0]?.last_seen;
  }, [stats]);

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
            <Activity className="text-primary-400" size={22} />
            Flota Empírika · Cockpit
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Sala de control de los 9 agentes · ventana 24h
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest">
          <CircleDot size={12} className={connected ? 'text-emerald-400 animate-pulse' : 'text-red-400'} />
          <span className={connected ? 'text-emerald-300' : 'text-red-300'}>
            {connected ? 'en línea' : 'desconectado'}
          </span>
        </div>
      </motion.div>

      {/* A) KPI row */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08 } },
        }}
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6"
      >
        <KpiCard
          icon={Users}
          label="Leads hoy"
          value={fmtNumber(leads?.total)}
          sub="HOT / WARM / COOL"
          accent="from-red-500/25 to-amber-500/10"
        >
          <TierBars hot={leads?.hot} warm={leads?.warm} cool={leads?.cool} />
        </KpiCard>

        <KpiCard
          icon={Radio}
          label="Agentes activos"
          value={`${agentsRunning} / 9`}
          sub={`último evento · ${fmtRelative(lastSeen)}`}
          accent="from-emerald-500/25 to-sky-500/10"
        />

        <KpiCard
          icon={ShieldCheck}
          label="Verifier pass rate"
          value={fmtPct(stats?.verifier?.pass_rate, 1)}
          sub={`${stats?.verifier?.blocked_low_quality ?? 0} bloqueados · ${stats?.verifier?.total_evaluated ?? 0} evaluados`}
          accent="from-lime-500/25 to-emerald-500/10"
        />

        <KpiCard
          icon={DollarSign}
          label="Costo hoy"
          value={fmtUsd(stats?.cost?.estimated_usd)}
          sub={`${fmtNumber(stats?.cost?.tokens_in)} in · ${fmtNumber(stats?.cost?.tokens_out)} out`}
          accent="from-primary-500/25 to-fuchsia-500/10"
        />
      </motion.div>

      {/* B) Funnel */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-6"
      >
        <Funnel funnel={stats?.funnel} />
      </motion.div>

      {/* Live Agents Floor — 9 glass cards + 60s timeline strip */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mb-6"
      >
        <LiveAgentsFloor events={events} />
      </motion.div>

      {/* C + D) Transcript + Scoreboard */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-3"
        >
          <TranscriptFeed events={events} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 space-y-6"
        >
          <AgentScoreboard agents={stats?.agents} />
          {/* E) Learning curve */}
          <LearningCurve memory={stats?.memory} />
          {/* Sprint 5 — Learning Progress (reply rate 30d + latest proposal) */}
          <LearningProgress />
        </motion.div>
      </div>

      {/* Footer watermark */}
      <div className="text-center text-[10px] uppercase tracking-[0.3em] text-white/30 pt-4 pb-2 flex items-center justify-center gap-2">
        <CheckCircle2 size={10} />
        Empírika AI Fleet · Control Room
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sprint 5 — Learning Progress panel
// Consumes GET /api/fleet/learning-summary.
// Graceful empty state when the endpoint / data is not ready.
// ─────────────────────────────────────────────────────────────
function LearningProgress() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiGet('/fleet/learning-summary');
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setData(json?.summary || null);
      } catch { /* silent */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className={`${GLASS} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Brain size={14} className="text-fuchsia-300" />
        <span className="text-sm font-semibold">Learning Progress · 30d</span>
      </div>
      <div className="text-[11px] uppercase tracking-widest text-white/40">Reply rate</div>
      <div className="text-2xl font-semibold mt-1">
        {data ? fmtPct(data.reply_rate_30d, 1) : '—'}
      </div>
      <div className="text-[11px] text-white/40">
        {data ? `${fmtNumber(data.replied_30d)} replies · ${fmtNumber(data.sent_30d)} sends` : 'cargando…'}
      </div>
      {data?.latest_proposal && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-fuchsia-300 mb-1">
            Última propuesta Estratega
          </div>
          <div className="text-sm">{data.latest_proposal.title || '—'}</div>
          <div className="text-[11px] text-white/40 mt-1">{fmtRelative(data.latest_proposal.created_at)}</div>
        </div>
      )}
    </div>
  );
}

