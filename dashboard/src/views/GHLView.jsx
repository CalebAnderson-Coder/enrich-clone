import React, { useState, useEffect } from 'react';
import { apiGet } from '../lib/apiClient';

// Live snapshot of GHL COLD LEADS pipeline: NUEVO + CONTACTADO.
// Shows each lead's full ficha with email body (when sent).
export default function GHLView() {
  const [data, setData] = useState({ nuevo: [], contactado: [], counts: { nuevo: 0, contactado: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('contactado');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const fetchPipeline = async () => {
    try {
      const res = await apiGet('/ghl/pipeline');
      if (!res.ok) {
        setError(`Error ${res.status} al consultar GHL`);
        return;
      }
      const body = await res.json();
      setData(body);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPipeline();
    const i = setInterval(fetchPipeline, 30000);
    return () => clearInterval(i);
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const matches = (lead) => {
    if (!q) return true;
    const fields = [lead.business_name, lead.contact_email, lead.metro_area, lead.industry, lead.contact_phone];
    return fields.some(f => f && String(f).toLowerCase().includes(q));
  };

  const rows = (activeTab === 'contactado' ? data.contactado : data.nuevo).filter(matches);

  return (
    <div style={{ padding: '24px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>Go High Level</h2>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.9rem', marginTop: '4px', marginBottom: 0 }}>
            Pipeline COLD LEADS · snapshot en vivo (auto-refresh 30s)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', fontSize: '0.85rem' }}>
          <div style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', padding: '6px 14px', borderRadius: '999px', fontWeight: 600 }}>
            NUEVO: {data.counts?.nuevo ?? 0}
          </div>
          <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', padding: '6px 14px', borderRadius: '999px', fontWeight: 600 }}>
            CONTACTADO: {data.counts?.contactado ?? 0}
          </div>
        </div>
      </div>

      <input
        type="text"
        placeholder="Buscar por nombre, email, ciudad, rubro…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{
          width: '100%',
          padding: '11px 14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px',
          color: '#fff',
          fontSize: '0.9rem',
          outline: 'none',
          marginBottom: '16px',
        }}
      />

      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '4px', border: '1px solid rgba(255,255,255,0.06)' }}>
        {[
          { key: 'contactado', label: 'Contactado', color: '#10b981', count: data.counts?.contactado ?? 0 },
          { key: 'nuevo',      label: 'Nuevo',      color: '#60a5fa', count: data.counts?.nuevo ?? 0 },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              background: activeTab === tab.key ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: activeTab === tab.key ? tab.color : 'rgba(255,255,255,0.55)',
              transition: 'all 0.2s ease',
            }}
          >
            {tab.label} <span style={{ opacity: 0.7, marginLeft: '4px' }}>({tab.count})</span>
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'rgba(255,255,255,0.55)' }}>Cargando pipeline de Go High Level…</div>}
      {error && (
        <div style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '12px', borderRadius: '10px' }}>
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '60px 20px', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px' }}>
          {q ? `Sin resultados para "${searchQuery}"` : 'No hay leads en esta pestaña.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
        {rows.map(lead => {
          const isExpanded = expandedId === lead.opportunity_id;
          const tierColor = lead.qualification_score >= 80 ? '#ef4444' : lead.qualification_score >= 50 ? '#eab308' : '#60a5fa';
          const stampedAt = lead.ghl_moved_to_contactado_at || lead.email_sent_at;
          return (
            <div
              key={lead.opportunity_id}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={lead.business_name}>
                    {lead.business_name || '(sin nombre)'}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                    {lead.industry || 'Servicios'} · {lead.metro_area || '—'}
                  </div>
                </div>
                {lead.qualification_score != null && (
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '999px',
                    background: `${tierColor}20`,
                    color: tierColor,
                    border: `1px solid ${tierColor}50`,
                    whiteSpace: 'nowrap',
                  }}>
                    {lead.qualification_score}/100
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.82rem', color: 'rgba(255,255,255,0.75)' }}>
                {lead.contact_email && (
                  <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Email:</span> <a href={`mailto:${lead.contact_email}`} style={{ color: '#60a5fa' }}>{lead.contact_email}</a></div>
                )}
                {lead.contact_phone && (
                  <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Tel:</span> <a href={`tel:${lead.contact_phone}`} style={{ color: '#60a5fa' }}>{lead.contact_phone}</a></div>
                )}
                {lead.website && (
                  <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Web:</span> <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{lead.website.replace(/^https?:\/\//, '')}</a></div>
                )}
                {lead.rating != null && (
                  <div><span style={{ color: 'rgba(255,255,255,0.45)' }}>Rating:</span> ⭐ {lead.rating} <span style={{ color: 'rgba(255,255,255,0.4)' }}>({lead.review_count || 0} reseñas)</span></div>
                )}
              </div>

              {activeTab === 'contactado' && (
                <div style={{ marginTop: '6px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', padding: '10px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '6px' }}>
                    ✉️ Email enviado {stampedAt ? `· ${new Date(stampedAt).toLocaleString()}` : ''}
                  </div>
                  {lead.email_subject && (
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>
                      {lead.email_subject}
                    </div>
                  )}
                  {lead.email_body ? (
                    <>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'rgba(255,255,255,0.7)',
                          maxHeight: isExpanded ? 'none' : '90px',
                          overflow: 'hidden',
                          whiteSpace: 'pre-wrap',
                          position: 'relative',
                        }}
                      >
                        {stripHtml(lead.email_body)}
                      </div>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : lead.opportunity_id)}
                        style={{
                          marginTop: '6px',
                          background: 'transparent',
                          border: 'none',
                          color: '#10b981',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {isExpanded ? '▲ Ocultar' : '▼ Ver email completo'}
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                      Cuerpo del email no disponible en metadata.
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                {lead.google_maps_url && (
                  <a href={lead.google_maps_url} target="_blank" rel="noopener noreferrer" style={chipStyle}>Maps</a>
                )}
                <a
                  href={`https://app.gohighlevel.com/v2/location/${import.meta.env.VITE_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2'}/contacts/detail/${lead.contact_id}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ ...chipStyle, background: 'rgba(139,92,246,0.12)', color: '#a78bfa', borderColor: 'rgba(139,92,246,0.3)' }}
                >
                  Abrir en GHL ↗
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const chipStyle = {
  fontSize: '0.72rem',
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: '999px',
  background: 'rgba(96,165,250,0.08)',
  border: '1px solid rgba(96,165,250,0.25)',
  color: '#60a5fa',
  textDecoration: 'none',
};

function stripHtml(html) {
  if (!html) return '';
  // Basic tag strip + entity decode for plain-text preview.
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
