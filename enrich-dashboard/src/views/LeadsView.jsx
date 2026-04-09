import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './LeadsView.css';

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLeads();
    // Real-time subscription for live updates
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchLeads();
      })
      .subscribe();

    // Fallback polling every 30s
    const interval = setInterval(fetchLeads, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const fetchLeads = async () => {
    try {
      const { data: leadsData, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .order('qualification_score', { ascending: false });

      if (fetchError) throw fetchError;

      const { data: campaignData, error: campaignError } = await supabase
        .from('campaign_enriched_data')
        .select('*');

      let enrichedLeads = leadsData || [];
      if (!campaignError && campaignData) {
        enrichedLeads = enrichedLeads.map(lead => {
          const campaign = campaignData.find(c => c.prospect_id === lead.id);
          return { ...lead, campaign };
        });
      }

      setLeads(enrichedLeads);
      setError(null);
    } catch (err) {
      console.error('Error fetching leads from Supabase:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getTierClass = (score) => {
    if (score >= 80) return 'hot';
    if (score >= 50) return 'warm';
    return 'cold';
  };

  const getTierLabel = (score) => {
    if (score >= 80) return 'PROSPECTO CALIENTE';
    if (score >= 50) return 'PROSPECTO TIBIO';
    return 'PROSPECTO FRÍO';
  };

  return (
    <div className="leads-view-container">
      <div className="leads-header">
        <div>
          <h2>Leads Precualificados</h2>
          <p>Contactabilidad multicanal y análisis automatizado de prospectos</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: 'rgba(16,185,129,0.15)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>
            ● EN VIVO
          </div>
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: '#fff' }}>{leads.length}</strong> Prospectos
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', color: '#f87171', fontSize: '0.9rem' }}>
          ⚠️ Error conectando a la base de datos: {error}
        </div>
      )}

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
            const score = lead.qualification_score || 0;
            const tierClass = getTierClass(score);
            
            // Safe parsing of MEGA PROFILE
            let parsedProfile = null;
            if (lead.mega_profile) {
              try {
                parsedProfile = typeof lead.mega_profile === 'string' 
                  ? JSON.parse(lead.mega_profile) 
                  : lead.mega_profile;
              } catch (e) {
                console.error("Error parsing mega_profile", e);
              }
            }

            // Datos Extraídos
            const phoneStr = lead.phone || parsedProfile?.radar_parsed?.phone;
            const websiteStr = lead.website || parsedProfile?.radar_parsed?.website;
            const emailStr = lead.email;
            
            // Generación de verdaderos enlaces válidos
            let finalPhone = null;
            if (phoneStr) {
               const digitsOnly = phoneStr.replace(/[^0-9]/g, '');
               finalPhone = (digitsOnly.length === 10) ? `1${digitsOnly}` : digitsOnly;
            }

            const whatsappLink = finalPhone ? `https://wa.me/${finalPhone}` : null;
            const emailLink = emailStr ? `mailto:${emailStr}` : null;
            const phoneLink = finalPhone ? `tel:+${finalPhone}` : null;
            const smsLink = finalPhone ? `sms:+${finalPhone}` : null;
            const ensureHttps = (url) => {
              if (!url) return null;
              const t = url.trim();
              if (t.startsWith('http://') || t.startsWith('https://')) return t;
              return `https://${t}`;
            };

            const mapsLink = ensureHttps(lead.google_maps_url || parsedProfile?.radar_parsed?.google_maps_url || null);
            let instagramLink = ensureHttps(lead.instagram_url || parsedProfile?.instagram_profile || parsedProfile?.radar_parsed?.instagram_url || null);
            let facebookLink = ensureHttps(lead.facebook_url || parsedProfile?.radar_parsed?.facebook_url || null);
            let linkedinLink = ensureHttps(lead.linkedin_url || parsedProfile?.radar_parsed?.linkedin_url || null);
            
            // Wipe useless root links
            if (instagramLink && instagramLink.match(/^https?:\/\/(www\.)?instagram\.com\/?$/i)) instagramLink = null;
            if (facebookLink && facebookLink.match(/^https?:\/\/(www\.)?facebook\.com\/?$/i)) facebookLink = null;
            if (linkedinLink && linkedinLink.match(/^https?:\/\/(www\.)?linkedin\.com\/?$/i)) linkedinLink = null;

            return (
              <div key={lead.id} className="lead-card">
                <div className={`lead-tier-badge ${tierClass}`}>
                  {getTierLabel(score)}
                </div>
                
                <div className="lead-info-header">
                  <h3 className="lead-name">{lead.business_name || parsedProfile?.radar_parsed?.business_name || 'Prospecto Sin Nombre'}</h3>
                  <div className="lead-industry">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    {lead.industry || 'Servicios'} 
                    {lead.metro_area && ` • ${lead.metro_area}`}
                  </div>
                  
                  <div className="lead-details" style={{ marginTop: '8px', fontSize: '0.85rem', color: '#cbd5e1' }}>
                    {(lead.rating || parsedProfile?.radar_parsed?.rating) && (
                      <div style={{ marginBottom: '4px' }}>
                        <strong style={{ color: '#fbbf24' }}>★ {Number(lead.rating || parsedProfile?.radar_parsed?.rating).toFixed(1)}</strong> 
                        <span style={{ color: '#94a3b8', marginLeft: '4px' }}>({lead.review_count || parsedProfile?.radar_parsed?.review_count || 0} reseñas)</span>
                      </div>
                    )}
                    {phoneStr && (
                      <div style={{ marginBottom: '4px' }}>
                        📞 <span>{phoneStr}</span>
                      </div>
                    )}
                    <div style={{ wordBreak: 'break-all' }}>
                        🌐 {websiteStr ? <a href={websiteStr.startsWith('http') ? websiteStr : `https://${websiteStr}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{websiteStr}</a> : <span style={{ color: '#64748b' }}>Sin sitio web</span>}
                    </div>
                  </div>
                </div>

                <div className="lead-score-container">
                  <div className="score-bar-bg">
                    <div className="score-bar-fill" style={{ width: `${score}%` }}></div>
                  </div>
                  <div className="score-value">{score}/100</div>
                </div>

                {/* Sección de Análisis de IA */}
                <div className="mega-profile-card" style={{ marginTop: '16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '16px', borderRadius: '12px' }}>
                  <h4 style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M21.18 8.02c-1-2.3-2.85-4.17-5.16-5.18"></path></svg>
                    Análisis del Prospecto
                  </h4>
                  <div className="mega-profile-content" style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>

                    {parsedProfile?.radar_parsed?.radar_summary && (
                      <div style={{ marginTop: '0px' }}>
                        <strong style={{ color: '#f87171' }}>Resumen Situacional:</strong>
                        <p style={{ marginTop: '4px', color: '#cbd5e1', marginBottom: '12px', fontStyle: 'italic' }}>
                          "{parsedProfile.radar_parsed.radar_summary}"
                        </p>
                      </div>
                    )}

                    {lead.campaign?.radiography_technical && (
                      <div style={{ marginTop: '12px' }}>
                        <strong style={{ color: '#f87171' }}>Puntos de Dolor & Análisis:</strong>
                        <p style={{ marginTop: '4px', color: '#cbd5e1', marginBottom: '0' }}>
                          {lead.campaign.radiography_technical.replace(/\n\n/g, ' ')}
                        </p>
                      </div>
                    )}

                    {lead.campaign?.attack_angle && (
                      <div style={{ marginTop: '12px' }}>
                        <strong style={{ color: '#34d399' }}>Estrategia de Venta:</strong>
                        <p style={{ marginTop: '4px', color: '#cbd5e1', marginBottom: '0' }}>
                          {lead.campaign.attack_angle.replace(/\n\n/g, ' ')}
                        </p>
                      </div>
                    )}

                    {(!parsedProfile && !lead.campaign) && (
                      <p style={{ color: '#64748b', fontStyle: 'italic', margin: 0 }}>Esperando reporte de los agentes AI...</p>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 'auto' }}>
                  <div className="outreach-actions-title">Canales de Contacto Directo</div>
                  <div className="outreach-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
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
                    
                    {facebookLink && (
                      <a href={facebookLink} target="_blank" rel="noopener noreferrer" className="action-btn facebook" title="Facebook" style={{ color: '#1877F2' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                      </a>
                    )}

                    {instagramLink && (
                      <a href={instagramLink} target="_blank" rel="noopener noreferrer" className="action-btn instagram" title="Instagram" style={{ color: '#E1306C' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                      </a>
                    )}
                    
                    {linkedinLink && (
                      <a href={linkedinLink} target="_blank" rel="noopener noreferrer" className="action-btn linkedin" title="LinkedIn" style={{ color: '#0A66C2' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                      </a>
                    )}
                    
                    {mapsLink && (
                      <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="action-btn map" title="Google Maps" style={{ background: '#4285F4' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
                      </a>
                    )}
                    
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
