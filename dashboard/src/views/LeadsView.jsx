import React, { useState, useEffect } from 'react';
import './LeadsView.css';

const API_BASE = 'http://localhost:3001/api';

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzingIds, setAnalyzingIds] = useState(new Set());

  const handleAnalyzeLead = async (id) => {
    // Si ya lo estamos analizando, no repetir
    if (analyzingIds.has(id)) return;
    
    setAnalyzingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`${API_BASE}/leads/${id}/analyze`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.analysis) {
          setLeads(prev => prev.map(l => l.id === id ? { ...l, _analysis: data.analysis } : l));
        }
      }
    } catch (e) {
      console.error('Analysis error:', e);
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchLeads();
    // Refresh periodically
    const interval = setInterval(fetchLeads, 15000);
    return () => clearInterval(interval);
  }, []);

  // Automáticamente disparar análisis en leads calificados que no tienen
  useEffect(() => {
    leads.forEach(lead => {
      const score = lead.qualification_score || 0;
      // Trigger automático si es warm/hot y no se ha analizado ni se está analizando
      if (score >= 50 && !lead._analysis && !analyzingIds.has(lead.id)) {
        handleAnalyzeLead(lead.id);
      }
    });
  }, [leads, analyzingIds]);

  const fetchLeads = async () => {
    try {
      const res = await fetch(`${API_BASE}/leads`);
      if (res.ok) {
        const data = await res.json();
        // Preservar los analysis de la sesión actual al refrescar
        setLeads(prev => {
          const prevMap = new Map(prev.map(l => [l.id, l._analysis]));
          return data.leads.map(nl => ({
            ...nl,
            _analysis: prevMap.get(nl.id) || null
          }));
        });
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  const getTierClass = (score) => {
    if (score >= 80) return 'hot';
    if (score >= 50) return 'warm';
    return 'cold';
  };

  const getTierLabel = (score) => {
    if (score >= 80) return 'HOT LEAD';
    if (score >= 50) return 'WARM';
    return 'COLD';
  };

  return (
    <div className="leads-view-container">
      <div className="leads-header">
        <div>
          <h2>Leads Precualificados</h2>
          <p>Contactabilidad multicanal y pipeline de prospección</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: '#fff' }}>{leads.length}</strong> Leads Activos
        </div>
      </div>

      {loading ? (
        <div className="leads-grid">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton-card" />)}
        </div>
      ) : leads.length === 0 ? (
        <div className="empty-leads-container">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <h3>No hay leads precualificados</h3>
          <p>Los agentes están buscando activamente posibles prospectos en segundo plano. Aparecerán aquí pronto.</p>
        </div>
      ) : (
        <div className="leads-grid">
          {leads.map(lead => {
            // Generamos un "score" random si no viene de backend para visual, pero usaremos el ideal si existe.
            const score = lead.qualification_score || Math.max(40, Math.floor(Math.random() * 100));
            const tierClass = getTierClass(score);
            
            // Procesamiento seguro de links
            const whatsappLink = lead.phone ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}` : null;
            const emailLink = lead.email ? `mailto:${lead.email}` : null;
            const phoneLink = lead.phone ? `tel:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            const smsLink = lead.phone ? `sms:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            
            // Extraer instagram del website si existe o un posible handler (simulación frontend útil)
            let instagramLink = null;
            if (lead.website && lead.website.includes('instagram.com/')) {
              instagramLink = lead.website;
            } else {
               // Placeholder genérico amigable si sabemos que hay IG
               instagramLink = `https://instagram.com/`;
            }

            return (
              <div key={lead.id} className="lead-card">
                <div className={`lead-tier-badge ${tierClass}`}>
                  {getTierLabel(score)}
                </div>
                
                <div className="lead-info-header">
                  <h3 className="lead-name">{lead.business_name || 'Prospecto Sin Nombre'}</h3>
                  <div className="lead-industry">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    {lead.industry || 'Industria No Especificada'} 
                    {lead.metro_area && ` • ${lead.metro_area}`}
                  </div>
                  
                  <div className="lead-details" style={{ marginTop: '8px', fontSize: '0.85rem', color: '#cbd5e1' }}>
                    {lead.rating && (
                      <div style={{ marginBottom: '4px' }}>
                        <strong style={{ color: '#fbbf24' }}>★ {lead.rating}</strong> 
                        <span style={{ color: '#94a3b8', marginLeft: '4px' }}>({lead.review_count || 0} reseñas)</span>
                      </div>
                    )}
                    {lead.phone && (
                      <div style={{ marginBottom: '4px' }}>
                        📞 <span>{lead.phone}</span>
                      </div>
                    )}
                    <div style={{ wordBreak: 'break-all' }}>
                        🌐 {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{lead.website}</a> : <span style={{ color: '#64748b' }}>No website or link</span>}
                    </div>
                  </div>
                </div>

                <div className="lead-score-container">
                  <div className="score-bar-bg">
                    <div className="score-bar-fill" style={{ width: `${score}%` }}></div>
                  </div>
                  <div className="score-value">{score}/100</div>
                </div>

                {/* AI Analysis Section */}
                {score >= 50 && !lead._analysis && analyzingIds.has(lead.id) && (
                  <div style={{ marginTop: '16px' }}>
                    <div className="analyze-btn" disabled>
                      🧠 Procesando Contexto e IA Autonóma...
                    </div>
                  </div>
                )}

                {lead._analysis && !lead.mega_profile && (
                  <div className="lead-analysis-card">
                    <h4>🧠 Estrategia Inicial</h4>
                    <p><strong>Ángulo:</strong> {lead._analysis.attack_angle}</p>
                    <div className="copy-suggestion">
                       <strong>Copy Sugerido:</strong> 
                       <p>"{lead._analysis.copy_suggestion}"</p>
                    </div>
                  </div>
                )}

                {lead.mega_profile && (
                  <div className="mega-profile-card" style={{ marginTop: '16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '16px', borderRadius: '12px' }}>
                    <h4 style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M21.18 8.02c-1-2.3-2.85-4.17-5.16-5.18"></path></svg>
                      Información de Agentes (Mega Profile)
                    </h4>
                    <div className="mega-profile-content" style={{ fontSize: '0.85rem', color: '#e2e8f0', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                      {typeof lead.mega_profile === 'object' 
                        ? JSON.stringify(lead.mega_profile, null, 2)
                        : lead.mega_profile}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 'auto' }}>
                  <div className="outreach-actions-title">Puntos de contacto directo</div>
                  <div className="outreach-actions">
                    {whatsappLink && (
                      <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="action-btn whatsapp" title="WhatsApp">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                      </a>
                    )}
                    
                    {emailLink && (
                      <a href={emailLink} className="action-btn email" title="Correo Electrónico">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                      </a>
                    )}
                    
                    <a href={instagramLink} target="_blank" rel="noopener noreferrer" className="action-btn instagram" title="Instagram">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                    </a>
                    
                    {phoneLink && (
                      <>
                        <a href={phoneLink} className="action-btn phone" title="Llamada Telefónica">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                        </a>
                        <a href={smsLink} className="action-btn sms" title="Mensaje SMS">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
