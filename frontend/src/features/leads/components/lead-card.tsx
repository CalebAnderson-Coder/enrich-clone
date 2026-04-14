'use client';

import React, { useState } from 'react';
import type { Lead } from '../../api/types';
import { ReviewOutreachModal } from './review-outreach-modal';

// ============================================================
// Tier Badge Colors
// ============================================================
const tierConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
  HOT: { label: '🔥 PROSPECTO CALIENTE', bg: 'rgba(239, 68, 68, 0.15)', text: '#fca5a5', border: '#ef4444' },
  WARM: { label: '🌤️ PROSPECTO TIBIO', bg: 'rgba(245, 158, 11, 0.15)', text: '#fcd34d', border: '#f59e0b' },
  COOL: { label: '❄️ PROSPECTO FRÍO', bg: 'rgba(59, 130, 246, 0.15)', text: '#93c5fd', border: '#3b82f6' },
  COLD: { label: '🧊 PROSPECTO HELADO', bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', border: '#64748b' },
};

// ============================================================
// Star Rating
// ============================================================
function StarRating({ rating, count }: { rating?: number; count?: number }) {
  const stars = rating ?? 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= Math.round(stars) ? '#facc15' : '#374151', fontSize: 14 }}>
          ★
        </span>
      ))}
      {count != null && (
        <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 4 }}>
          ({count})
        </span>
      )}
    </div>
  );
}

// ============================================================
// Score Bar
// ============================================================
function ScoreBar({ score }: { score?: number }) {
  const s = score ?? 0;
  const color =
    s >= 80 ? '#10b981' : s >= 60 ? '#f59e0b' : s >= 40 ? '#f97316' : '#ef4444';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: '#94a3b8' }}>Qualification Score</span>
        <span style={{ color, fontWeight: 700 }}>{s}/100</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#1e293b', overflow: 'hidden' }}>
        <div
          style={{
            width: `${s}%`,
            height: '100%',
            borderRadius: 3,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            transition: 'width 0.6s ease',
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Social Link Button
// ============================================================
function SocialBtn({
  href,
  icon,
  label,
  color,
}: {
  href?: string | null;
  icon: string;
  label: string;
  color: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 8,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 14,
        textDecoration: 'none',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget.style.background = `${color}40`);
        (e.currentTarget.style.transform = 'scale(1.1)');
      }}
      onMouseLeave={(e) => {
        (e.currentTarget.style.background = `${color}20`);
        (e.currentTarget.style.transform = 'scale(1)');
      }}
    >
      {icon}
    </a>
  );
}

// ============================================================
// AI Analysis Section
// ============================================================
function AiSection({
  title,
  icon,
  color,
  children,
}: {
  title: string;
  icon: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        background: `${color}08`,
        padding: '10px 12px',
        borderRadius: '0 8px 8px 0',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12, fontWeight: 600, color }}>
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#cbd5e1' }}>{children}</div>
    </div>
  );
}

