import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';
import SparkLine from '../components/QualityTrend/SparkLine';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const REFRESH_MS = 60000;
const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

const HISTOGRAM_BUCKETS = [
  { label: '0-20',   min: 0,  max: 20  },
  { label: '21-40',  min: 21, max: 40  },
  { label: '41-60',  min: 41, max: 60  },
  { label: '61-80',  min: 61, max: 80  },
  { label: '81-100', min: 81, max: 100 },
];

// Snap a date to the Monday of its ISO week, midnight UTC.
function startOfISOWeek(d) {
  const date = new Date(d);
  const day = date.getUTCDay() || 7; // Sun=0 → 7
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday;
}

export default function QualityTrendView() {
  const [leads, setLeads]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let alive = true;
    async function fetchLeads() {
      try {
        const res = await supabaseAuth
          .from('leads')
          .select('id, business_name, qualification_score, created_at')
          .eq('brand_id', BRAND_ID)
          .not('qualification_score', 'is', null)
          .order('created_at', { ascending: false })
          .limit(2000);
        if (res.error) throw res.error;
        if (!alive) return;
        setLeads(res.data || []);
        setError(null);
      } catch (err) {
        console.error('[QualityTrendView] fetch error:', err);
        if (alive) setError(err.message || 'Error cargando datos');
      } finally {
        if (alive) setLoading(false);
      }
    }
    fetchLeads();
    const id = setInterval(fetchLeads, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Aggregate by week — last 12 weeks, oldest → newest for the chart.
  const weekly = useMemo(() => {
    if (leads.length === 0) return [];
    const buckets = new Map();
    for (const l of leads) {
      if (l.qualification_score == null || !l.created_at) continue;
      const week = startOfISOWeek(l.created_at).toISOString();
      const cur = buckets.get(week) || { sum: 0, n: 0 };
      cur.sum += l.qualification_score;
      cur.n   += 1;
      buckets.set(week, cur);
    }
    const all = Array.from(buckets.entries())
      .map(([week, v]) => ({
        week,
        avgScore: Math.round(v.sum / v.n),
        n: v.n,
      }))
      .sort((a, b) => new Date(b.week) - new Date(a.week))
      .slice(0, 12)
      .reverse(); // oldest first
    return all;
  }, [leads]);

  const { trend, current, fourWeeksAgo, delta } = useMemo(() => {
    if (weekly.length === 0) return { trend: 'flat', current: 0, fourWeeksAgo: 0, delta: 0 };
    const cur = weekly[weekly.length - 1].avgScore;
    const idx4 = Math.max(0, weekly.length - 5);
    const prev = weekly[idx4].avgScore;
    const d = cur - prev;
    let t = 'flat';
    if (d >= 3) t = 'up';
    else if (d <= -3) t = 'down';
    return { trend: t, current: cur, fourWeeksAgo: prev, delta: d };
  }, [weekly]);

  // Histogram of CURRENT week's leads.
  const histogram = useMemo(() => {
    if (weekly.length === 0) return HISTOGRAM_BUCKETS.map((b) => ({ ...b, n: 0, share: 0 }));
    const currentWeek = weekly[weekly.length - 1].week;
    const startOfWeek = new Date(currentWeek).getTime();
    const endOfWeek   = startOfWeek + 7 * 24 * 3600 * 1000;
    const inWeek = leads.filter((l) => {
      const ts = new Date(l.created_at).getTime();
      return ts >= startOfWeek && ts < endOfWeek;
    });
    const total = inWeek.length || 1;
    return HISTOGRAM_BUCKETS.map((b) => {
      const n = inWeek.filter((l) => l.qualification_score >= b.min && l.qualification_score <= b.max).length;
      return { ...b, n, share: n / total };
    });
  }, [leads, weekly]);

  const trendColor = trend === 'up'   ? 'text-emerald-400'
                   : trend === 'down' ? 'text-rose-400'
                   :                    'text-slate-400';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendBucketColor = trend === 'up'   ? 'from-emerald-400 to-emerald-600'
                          : trend === 'down' ? 'from-rose-400 to-rose-600'
                          :                    'from-slate-400 to-slate-600';

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <Sparkles className="text-emerald-400" size={22} />
          Calidad del Sourcing
        </h1>
        <p className="text-sm text-white/50 mt-1">
          Cómo evoluciona el score promedio de los leads sourceados, semana a semana
        </p>
      </motion.div>

      {/* Annotation */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className={`${GLASS} p-5 mb-6 flex items-center gap-4`}
      >
        <TrendIcon size={28} className={trendColor} />
        <div className="flex-1">
          <div className="text-sm text-white/70">
            Calidad promedio de leads sourceados — esta semana:{' '}
            <span className="font-semibold text-white">{current}</span> vs hace 4 semanas:{' '}
            <span className="font-semibold text-white">{fourWeeksAgo}</span>
          </div>
          <div className={`text-xs mt-1 ${trendColor}`}>
            {delta > 0 ? `+${delta}` : delta} pts · tendencia {trend === 'up' ? 'al alza' : trend === 'down' ? 'a la baja' : 'estable'}
          </div>
        </div>
      </motion.div>

      {/* Line chart */}
      <div className={`${GLASS} p-5 mb-6`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white tracking-tight">Score promedio · últimas 12 semanas</h3>
          <span className="text-[10px] uppercase tracking-widest text-white/50">eje y · 0 a 100</span>
        </div>
        {loading && <div className="text-white/40 text-sm py-12 text-center">cargando…</div>}
        {error && <div className="text-rose-400 text-sm py-12 text-center">{error}</div>}
        {!loading && !error && <SparkLine points={weekly} trend={trend} />}
      </div>

      {/* Histogram of current week */}
      <div className={`${GLASS} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white tracking-tight">Distribución de score · esta semana</h3>
          <span className="text-[10px] uppercase tracking-widest text-white/50">5 buckets</span>
        </div>

        <div className="grid grid-cols-5 gap-3 items-end" style={{ height: 180 }}>
          {histogram.map((b, i) => {
            const h = `${Math.max(b.share * 100, 2)}%`;
            return (
              <div key={b.label} className="flex flex-col h-full justify-end items-center">
                <div className="w-full relative flex-1 flex items-end">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: h }}
                    transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: 'easeOut' }}
                    className={`w-full rounded-t-md bg-gradient-to-t ${trendBucketColor} relative`}
                  >
                    <span className="absolute -top-5 left-0 right-0 text-center text-[11px] font-mono text-white/80">
                      {b.n}
                    </span>
                  </motion.div>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mt-2">{b.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center text-[10px] uppercase tracking-[0.3em] text-white/30 pt-4 pb-2">
        Empírika · Tendencia de Calidad
      </div>
    </div>
  );
}
