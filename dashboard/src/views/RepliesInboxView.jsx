import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Inbox, ArrowRight, MapPin, Briefcase, Star } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const REFRESH_MS = 30000;
const WINDOW_HOURS = 72;
const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

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

function tierColor(score) {
  if (score == null) return '#94a3b8';
  if (score >= 80) return '#fb7185';
  if (score >= 60) return '#facc15';
  if (score >= 40) return '#60a5fa';
  return '#94a3b8';
}

export default function RepliesInboxView() {
  const [replies, setReplies] = useState([]);
  const [followups, setFollowups] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('todas');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

        const { data: events, error: evErr } = await supabaseAuth
          .from('outreach_events')
          .select('id, lead_id, event_type, occurred_at, metadata, channel')
          .eq('brand_id', BRAND_ID)
          .eq('event_type', 'replied')
          .gte('occurred_at', since)
          .order('occurred_at', { ascending: false })
          .limit(200);
        if (evErr) throw evErr;
        const rows = events || [];

        const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];
        let leadsById = new Map();
        if (leadIds.length > 0) {
          const { data: leads } = await supabaseAuth
            .from('leads')
            .select('id, business_name, industry, metro_area, qualification_score, lead_tier, email_address, email')
            .in('id', leadIds);
          for (const l of leads || []) leadsById.set(l.id, l);
        }

        // Para cada reply, ¿hay un evento del MISMO lead posterior que sea
        // de tipo follow-up del operador (sent / followup_sent / replied propio)?
        const followupSet = new Set();
        if (rows.length > 0) {
          const earliestReply = rows[rows.length - 1].occurred_at;
          const { data: followupEvents } = await supabaseAuth
            .from('outreach_events')
            .select('lead_id, event_type, occurred_at')
            .eq('brand_id', BRAND_ID)
            .in('event_type', ['sent', 'followup_sent'])
            .gte('occurred_at', earliestReply)
            .in('lead_id', leadIds)
            .limit(1000);
          for (const f of followupEvents || []) {
            const reply = rows.find((r) => r.lead_id === f.lead_id);
            if (reply && new Date(f.occurred_at) > new Date(reply.occurred_at)) {
              followupSet.add(reply.id);
            }
          }
        }

        const enriched = rows.map((r) => ({
          ...r,
          lead: leadsById.get(r.lead_id) || null,
        }));

        if (!alive) return;
        setReplies(enriched);
        setFollowups(followupSet);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message || 'Error cargando bandeja');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => {
    if (tab === 'pendientes') return replies.filter((r) => !followups.has(r.id));
    return replies;
  }, [replies, tab, followups]);

  const counts = {
    todas: replies.length,
    pendientes: replies.filter((r) => !followups.has(r.id)).length,
  };

  function previewFromMetadata(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const candidates = [meta.preview, meta.snippet, meta.body, meta.message, meta.text, meta.subject];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim().slice(0, 220);
    }
    return null;
  }

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <Inbox className="text-emerald-400" size={22} />
          Bandeja · Replies
        </h1>
        <p className="text-sm text-white/50 mt-1">
          Leads que respondieron en las últimas {WINDOW_HOURS} horas — orden cronológico
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {[
          { key: 'todas',       label: 'Todas',                       color: '#a78bfa' },
          { key: 'pendientes',  label: 'Sin responder de mi parte',   color: '#fb923c' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 14px', borderRadius: '10px',
              fontSize: '0.82rem', fontWeight: 600,
              background: tab === t.key ? `${t.color}1A` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${tab === t.key ? t.color + '66' : 'rgba(255,255,255,0.08)'}`,
              color: tab === t.key ? t.color : 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
            }}
          >
            {t.label} <span className="ml-1 opacity-70">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {loading && <div className="text-white/40 text-sm py-12 text-center">cargando…</div>}
      {error && <div className="text-rose-400 text-sm py-12 text-center">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className={`${GLASS} p-10 text-center`}>
          <Inbox size={32} className="text-white/30 mx-auto mb-3" />
          <p className="text-white/65">
            {tab === 'pendientes'
              ? 'No hay replies sin responder. Todo al día.'
              : `Sin replies en las últimas ${WINDOW_HOURS} horas. Tu equipo sigue contactando.`}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r, i) => {
            const lead = r.lead;
            const preview = previewFromMetadata(r.metadata);
            const score = lead?.qualification_score;
            const c = tierColor(score);
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`${GLASS} p-5 hover:bg-white/[0.07] transition-colors`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-white font-semibold text-base truncate">
                        {lead?.business_name || 'Lead sin nombre'}
                      </h3>
                      {score != null && (
                        <span style={{
                          padding: '2px 8px', borderRadius: '999px',
                          background: `${c}1A`, border: `1px solid ${c}55`,
                          color: c, fontSize: '0.7rem', fontWeight: 700,
                        }}>
                          {score}/100
                        </span>
                      )}
                      <span className="text-white/40 text-xs">{timeAgo(r.occurred_at)}</span>
                      {r.channel && (
                        <span className="text-white/40 text-xs">· canal: {r.channel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-white/55">
                      {lead?.industry && (
                        <span className="flex items-center gap-1">
                          <Briefcase size={12} /> {lead.industry}
                        </span>
                      )}
                      {lead?.metro_area && (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} /> {lead.metro_area}
                        </span>
                      )}
                      {lead?.lead_tier && (
                        <span className="flex items-center gap-1">
                          <Star size={12} /> {lead.lead_tier}
                        </span>
                      )}
                    </div>
                    {preview && (
                      <p className="text-sm text-white/75 mt-3 leading-relaxed italic">
                        "{preview}"
                      </p>
                    )}
                  </div>
                  {lead?.id && (
                    <Link
                      to={`/leads/${lead.id}`}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap"
                      style={{
                        background: 'rgba(96,165,250,0.12)',
                        border: '1px solid rgba(96,165,250,0.35)',
                        color: '#60a5fa',
                      }}
                    >
                      Abrir detalle <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
