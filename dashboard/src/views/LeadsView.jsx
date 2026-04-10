import React, { useState, useEffect } from 'react';
import './LeadsView.css';
import { supabase } from '../supabaseClient';

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchLeads = async () => {
    try {
      if (!supabase) {
         console.warn("Supabase no configurado en frontend.");
         if (loading) setLoading(false);
         return;
      }
      
      const { data: dbLeads, error } = await supabase
        .from('leads')
        .select('*, campaign_enriched_data(*)')
        .order('qualification_score', { ascending: false });

      if (error) {
        console.error('Error supabase leads:', error);
        return;
      }

      setLeads(dbLeads);
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
    if (score >= 80) return 'PROSPECTO HOT';
    if (score >= 50) return 'PROSPECTO WARM';
    return 'PROSPECTO FRÍO';
  };

  return (
    <div className="leads-view-container">
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="instaGradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f09433" />
            <stop offset="25%" stopColor="#e6683c" />
            <stop offset="50%" stopColor="#dc2743" />
            <stop offset="75%" stopColor="#cc2366" />
            <stop offset="100%" stopColor="#bc1888" />
          </linearGradient>
        </defs>
      </svg>

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
          {[1, 2, 3].map(i => <div key={i} className="skeleton-card" />)}
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
            
            const whatsappLink = lead.phone ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}` : null;
            const phoneLink = lead.phone ? `tel:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            const smsLink = lead.phone ? `sms:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            const websiteUrl = lead.website && !lead.website.startsWith('http') ? `https://${lead.website}` : lead.website;
            
            let instagramLink = lead.instagram_url || null;
            if (!instagramLink && lead.website && lead.website.includes('instagram.com/')) {
              instagramLink = lead.website;
            }
            const facebookLink = lead.facebook_url || null;
            const linkedinLink = lead.linkedin_url || null;
            const googleMapsLink = lead.google_maps_url || null;

            // Extract campaign values if present, else fallback to something useful or placeholder if requested exactly like screenshot.
            const campaignData = lead.campaign_enriched_data && lead.campaign_enriched_data[0] ? lead.campaign_enriched_data[0] : null;
            const rawMega = lead.mega_profile || {};
            
            const fbAdsUrl = rawMega?.meta_ads?.adLibraryUrl || `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(lead.business_name)}&search_type=keyword_unordered`;
            let hasAdsIndicator = "Desconocido";
            if (lead.score_breakdown && typeof lead.score_breakdown === 'object') {
              const str = JSON.stringify(lead.score_breakdown).toLowerCase();
              if (str.includes('no meta ads') || str.includes('not in meta ad')) hasAdsIndicator = "No";
              else if (str.includes('has active meta ads') || str.includes('active ads')) hasAdsIndicator = "Sí";
            }
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === false) hasAdsIndicator = "No";
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === true) hasAdsIndicator = "Sí";
            
            // We prioritize the new table structure, fallback to raw mega_profile properties if they somehow exist, else generic placeholder matching formatting.
            const resumen = campaignData?.radiography_technical || rawMega.situational_summary || `"Highly rated and trusted locally, but they lack an online presence. Setting up a professional website and local SEO would unlock massive growth."`;
            
            // To simulate "Puntos de dolor":
            const puntosDolor = campaignData?.attack_angle || rawMega.pain_points || `El sitio web de ${lead.business_name || 'este negocio'} tarda considerablemente en cargar en dispositivos móviles, lo que perjudica severamente su tasa de conversión. Además, carecen de optimización SEO local y sistemas de retargeting para visitantes que buscan sus servicios pero no contactan en la primera visita.`;
            
            const estrategia = campaignData?.outreach_copy || rawMega.strategic_recommendation || `¡Absolutamente! Aquí está mi recomendación para ${lead.business_name || 'este lead'}: **Attack Angle:** Necesitan urgentemente modernizar su presencia digital. Una página web optimizada con SEO local y un embudo de captación de leads les permitirán dejar de depender de referidos y captar clientes consistentemente en su ciudad.`;

            return (
              <div key={lead.id} className="lead-card">
                <div className="lead-card-header">
                  <h3 className="lead-name">{lead.business_name || 'Prospecto Sin Nombre'}</h3>
                  <div className={`badge ${tierClass}`}>
                    {getTierLabel(score)}
                  </div>
                </div>
                
                <div className="lead-meta">
                  <div className="meta-row subdued">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <span>{lead.industry || 'Servicios'} • {lead.metro_area || 'Desconocido'}</span>
                  </div>
                  
                  {lead.rating && (
                    <div className="meta-row highlight">
                      <svg className="gold-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                      <strong className="gold-text">{lead.rating}</strong>
                      <span className="gray-text">({lead.reviews_count || lead.review_count || 0} reseñas)</span>
                    </div>
                  )}
                  
                  {lead.phone && (
                    <div className="meta-row phone">
                      <svg className="pink-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      <span className="white-text">{lead.phone}</span>
                    </div>
                  )}

                  {(websiteUrl) && (
                    <div className="meta-row web">
                      <svg className="blue-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                      <a href={websiteUrl} target="_blank" rel="noopener noreferrer">{websiteUrl}</a>
                    </div>
                  )}

                  <div className="meta-row ads" style={{ marginTop: '4px' }}>
                    <svg className="gray-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    <span>Anuncios Meta: <strong style={{ color: hasAdsIndicator === 'No' ? '#4ade80' : hasAdsIndicator === 'Sí' ? '#ef4444' : '#9ca3af' }}>{hasAdsIndicator}</strong></span>
                    <a href={fbAdsUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '8px', fontSize: '0.8rem', color: '#60a5fa', textDecoration: 'underline' }}>Ver Ad Library</a>
                  </div>
                </div>

                <div className="lead-progress">
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${score}%` }}></div>
                  </div>
                  <span className="progress-text">{score}/100</span>
                </div>

                <div className="analysis-box">
                  <div className="analysis-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
                    <h4>Análisis del Prospecto</h4>
                  </div>
                  <div className="analysis-content">
                    <h5 className="red">Resumen Situacional:</h5>
                    <p className="italic">{resumen}</p>

                    <h5 className="red">Puntos de Dolor & Análisis:</h5>
                    <p>{puntosDolor}</p>

                    <h5 className="green">Estrategia de Venta:</h5>
                    <p>{estrategia}</p>
                  </div>
                </div>

                <div className="lead-contact-channels">
                  <h5 className="channels-title">CANALES DE CONTACTO DIRECTO</h5>
                  <div className="channels-row">
                    
                    {whatsappLink ? (
                      <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="channel-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg></div>
                    )}
                    
                    {facebookLink ? (
                      <a href={facebookLink} target="_blank" rel="noopener noreferrer" className="channel-btn">
                        <svg className="channel-icon-blue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg className="channel-icon-blue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg></div>
                    )}
                    
                    {instagramLink ? (
                      <a href={instagramLink} target="_blank" rel="noopener noreferrer" className="channel-btn">
                        <svg className="channel-icon-gradient" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg className="channel-icon-gradient" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg></div>
                    )}
                    
                    {linkedinLink ? (
                      <a href={linkedinLink} target="_blank" rel="noopener noreferrer" className="channel-btn">
                        <svg className="channel-icon-blue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg className="channel-icon-blue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg></div>
                    )}
                    
                    {googleMapsLink ? (
                      <a href={googleMapsLink} target="_blank" rel="noopener noreferrer" className="channel-btn primary">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>
                    )}
                    
                    {phoneLink ? (
                      <a href={phoneLink} className="channel-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></div>
                    )}
                    
                    {smsLink ? (
                      <a href={smsLink} className="channel-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.3 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>
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
