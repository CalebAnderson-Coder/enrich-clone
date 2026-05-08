import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Workflow, Send, Reply, ArrowRightLeft } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';
import StageColumn from '../components/PipelineFlow/StageColumn';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const REFRESH_MS = 30000;
const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

const STAGE_ORDER = ['Pre-pipeline', 'NUEVO', 'INTERESADO', 'CONTACTADO', 'Otros'];

// ── Stage-derivation helper ──
// Maps a lead + its replied-event count to a derived pipeline stage.
// Rules (from spec):
//   PENDING / no email yet → "Pre-pipeline"
//   outreach_status CONTACTED OR ≥2 replies → "CONTACTADO"
//   ≥1 replied event → "INTERESADO"
//   SENT and no replies → "NUEVO"
//   anything else (FAILED, BOUNCED, custom) → "Otros"
function deriveStage(lead, repliedCount) {
  const s = (lead.outreach_status || '').toUpperCase();
  if (!s || s === 'PENDING') return 'Pre-pipeline';
  if (s === 'CONTACTED' || repliedCount >= 2) return 'CONTACTADO';
  if (repliedCount >= 1) return 'INTERESADO';
  if (s === 'SENT' || s === 'APPROVED') return 'NUEVO';
  return 'Otros';
}

// ── Animated count-up number ──
function AnimatedNumber({ value, format = (v) => Math.round(v).toLocaleString('es-MX') }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (latest) => format(latest));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: 'easeOut' });
    return controls.stop;
  }, [value, mv]);
  return <motion.span>{display}</motion.span>;
}

function KpiCard({ icon: Icon, label, value, sub, accent = 'bg-emerald-400' }) {
  return (
    <div className={`${GLASS} p-5 relative overflow-hidden`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-widest font-semibold text-white/60">{label}</span>
        {Icon && <Icon size={14} className="text-white/60" />}
      </div>
      <div className="text-3xl font-semibold text-white tracking-tight">{value}</div>
      {sub && <div className="text-xs text-white/50 mt-1">{sub}</div>}
      <div className={`mt-3 h-[2px] w-10 rounded ${accent}`} />
    </div>
  );
}

export default function PipelineFlowView() {
  const [leads, setLeads]   = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let alive = true;
    async function fetchAll() {
      try {
        // Pull leads (cap 1000, lightweight projection).
        const leadRes = await supabaseAuth
          .from('leads')
          .select('id, business_name, outreach_status, qualification_score, lead_tier, metro_area, industry, created_at, last_contact_date')
          .eq('brand_id', BRAND_ID)
          .order('last_contact_date', { ascending: false, nullsFirst: false })
          .limit(1000);
        if (leadRes.error) throw leadRes.error;

        // Pull recent outreach events for reply detection + KPIs (28d window
        // covers reply-rate trend + stage transitions in last 24h).
        const since = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString();
        const eventRes = await supabaseAuth
          .from('outreach_events')
          .select('id, lead_id, event_type, occurred_at')
          .eq('brand_id', BRAND_ID)
          .gte('occurred_at', since)
          .limit(5000);
        if (eventRes.error) throw eventRes.error;

        if (!alive) return;
        setLeads(leadRes.data || []);
        setEvents(eventRes.data || []);
        setError(null);
      } catch (err) {
        console.error('[PipelineFlowView] fetch error:', err);
        if (alive) setError(err.message || 'Error cargando datos');
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Replied-event counts per lead.
  const repliesByLead = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      if (e.event_type === 'replied' && e.lead_id) {
        map.set(e.lead_id, (map.get(e.lead_id) || 0) + 1);
      }
    }
    return map;
  }, [events]);

  // Group leads into stages.
  const stages = useMemo(() => {
    const groups = new Map(STAGE_ORDER.map((s) => [s, []]));
    for (const lead of leads) {
      const stage = deriveStage(lead, repliesByLead.get(lead.id) || 0);
      const list = groups.get(stage) || groups.get('Otros');
      list.push(lead);
    }
    // Sort each group by recency (last_contact_date desc, fall back created_at).
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const da = new Date(a.last_contact_date || a.created_at || 0).getTime();
        const db = new Date(b.last_contact_date || b.created_at || 0).getTime();
        return db - da;
      });
    }
    const total = leads.length || 1;
    return STAGE_ORDER.map((stage) => {
      const list = groups.get(stage) || [];
      return {
        stage,
        count: list.length,
        share: list.length / total,
        samples: list.slice(0, 5).map((l) => l.business_name || '—'),
      };
    });
  }, [leads, repliesByLead]);

  // KPIs.
  const kpis = useMemo(() => {
    const total = leads.length;
    const now = Date.now();
    const sevenDays = now - 7 * 24 * 3600 * 1000;
    const oneDay   = now - 24 * 3600 * 1000;

    let sent7d = 0, replied7d = 0, transitions24h = 0;
    for (const e of events) {
      const ts = new Date(e.occurred_at).getTime();
      if (e.event_type === 'sent' && ts >= sevenDays) sent7d++;
      if (e.event_type === 'replied' && ts >= sevenDays) replied7d++;
      if (ts >= oneDay && (e.event_type === 'sent' || e.event_type === 'replied' || e.event_type === 'followup_sent')) {
        transitions24h++;
      }
    }
    const replyRate = sent7d > 0 ? replied7d / sent7d : 0;
    return { total, sent7d, replyRate, transitions24h };
  }, [leads, events]);

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <Workflow className="text-emerald-400" size={22} />
          Flujo del Pipeline
        </h1>
        <p className="text-sm text-white/50 mt-1">
          Cómo se mueven los leads de Empírika a través de las etapas comerciales
        </p>
      </motion.div>

      {/* Funnel KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={Workflow}
          label="Leads en pipeline"
          value={<AnimatedNumber value={kpis.total} />}
          sub="total trackeados"
          accent="bg-emerald-400"
        />
        <KpiCard
          icon={Send}
          label="Enviados · 7d"
          value={<AnimatedNumber value={kpis.sent7d} />}
          sub="emails salientes"
          accent="bg-sky-400"
        />
        <KpiCard
          icon={Reply}
          label="Reply rate · 7d"
          value={<AnimatedNumber value={kpis.replyRate * 100} format={(v) => `${v.toFixed(1)}%`} />}
          sub={`${kpis.sent7d} envíos`}
          accent="bg-fuchsia-400"
        />
        <KpiCard
          icon={ArrowRightLeft}
          label="Transiciones · 24h"
          value={<AnimatedNumber value={kpis.transitions24h} />}
          sub="eventos de etapa"
          accent="bg-amber-400"
        />
      </div>

      {/* Stage row */}
      <div className={`${GLASS} p-5 mb-6`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white tracking-tight">Distribución por etapa</h3>
          <span className="text-[10px] uppercase tracking-widest text-white/50">
            ancho ∝ volumen · top 5 más recientes
          </span>
        </div>

        {loading && <div className="text-white/40 text-sm py-12 text-center">cargando…</div>}
        {error && <div className="text-rose-400 text-sm py-12 text-center">{error}</div>}

        {!loading && !error && (
          <div className="flex gap-3 flex-wrap lg:flex-nowrap">
            {stages.map((s, i) => (
              <StageColumn
                key={s.stage}
                index={i}
                stage={s.stage}
                count={s.count}
                share={s.share}
                samples={s.samples}
              />
            ))}
          </div>
        )}
      </div>

      <div className="text-center text-[10px] uppercase tracking-[0.3em] text-white/30 pt-4 pb-2">
        Empírika · Vista de Pipeline
      </div>
    </div>
  );
}
