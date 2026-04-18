// ============================================================
// dashboard/src/views/LeadDetailView.jsx
//
// Sprint 5 — consolidated detail view for /leads/:id.
// Fetches /api/leads/:id/full, renders:
//   1. Header w/ LinkCells for every channel
//   2. Radiografía técnica
//   3. Attack Angle
//   4. 3-touch copy (email + whatsapp + instagram)
//   5. SPIN call script
//   6. Landing page iframe + visit count
//   7. Outreach events timeline
//   8. GHL quick link
//
// Gated behind VITE_DASHBOARD_V2_ENABLED — when off this view
// returns a soft-fallback card so legacy routers don't blow up.
// ============================================================

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import LinkCell from '../components/LinkCell';
import { apiGet } from '../lib/apiClient';

const V2_ENABLED = import.meta.env.VITE_DASHBOARD_V2_ENABLED === 'true';

function Section({ title, children, accent = '#60a5fa' }) {
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
      <h3 style={{ color: accent, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function TimelineRow({ event }) {
  const icon = {
    email: '✉️', whatsapp: '🟢', sms: '💬',
    phone: '📞', pixel: '👁️', ghl: '🔄', landing: '🪧',
  }[event.channel] || '•';
  const when = event.occurred_at ? new Date(event.occurred_at).toLocaleString() : '—';
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>
          <strong>{event.channel}</strong> · {event.event_type}
          {event.message_id ? <span style={{ color: '#9ca3af' }}> · {String(event.message_id).slice(0, 14)}…</span> : null}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{when}</div>
        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <details style={{ marginTop: 2 }}>
            <summary style={{ fontSize: '0.7rem', color: '#6b7280', cursor: 'pointer' }}>metadata</summary>
            <pre style={{ fontSize: '0.65rem', background: 'rgba(0,0,0,0.4)', padding: 6, borderRadius: 4 }}>
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

export default function LeadDetailView() {
  const { id } = useParams();
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoad]  = useState(true);

  useEffect(() => {
    if (!V2_ENABLED) { setLoad(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet(`/leads/${id}/full`);
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoad(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (!V2_ENABLED) {
    return (
      <div style={{ padding: 32, color: '#e5e7eb' }}>
        <h2>Vista detalle pronto</h2>
        <p style={{ color: '#9ca3af' }}>
          Activa <code>VITE_DASHBOARD_V2_ENABLED=true</code> para habilitar la vista completa del lead.
        </p>
        <Link to="/leads" style={{ color: '#60a5fa' }}>← Volver a Leads</Link>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 32, color: '#9ca3af' }}>Cargando lead…</div>;
  if (error)   return <div style={{ padding: 32, color: '#ef4444' }}>Error: {error}</div>;
  if (!data)   return <div style={{ padding: 32 }}>Sin datos</div>;

  const { lead, campaign_enriched_data: campaign, events_timeline: events, ghl_link: ghlLink, landing_page: landing } = data;
  const copy = campaign?.outreach_copy || {};
  const phoneDigits = lead.phone ? String(lead.phone).replace(/[^0-9+]/g, '') : null;
  const waDigits = lead.phone ? String(lead.phone).replace(/[^0-9]/g, '') : null;

  const score = lead.qualification_score || 0;
  const tier  = score >= 80 ? 'HOT' : score >= 50 ? 'WARM' : 'FRÍO';

  return (
    <div style={{ padding: '24px 32px', color: '#e5e7eb', maxWidth: 1100, margin: '0 auto' }}>
      <Link to="/leads" style={{ color: '#60a5fa', fontSize: '0.85rem' }}>← Volver a Leads</Link>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>{lead.business_name || 'Sin nombre'}</h1>
          <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
            {lead.industry || 'Servicios'} · {lead.metro_area || '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 999,
            background: score >= 80 ? 'rgba(239,68,68,0.15)' : score >= 50 ? 'rgba(234,179,8,0.15)' : 'rgba(59,130,246,0.15)',
            color:      score >= 80 ? '#ef4444' : score >= 50 ? '#eab308' : '#60a5fa',
            fontWeight: 700, fontSize: '0.8rem',
          }}>
            {tier} · {score}/100
          </span>
        </div>
      </div>

      {/* Channels */}
      <Section title="Canales de contacto">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {phoneDigits && <LinkCell url={`tel:${phoneDigits}`} type="phone" label={lead.phone} />}
          {waDigits     && <LinkCell url={`https://wa.me/${waDigits}`} type="whatsapp" label={lead.phone} />}
          {phoneDigits  && <LinkCell url={`sms:${phoneDigits}`} type="sms" label={lead.phone} />}
          {lead.email_address && <LinkCell url={`mailto:${lead.email_address}`} type="email" label={lead.email_address} truncate={40} />}
          {lead.website && <LinkCell url={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} type="web" label={lead.website} truncate={40} />}
          {lead.google_maps_url && <LinkCell url={lead.google_maps_url} type="maps" label="Google Maps" />}
          {lead.facebook_url && <LinkCell url={lead.facebook_url} type="facebook" label="Facebook" />}
          {lead.instagram_url && <LinkCell url={lead.instagram_url} type="instagram" label="Instagram" />}
          {lead.linkedin_url && <LinkCell url={lead.linkedin_url} type="linkedin" label="LinkedIn" />}
        </div>
      </Section>

      {/* Radiografía técnica */}
      <Section title="Radiografía técnica (Helena · Sam · Kai)" accent="#a855f7">
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: '#d1d5db' }}>
          {campaign?.radiography_technical || 'Sin radiografía aún.'}
        </pre>
      </Section>

      {/* Attack Angle */}
      <Section title="Attack Angle (Carlos)" accent="#f97316">
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: '#d1d5db' }}>
          {campaign?.attack_angle || 'Sin ángulo de ataque aún.'}
        </pre>
      </Section>

      {/* Copy 3-touch */}
      <Section title="Copy 3-touch (Ángela)" accent="#10b981">
        {copy.email_subject && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase' }}>Email · Asunto</div>
            <div style={{ fontWeight: 600 }}>{copy.email_subject}</div>
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: '#60a5fa' }}>Ver cuerpo HTML</summary>
              <div
                style={{ marginTop: 8, padding: 12, background: 'rgba(0,0,0,0.4)', borderRadius: 6, fontSize: '0.85rem' }}
                dangerouslySetInnerHTML={{ __html: copy.email_body || '' }}
              />
            </details>
          </div>
        )}
        {copy.whatsapp && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase' }}>WhatsApp</div>
            <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(16,185,129,0.08)', padding: 10, borderRadius: 6, fontSize: '0.85rem' }}>
              {copy.whatsapp}
            </div>
          </div>
        )}
        {copy.instagram && (
          <div>
            <div style={{ color: '#9ca3af', fontSize: '0.7rem', textTransform: 'uppercase' }}>Instagram DM</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{copy.instagram}</div>
          </div>
        )}
      </Section>

      {/* SPIN call script */}
      {campaign?.call_script && (
        <Section title="Call Script SPIN (humano)" accent="#eab308">
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', color: '#d1d5db' }}>
            {JSON.stringify(campaign.call_script, null, 2)}
          </pre>
        </Section>
      )}

      {/* Landing page */}
      {landing?.url && (
        <Section title="Landing page" accent="#22d3ee">
          <div style={{ color: '#9ca3af', fontSize: '0.8rem', marginBottom: 8 }}>
            <LinkCell url={landing.url} type="web" label={landing.url} truncate={60} />
            {landing.visit_count != null && (
              <span style={{ marginLeft: 12 }}>Visitas: <strong>{landing.visit_count}</strong></span>
            )}
          </div>
          <iframe
            src={landing.url}
            sandbox="allow-scripts allow-same-origin"
            title="landing-preview"
            style={{ width: '100%', height: 420, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, background: '#fff' }}
          />
        </Section>
      )}

      {/* Timeline */}
      <Section title="Outreach timeline" accent="#f472b6">
        {events && events.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {events.map((e) => <TimelineRow key={e.id} event={e} />)}
          </ul>
        ) : (
          <div style={{ color: '#9ca3af' }}>Sin eventos registrados aún.</div>
        )}
      </Section>

      {/* GHL */}
      {ghlLink && (
        <Section title="CRM (GoHighLevel)" accent="#fbbf24">
          <a
            href={ghlLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', padding: '8px 14px', borderRadius: 8,
              background: '#fbbf24', color: '#1f2937', fontWeight: 700, textDecoration: 'none',
            }}
          >
            Abrir en GHL →
          </a>
        </Section>
      )}
    </div>
  );
}