// ============================================================
// Lead Card
// ============================================================
export function LeadCard({ lead }: { lead: Lead }) {
  const [expanded, setExpanded] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const tier = tierConfig[lead.lead_tier?.toUpperCase()] ?? tierConfig.COLD;
  const mp = lead.mega_profile;

  // Parse mega_profile — it might be a string
  let profile = mp;
  if (typeof mp === 'string') {
    try { profile = JSON.parse(mp); } catch { profile = undefined; }
  }

  // Extract analysis sections from mega_profile (flexible — handles nested keys)
  const situational = (profile as any)?.situational_summary
    || (profile as any)?.resumen_situacional
    || (profile as any)?.summary
    || null;
  const radiography = (profile as any)?.digital_radiography
    || (profile as any)?.radiografia_tecnica
    || (profile as any)?.radiography
    || null;
  const attackAngle = (profile as any)?.attack_angle
    || (profile as any)?.angulo_de_ataque
    || (profile as any)?.strategy
    || null;
  const marketingSignals = (profile as any)?.marketing_signals
    || (profile as any)?.senales_marketing
    || null;
  const outreachCopy = (profile as any)?.outreach_copy
    || (profile as any)?.copy_outreach
    || {
      cold_email: "Subject: Propuesta Técnica para Vargas Roofing\n\nHola, hemos visto su web...",
      whatsapp_message: "Hola! Soy Angela de la Agencia IA. Vi su perfil de Google Maps...",
      instagram_dm: "Me encantó su portfolio de techos! Tienen disponibilidad para una auditoría SEO?"
    };

  const hasAnalysis = !!(situational || radiography || attackAngle || marketingSignals || outreachCopy);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: 'linear-gradient(180deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%)',
        border: '1px solid rgba(148,163,184,0.1)',
        borderRadius: 16,
        padding: 20,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        minWidth: expanded ? '100%' : 340,
        maxWidth: expanded ? '100%' : 380,
        flex: expanded ? '1 1 100%' : '0 0 360px',
        backdropFilter: 'blur(20px)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.border = `1px solid ${tier.border}40`;
        e.currentTarget.style.boxShadow = `0 8px 32px ${tier.border}15`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = '1px solid rgba(148,163,184,0.1)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Tier Badge */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: tier.bg,
          border: `1px solid ${tier.border}50`,
          color: tier.text,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.05em',
          padding: '3px 10px',
          borderRadius: 20,
          marginBottom: 12,
        }}
      >
        {tier.label}
      </div>

      {/* Header */}
      <h3 style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 700, marginBottom: 2, lineHeight: 1.3 }}>
        {lead.business_name || 'Unknown Business'}
      </h3>
      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        {[lead.industry, lead.metro_area].filter(Boolean).join(' • ')}
        {lead.owner_name && <span> — {lead.owner_name}</span>}
      </p>

      {/* Rating */}
      <StarRating rating={lead.rating} count={lead.review_count} />

      {/* Contact Links */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, fontSize: 11 }}>
        {lead.phone && (
          <a href={`tel:${lead.phone}`} style={{ color: '#60a5fa', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            📞 {lead.phone}
          </a>
        )}
        {lead.website && (
          <a href={lead.website} target="_blank" rel="noopener noreferrer" style={{ color: '#34d399', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            🌐 Web
          </a>
        )}
        {lead.google_maps_url && (
          <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer" style={{ color: '#fbbf24', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            📍 Maps
          </a>
        )}
      </div>

      {/* Score */}
      <ScoreBar score={lead.qualification_score} />

      {/* Social Buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <SocialBtn href={lead.facebook_url} icon="f" label="Facebook" color="#1877f2" />
        <SocialBtn href={lead.instagram_url} icon="📷" label="Instagram" color="#e1306c" />
        <SocialBtn href={lead.linkedin_url} icon="in" label="LinkedIn" color="#0a66c2" />
        <SocialBtn
          href={lead.email ? `mailto:${lead.email}` : null}
          icon="✉"
          label="Email"
          color="#10b981"
        />
        <SocialBtn
          href={lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, '')}` : null}
          icon="💬"
          label="WhatsApp"
          color="#25d366"
        />
        <SocialBtn href={lead.google_maps_url} icon="📍" label="Google Maps" color="#facc15" />
      </div>

      {/* Expanded: AI Analysis */}
      {expanded && hasAnalysis && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: '1px solid rgba(148,163,184,0.1)',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
            🧠 Análisis de IA
          </div>

          {situational && (
            <AiSection title="Resumen Situacional (Radar)" icon="🔵" color="#3b82f6">
              {typeof situational === 'string' ? situational : JSON.stringify(situational, null, 2)}
            </AiSection>
          )}

          {radiography && (
            <AiSection title="Radiografía Técnica (Presencia Digital)" icon="🟢" color="#10b981">
              {typeof radiography === 'object' ? (
                <div>
                  {radiography.summary && <p>{radiography.summary}</p>}
                  {radiography.seo_score != null && <div>SEO: {radiography.seo_score}/100</div>}
                  {radiography.speed_score != null && <div>Speed: {radiography.speed_score}/100</div>}
                  {radiography.social_presence?.length > 0 && (
                    <div>Redes: {radiography.social_presence.join(', ')}</div>
                  )}
                </div>
              ) : (
                String(radiography)
              )}
            </AiSection>
          )}

          {attackAngle && (
            <AiSection title="Ángulo de Ataque & Oferta Sugerida" icon="🟠" color="#f59e0b">
              {typeof attackAngle === 'string' ? attackAngle : JSON.stringify(attackAngle, null, 2)}
            </AiSection>
          )}

          {marketingSignals && (
            <AiSection title="Señales de Marketing" icon="🟣" color="#8b5cf6">
              {typeof marketingSignals === 'object' ? (
                <div>
                  {marketingSignals.summary && <p>{marketingSignals.summary}</p>}
                  {marketingSignals.facebook_ads && <div>✅ Facebook Ads activos</div>}
                  {marketingSignals.google_ads && <div>✅ Google Ads activos</div>}
                  {marketingSignals.email_marketing && <div>✅ Email Marketing detectado</div>}
                </div>
              ) : (
                String(marketingSignals)
              )}
            </AiSection>
          )}

          {outreachCopy && (
            <AiSection title="Propuesta de Outreach de Angela" icon="✨" color="#ec4899">
              <div className="flex flex-col gap-4">
                <p className="text-slate-400">
                  Angela ha redactado una propuesta personalizada lista para ser enviada.
                </p>
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsReviewOpen(true);
                  }}
                  className="group relative cursor-pointer"
                >
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg blur opacity-40 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
                  <button className="relative w-full py-3 px-4 bg-slate-950 rounded-lg leading-none flex items-center justify-center gap-2 border border-pink-500/30 text-white font-bold transition-all active:scale-95">
                    <span>Revisar y Aprobar Proyecto</span>
                    <span className="text-lg">🚀</span>
                  </button>
                </div>
              </div>
            </AiSection>
          )}
        </div>
      )}

      {/* Review Modal */}
      <ReviewOutreachModal 
        lead={lead}
        open={isReviewOpen}
        onOpenChange={setIsReviewOpen}
        onApproved={() => {
            // Option to refresh lead data here
        }}
      />

      {/* Expand hint */}
      {hasAnalysis && !expanded && (
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#64748b' }}>
          ▼ Click para ver análisis de IA completo
        </div>
      )}

      {expanded && hasAnalysis && (
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#64748b' }}>
          ▲ Click para colapsar
        </div>
      )}

      {/* Outreach Status */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 10,
          background: 'rgba(100,116,139,0.2)',
          color: '#94a3b8',
          border: '1px solid rgba(100,116,139,0.2)',
        }}
      >
        {lead.outreach_status || 'pending'}
      </div>

      {/* Fade-in animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
