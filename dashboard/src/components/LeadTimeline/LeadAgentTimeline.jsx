// ============================================================
// src/components/LeadTimeline/LeadAgentTimeline.jsx
//
// Vista 5 — per-lead agent story timeline.
// Merges 4 Supabase sources into one chronological narrative:
//   1. leads row (birth event)
//   2. outreach_events (sends, replies, bounces)
//   3. agent_messages (inter-agent comms mentioning this lead)
//   4. agent_state (what each agent saved for this lead)
// ============================================================

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabaseAuth } from '../../lib/supabaseAuthClient';
import { getAgentMetaSafe, summarizePayload } from '../Newsroom/NewsroomBubble';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

// ─── Relative time ────────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '—';
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 10) return 'ahora';
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  const d = Math.floor(diff / 86400);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

// ─── Summarizers per kind ─────────────────────────────────────────────────────
function summarizeItem(item) {
  const { kind, raw } = item;

  if (kind === 'lead_created') {
    const score = raw.qualification_score ?? '—';
    const tier  = raw.lead_tier ?? '—';
    const by    = raw.scraped_by ?? 'Scout';
    return `Lead nacido. Sourceado por ${by}, score ${score} (${tier})`;
  }

  if (kind === 'agent_message') {
    // Reuse the NewsroomBubble summarizer that already handles all payload types
    const type = raw.payload?.type || raw.status || '—';
    const summary = summarizePayload(type, raw.payload);
    const from = raw.from_agent || '?';
    const to   = raw.to_agent   || '?';
    return `${from} → ${to}: ${summary}`;
  }

  if (kind === 'agent_state_write') {
    const key   = raw.key || '';
    const value = raw.value;
    if (key.startsWith('last_seo_audit:')) {
      const chars = JSON.stringify(value).length;
      return `Helena registró el audit (preview ${chars} chars)`;
    }
    if (key.startsWith('last_verdict:')) {
      const verdict = value?.verdict?.toUpperCase?.() ?? value?.decision?.toUpperCase?.() ?? 'UNKNOWN';
      const score   = value?.overall ?? value?.score ?? '?';
      return `Verifier: ${verdict} (score ${score}/10)`;
    }
    if (key.startsWith('last_draft:')) {
      const agent = raw.agent_name || 'Ángela';
      return `${agent} guardó borrador de email`;
    }
    if (key.startsWith('outbound_sent:')) {
      const to = value?.to ?? '';
      return `✉️ Email despachado por Ángela${to ? ` a ${to}` : ''}`;
    }
    // Fallback for other keys
    return `${raw.agent_name || 'Agente'} actualizó estado: ${key}`;
  }

  if (kind === 'outreach_event') {
    const meta = raw.metadata || {};
    const evType = raw.event_type;
    if (evType === 'sent') {
      const agent = meta.agent ?? raw.agent_name ?? 'Ángela';
      const to    = meta.to ?? '(destinatario)';
      return `Email enviado por ${agent} a ${to}`;
    }
    if (evType === 'replied')        return '📩 Lead respondió!';
    if (evType === 'followup_sent')  return 'Follow-up #1 enviado';
    if (evType === 'bounced')        return `❌ Email rebotó: ${meta.error ?? 'sin detalle'}`;
    if (evType === 'opened')         return '👁️ Lead abrió el email';
    // Generic fallback
    return `${evType} — canal ${raw.channel ?? '—'}`;
  }

  return '—';
}

// ─── Merge function: 4 sources → one sorted array ────────────────────────────
function mergeSources({ lead, outreachEvents, agentMessages, agentStates }) {
  const items = [];

  // 1. Lead birth
  if (lead) {
    items.push({
      id:           `lead_created_${lead.id}`,
      ts:           lead.created_at,
      kind:         'lead_created',
      agentDbName:  'scout',
      raw:          lead,
    });
  }

  // 2. Outreach events
  for (const ev of outreachEvents) {
    items.push({
      id:           `outreach_${ev.id}`,
      ts:           ev.occurred_at,
      kind:         'outreach_event',
      agentDbName:  ev.metadata?.agent?.toLowerCase?.()?.replace(/\s+empirika$/i, '') ?? 'angela',
      raw:          ev,
    });
  }

  // 3. Agent messages mentioning this lead
  for (const msg of agentMessages) {
    items.push({
      id:           `msg_${msg.id}`,
      ts:           msg.created_at,
      kind:         'agent_message',
      agentDbName:  msg.from_agent?.toLowerCase?.()?.replace(/\s+empirika$/i, '') ?? null,
      raw:          msg,
    });
  }

  // 4. Agent state writes for this lead
  for (const st of agentStates) {
    items.push({
      id:           `state_${st.key}_${st.agent_name}`,
      ts:           st.updated_at,
      kind:         'agent_state_write',
      agentDbName:  st.agent_name?.toLowerCase?.()?.replace(/\s+empirika$/i, '') ?? null,
      raw:          st,
    });
  }

  // Sort chronological (oldest first)
  items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return items;
}

// ─── Kind labels and default colors ──────────────────────────────────────────
const KIND_LABEL = {
  lead_created:     'Origen',
  agent_message:    'Mensaje',
  agent_state_write:'Estado',
  outreach_event:   'Outreach',
};

const KIND_DEFAULT_ACCENT = {
  lead_created:     '#4ade80',
  agent_message:    '#94a3b8',
  agent_state_write:'#94a3b8',
  outreach_event:   '#f472b6',
};

