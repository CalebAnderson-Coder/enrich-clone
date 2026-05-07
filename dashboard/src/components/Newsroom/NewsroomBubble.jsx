import React from 'react';
import { motion } from 'framer-motion';
import { Radar } from 'lucide-react';
import { AGENT_META } from '../LiveAgentsFloor/agentMeta';

// ─── Agent name normalizer ────────────────────────────────────────────────────
// Handles mixed-case names from agent_messages: 'Carlos Empirika', 'Verifier',
// 'Angela', 'DaVinci', 'Estratega', 'Kai', 'Helena', 'Manager', etc.
export function keyForAgent(name) {
  if (!name) return 'unknown';
  // Strip " Empirika" / " empirika" suffix (case-insensitive)
  const stripped = name.replace(/\s+empirika$/i, '').trim().toLowerCase();
  return stripped;
}

const ESTRATEGA_META = {
  display: 'Estratega',
  role: 'Strategy',
  accent: '#818cf8',
  Icon: Radar,
};

export function getAgentMetaSafe(name) {
  const key = keyForAgent(name);
  return AGENT_META[key] || ESTRATEGA_META;
}

// ─── Payload summarizer ───────────────────────────────────────────────────────
export function summarizePayload(type, payload) {
  if (!payload) return '—';
  const p = payload;
  try {
    switch (type) {
      case 'seo_audit_proposal':
        return `te propongo auditar ${p.name || p.website_url || p.business_name || '(negocio)'}`;
      case 'seo_audit':
        return `audita el sitio ${p.website_url || p.url || '(url)'}`;
      case 'seo_audit_completed':
        return `auditoría SEO completada para ${p.business_name || p.name || '(negocio)'} — ${p.score ?? '?'}/100`;
      case 'pattern_detected': {
        const candidates = p.detail?.candidates ?? p.candidates ?? p.count ?? '?';
        return `patrón detectado: ${candidates} candidatos${p.pattern ? ` · ${p.pattern}` : ''}`;
      }
      case 'outreach_batch_proposal': {
        const count = p.leads?.length ?? p.count ?? '?';
        return `propuesta de batch de outreach: ${count} lead${count !== 1 ? 's' : ''}`;
      }
      case 'paid_ads_strategy_ready':
        return `estrategia de paid ads lista${p.platform ? ` para ${p.platform}` : ''}${p.budget ? ` — presupuesto $${p.budget}` : ''}`;
      case 'verify_email_draft':
        return `revisando borrador de email${p.business_name ? ` para ${p.business_name}` : ''}`;
      case 'verify_email_verdict': {
        const score = p.overall ?? p.score ?? '?';
        if (p.verdict === 'pass' || p.decision === 'pass' || (typeof score === 'number' && score >= 7)) {
          return `draft aprobado, score ${score}/10`;
        }
        const issue = p.issues?.[0] ?? p.reason ?? 'revisar calidad';
        return `rewrite — score ${score}, ${issue}`;
      }
      case 'write_outbound_email':
        return `redactar email de outbound para ${p.business_name || p.email || '(lead)'}`;
      case 'outbound_completed':
        return `email enviado a ${p.email_address || p.email || '(destinatario)'} — GHL contact creado`;
      case 'outbound_failed':
        return `fallo al enviar email a ${p.email_address || p.email || '(destinatario)'}: ${p.error || p.reason || 'error desconocido'}`;
      case 'sourcing_completed': {
        const found = p.leads_found ?? p.count ?? '?';
        return `sourcing completado — ${found} leads encontrados`;
      }
      case 'sourcing_request':
        return `solicitar sourcing${p.industry ? ` · ${p.industry}` : ''}${p.location ? ` en ${p.location}` : ''}`;
      case 'qualify_lead':
        return `calificar lead: ${p.business_name || p.name || '(negocio)'}${p.tier ? ` — tier ${p.tier}` : ''}`;
      case 'weekly_strategy_review':
        return `revisión de estrategia semanal${p.week ? ` · semana ${p.week}` : ''}`;
      case 'batch_acknowledged': {
        const cnt = p.count ?? p.leads?.length ?? '?';
        return `batch de ${cnt} mensajes confirmado`;
      }
      default:
        return JSON.stringify(p).slice(0, 80);
    }
  } catch {
    return JSON.stringify(p).slice(0, 80);
  }
}

// ─── Relative time helper ─────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 10) return 'ahora';
  if (diff < 60) return `hace ${diff} segundos`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} minutos`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} horas`;
  return `hace ${Math.floor(diff / 86400)} días`;
}

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const styles = {
    processed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    pending:   'bg-amber-500/20  text-amber-300  border-amber-500/30',
    failed:    'bg-red-500/20    text-red-300    border-red-500/30',
  };
  const label = {
    processed: 'procesado',
    pending:   'pendiente',
    failed:    'fallido',
  };
  const cls = styles[status] || 'bg-white/10 text-white/50 border-white/10';
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border ${cls}`}>
      {label[status] || status || '—'}
    </span>
  );
}

// ─── The bubble ───────────────────────────────────────────────────────────────
export default function NewsroomBubble({ row }) {
  const fromMeta = getAgentMetaSafe(row.from_agent);
  const toMeta   = getAgentMetaSafe(row.to_agent);
  const FromIcon = fromMeta.Icon;

  const summary = summarizePayload(row.payload?.type || row.status, row.payload);
  const msgType = row.payload?.type || '—';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex gap-3"
    >
      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: `${fromMeta.accent}22`, border: `1.5px solid ${fromMeta.accent}55` }}
      >
        <FromIcon size={16} style={{ color: fromMeta.accent }} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold" style={{ color: fromMeta.accent }}>
            {row.from_agent}
          </span>
          <span className="text-white/40 text-xs">→</span>
          <span className="text-sm font-medium" style={{ color: toMeta.accent }}>
            {row.to_agent}
          </span>
          <span className="ml-auto text-[11px] text-white/40 shrink-0">{relativeTime(row.created_at)}</span>
        </div>

        {/* Type tag + status */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[11px] font-bold bg-white/10 text-white/70 px-2 py-0.5 rounded font-mono">
            {msgType}
          </span>
          <StatusPill status={row.status} />
        </div>

        {/* Summary */}
        <p className="text-sm text-white/75 leading-snug">{summary}</p>
      </div>
    </motion.div>
  );
}