// ─── Single timeline item card ────────────────────────────────────────────────
function TimelineItem({ item, index }) {
  const [expanded, setExpanded] = useState(false);
  const meta   = item.agentDbName ? getAgentMetaSafe(item.agentDbName) : null;
  const accent = meta?.accent ?? KIND_DEFAULT_ACCENT[item.kind] ?? '#94a3b8';
  const label  = KIND_LABEL[item.kind] ?? item.kind;
  const summary = summarizeItem(item);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.05, 1.2) }}
      style={{ display: 'flex', gap: 12, position: 'relative' }}
    >
      {/* Dot on the rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
        <div
          style={{
            width: 12, height: 12, borderRadius: '50%',
            background: accent,
            border: `2px solid ${accent}66`,
            boxShadow: `0 0 6px ${accent}55`,
            marginTop: 4, flexShrink: 0,
          }}
        />
        {/* Connector line drawn by parent rail */}
      </div>

      {/* Card */}
      <div
        style={{
          flex: 1,
          marginBottom: 12,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid rgba(255,255,255,0.08)`,
          borderRadius: 10,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Kind pill */}
            <span
              style={{
                fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.12em', padding: '1px 6px', borderRadius: 4,
                background: `${accent}1a`, color: accent, border: `1px solid ${accent}44`,
              }}
            >
              {label}
            </span>
            {/* Agent name */}
            {meta && (
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: accent }}>
                {meta.display}
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.68rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
            {relTime(item.ts)}
          </span>
        </div>

        {/* Summary */}
        <p style={{ fontSize: '0.83rem', color: '#d1d5db', lineHeight: 1.45, margin: 0 }}>
          {summary}
        </p>

        {/* Detail toggle */}
        {item.raw && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              marginTop: 6, display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '0.68rem', padding: 0,
            }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'ocultar detalle' : 'ver detalle'}
          </button>
        )}

        <AnimatePresence>
          {expanded && (
            <motion.pre
              key="detail"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                overflow: 'hidden', marginTop: 6,
                fontSize: '0.62rem', color: '#9ca3af',
                background: 'rgba(0,0,0,0.35)', padding: 8, borderRadius: 6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(item.raw, null, 2)}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LeadAgentTimeline({ leadId }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;

    async function fetchAll() {
      try {
        // 4 parallel queries
        const [leadRes, eventsRes, msgsRes, statesRes] = await Promise.all([
          // 1. Lead row
          supabaseAuth
            .from('leads')
            .select('id, created_at, scraped_by, qualification_score, lead_tier, outreach_status, first_contact_date, last_contact_date')
            .eq('id', leadId)
            .eq('brand_id', BRAND_ID)
            .single(),

          // 2. Outreach events
          supabaseAuth
            .from('outreach_events')
            .select('id, lead_id, event_type, channel, occurred_at, metadata')
            .eq('lead_id', leadId)
            .eq('brand_id', BRAND_ID)
            .order('occurred_at', { ascending: true }),

          // 3. Agent messages mentioning this lead via payload->>'lead_id'
          supabaseAuth
            .from('agent_messages')
            .select('id, from_agent, to_agent, payload, status, created_at')
            .eq('brand_id', BRAND_ID)
            .eq('payload->>lead_id', leadId)
            .order('created_at', { ascending: true }),

          // 4. Agent state keys with lead_id suffix
          supabaseAuth
            .from('agent_state')
            .select('key, agent_name, value, updated_at')
            .eq('brand_id', BRAND_ID)
            .or([
              `key.eq.last_seo_audit:${leadId}`,
              `key.eq.last_draft:${leadId}`,
              `key.eq.last_verdict:${leadId}`,
              `key.eq.outbound_sent:${leadId}`,
            ].join(',')),
        ]);

        if (cancelled) return;

        // Collect errors (non-fatal — show what we have)
        const errs = [leadRes, eventsRes, msgsRes, statesRes]
          .filter(r => r.error)
          .map(r => r.error.message);

        const merged = mergeSources({
          lead:          leadRes.data   ?? null,
          outreachEvents: eventsRes.data ?? [],
          agentMessages:  msgsRes.data  ?? [],
          agentStates:    statesRes.data ?? [],
        });

        setItems(merged);
        if (errs.length) setError(`Partial load — ${errs.join('; ')}`);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [leadId]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section
      style={{
        margin: '16px 0',
        padding: 16,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
      }}
    >
      <h3
        style={{
          color: '#818cf8', fontSize: '0.85rem',
          textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16,
        }}
      >
        Historia del Lead · Agente por agente
      </h3>

      {error && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginBottom: 10 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Cargando historia…</div>
      )}

      {!loading && items.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
          Sin actividad de agentes registrada para este lead.
        </div>
      )}

      {!loading && items.length > 0 && (
        // Vertical rail + items
        <div style={{ position: 'relative', paddingLeft: 0 }}>
          {/* Left rail line */}
          <div
            style={{
              position: 'absolute',
              left: 9,          // center of the 20px dot column
              top: 4,
              bottom: 16,
              width: 2,
              background: 'rgba(100,116,139,0.35)', // slate-700 translucent
              borderRadius: 1,
            }}
          />
          <AnimatePresence>
            {items.map((item, i) => (
              <TimelineItem key={item.id} item={item} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
