import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './LeadsView.css';

// API base URL — in production this is the Vercel deployment URL
const API_URL = import.meta.env.VITE_API_URL || '';

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Email Draft Modal State ──────────────────────────────
  const [draftModal, setDraftModal] = useState({ open: false, lead: null, campaign: null });
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  useEffect(() => {
    fetchLeads();
    // Real-time subscription for live updates
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchLeads();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_enriched_data' }, () => {
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

  // ── Approve/Reject Handlers ────────────────────────────────
  const handleApproveEmail = async () => {
    if (!draftModal.campaign) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await fetch(`${API_URL}/api/approve-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: draftModal.campaign.id, action: 'approve' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult({ type: 'success', message: '✅ ¡Email enviado y lead sincronizado con GHL!' });
        setTimeout(() => { setDraftModal({ open: false, lead: null, campaign: null }); setActionResult(null); fetchLeads(); }, 2500);
      } else {
        setActionResult({ type: 'error', message: data.error || 'Error al aprobar' });
      }
    } catch (err) {
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectEmail = async () => {
    if (!draftModal.campaign || !rejectReason.trim()) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await fetch(`${API_URL}/api/approve-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: draftModal.campaign.id, action: 'reject', rejectionReason: rejectReason }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult({ type: 'success', message: '⚠️ Correo rechazado. El equipo lo revisará.' });
        setTimeout(() => { setDraftModal({ open: false, lead: null, campaign: null }); setRejectMode(false); setRejectReason(''); setActionResult(null); fetchLeads(); }, 2500);
      } else {
        setActionResult({ type: 'error', message: data.error || 'Error al rechazar' });
      }
    } catch (err) {
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const openDraftModal = (lead) => {
    setDraftModal({ open: true, lead, campaign: lead.campaign });
    setRejectMode(false);
    setRejectReason('');
    setActionResult(null);
  };

  const getTierClass = (score) => {
    if (score >= 50) return 'hot';
    if (score >= 30) return 'warm';
    return 'cold';
  };

  const getTierLabel = (score) => {
    if (score >= 50) return 'PROSPECTO CALIENTE';
    if (score >= 30) return 'PROSPECTO TIBIO';
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

            // Sanitizar valores inválidos como la cadena "null"
            const isValidStr = (...strs) => {
              for (const str of strs) {
                if (!str) continue;
                const t = String(str).trim();
                if (t === '' || t.toLowerCase() === 'null' || t.toLowerCase() === 'none' || t.toLowerCase() === 'n/a' || t.toLowerCase() === 'not found') continue;
                return t;
              }
              return null;
            };

            // Datos Extraídos
            const phoneStr = isValidStr(lead.phone, parsedProfile?.radar_parsed?.phone);
            const websiteStr = isValidStr(lead.website, lead.domain, parsedProfile?.radar_parsed?.domain, parsedProfile?.radar_parsed?.website);
            const emailStr = isValidStr(lead.email, parsedProfile?.email, parsedProfile?.radar_parsed?.email);
            
            // Generación de verdaderos enlaces válidos
            let finalPhone = null;
            if (phoneStr) {
               const digitsOnly = phoneStr.replace(/[^0-9]/g, '');
               finalPhone = (digitsOnly.length === 10) ? `1${digitsOnly}` : (digitsOnly.length > 0 ? digitsOnly : null);
            }

            const whatsappLink = finalPhone ? `https://wa.me/${finalPhone}` : null;
            const emailLink = emailStr ? `mailto:${emailStr}` : null;
            const phoneLink = finalPhone ? `tel:+${finalPhone}` : null;
            const smsLink = finalPhone ? `sms:+${finalPhone}` : null;
            
            const getSmartMapsLink = (...strs) => {
              const t = isValidStr(...strs);
              if (!t) return null;
              if (t.startsWith('http')) return t;
              if (!t.includes('.') || t.includes(' ') || t.includes(',')) {
                return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
              }
              return `https://${t}`;
            };

            const getSmartSocialLink = (domain, ...strs) => {
              let t = isValidStr(...strs);
              if (!t) return null;
              if (t.startsWith('http')) return t;
              if (!t.toLowerCase().includes(domain.toLowerCase())) {
                t = t.replace(/^@/, '');
                return `https://www.${domain}.com/${t}`;
              }
              return `https://${t}`;
            };

            const mapsLink = getSmartMapsLink(lead.google_maps_url, parsedProfile?.radar_parsed?.google_maps_url);
            let instagramLink = getSmartSocialLink('instagram', lead.instagram_url, parsedProfile?.instagram_profile, parsedProfile?.radar_parsed?.instagram_url);
            let facebookLink = getSmartSocialLink('facebook', lead.facebook_url, parsedProfile?.radar_parsed?.facebook_url);
            let linkedinLink = getSmartSocialLink('linkedin', lead.linkedin_url, parsedProfile?.radar_parsed?.linkedin_url);

            // Wipe useless root links
            if (instagramLink && instagramLink.match(/^https?:\/\/(www\.)?instagram\.com\/?$/i)) instagramLink = null;
            if (facebookLink && facebookLink.match(/^https?:\/\/(www\.)?facebook\.com\/?$/i)) facebookLink = null;
            if (linkedinLink && linkedinLink.match(/^https?:\/\/(www\.)?linkedin\.com\/?$/i)) linkedinLink = null;

            const rawMega = parsedProfile?.mega_profile || parsedProfile;
            const parsedBusinessName = lead.business_name || parsedProfile?.radar_parsed?.business_name || '';
            const fbAdsUrl = rawMega?.meta_ads?.adLibraryUrl || `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(parsedBusinessName)}&search_type=keyword_unordered`;
            let hasAdsIndicator = "Desconocido";
            if (lead.score_breakdown && typeof lead.score_breakdown === 'object') {
              const str = JSON.stringify(lead.score_breakdown).toLowerCase();
              if (str.includes('no meta ads') || str.includes('not in meta ad')) hasAdsIndicator = "No";
              else if (str.includes('has active meta ads') || str.includes('active ads')) hasAdsIndicator = "Sí";
            }
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === false) hasAdsIndicator = "No";
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === true) hasAdsIndicator = "Sí";

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

                {/* Sección de Análisis de IA Extendida */}
                <div className="mega-profile-card" style={{ marginTop: '16px', background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '16px', borderRadius: '12px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, transparent, #10b981, transparent)', opacity: 0.5 }}></div>
                  <h4 style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '1rem' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M21.18 8.02c-1-2.3-2.85-4.17-5.16-5.18"></path><path d="M2 12h5"></path><path d="M17 12h5"></path></svg>
                    Inteligencia Artificial: Análisis Web
                  </h4>
                  <div className="mega-profile-content" style={{ fontSize: '0.88rem', color: '#e2e8f0', display: 'flex', flexDirection: 'column', gap: '14px' }}>

                    {parsedProfile?.radar_parsed?.radar_summary && (
                      <div>
                        <strong style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
                          Resumen Situacional (Radar):
                        </strong>
                        <p style={{ marginTop: '6px', color: '#cbd5e1', fontStyle: 'italic', background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '6px', borderLeft: '2px solid #ef4444' }}>
                          "{parsedProfile.radar_parsed.radar_summary}"
                        </p>
                      </div>
                    )}

                    {(parsedProfile?.radiography_technical || lead.campaign?.radiography_technical) && (
                      <div>
                        <strong style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          Radiografía Técnica (Presencia Digital):
                        </strong>
                        <p style={{ marginTop: '6px', color: '#e2e8f0', lineHeight: '1.5' }}>
                          {(() => {
                            const val = parsedProfile?.radiography_technical || lead.campaign?.radiography_technical;
                            if (!val) return null;
                            return typeof val === 'object' ? JSON.stringify(val) : String(val).replace(/\n\n/g, ' ');
                          })()}
                        </p>
                      </div>
                    )}

                    {(parsedProfile?.attack_angle || lead.campaign?.attack_angle) && (
                      <div style={{ background: 'rgba(52, 211, 153, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
                        <strong style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                          Ángulo de Ataque & Oferta Sugerida:
                        </strong>
                        <p style={{ marginTop: '6px', color: '#f8fafc', fontWeight: '500', lineHeight: '1.5' }}>
                          {(() => {
                            const val = parsedProfile?.attack_angle || lead.campaign?.attack_angle;
                            if (!val) return null;
                            return typeof val === 'object' ? JSON.stringify(val) : String(val).replace(/\n\n/g, ' ');
                          })()}
                        </p>
                      </div>
                    )}

                    {(!parsedProfile && !lead.campaign) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span style={{ color: '#94a3b8' }}>Análisis completo en proceso (los agentes están procesando los datos)...</span>
                      </div>
                    )}

                    {/* NEW: ANUNCIOS META Y SEÑALES DE MARKETING */}
                    <div style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <strong style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                        Señales de Marketing:
                      </strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {/* Meta Ads Badge */}
                        <a 
                          href={rawMega?.meta_ads?.adLibraryUrl || `/api/redirect-ads?query=${encodeURIComponent(lead.business_name || '')}&fb_url=${encodeURIComponent(facebookLink || '')}`}
                          target="_blank" 
                          rel="noopener noreferrer" 
                          title="Búsqueda en Ads Library resolviendo ID automáticamente"
                          style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '4px', 
                            background: hasAdsIndicator === 'Sí' ? 'rgba(59,130,246,0.1)' : 'rgba(148, 163, 184, 0.1)', 
                            color: hasAdsIndicator === 'Sí' ? '#60a5fa' : '#94a3b8', 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.8rem', 
                            textDecoration: 'none',
                            border: hasAdsIndicator === 'Sí' ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(148,163,184,0.2)'
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                             <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                          </svg>
                          Ads Library: {hasAdsIndicator}
                        </a>
                        
                        {/* Direct Facebook Link if available */}
                        {facebookLink && (
                           <a 
                             href={facebookLink}
                             target="_blank" 
                             rel="noopener noreferrer" 
                             title="Ir al perfil de Facebook para ver Transparencia de la Página"
                             style={{ 
                               display: 'inline-flex', 
                               alignItems: 'center', 
                               gap: '4px', 
                               background: 'rgba(59,130,246,0.1)', 
                               color: '#60a5fa', 
                               padding: '4px 8px', 
                               borderRadius: '4px', 
                               fontSize: '0.8rem', 
                               textDecoration: 'none',
                               border: '1px solid rgba(59,130,246,0.2)'
                             }}
                           >
                             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                               <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                             </svg>
                             Ver Facebook
                           </a>
                        )}
                      </div>
                    </div>

                  </div>
                </div>

                {/* Email Draft / Approval Section */}
                <div style={{ marginTop: '16px' }}>
                  {(() => {
                    const approvalStatus = lead.campaign?.approval_status;
                    const outreachStatus = lead.campaign?.outreach_status;
                    const hasDraft = !!lead.campaign?.email_draft_html;
                    const ghlTag = lead.campaign?.ghl_tag;

                    // SENT — Already approved and dispatched
                    if (approvalStatus === 'APPROVED' || outreachStatus === 'SENT') {
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '12px', borderRadius: '8px' }}>
                          <span style={{ fontSize: '1.2rem' }}>✅</span>
                          <div>
                            <div style={{ color: '#10b981', fontWeight: 600, fontSize: '0.9rem' }}>Email Enviado</div>
                            {ghlTag && <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '2px' }}>GHL Tag: <strong style={{ color: ghlTag === 'Interesado' ? '#fbbf24' : '#60a5fa' }}>{ghlTag}</strong></div>}
                            {lead.campaign?.email_sent_at && <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '2px' }}>{new Date(lead.campaign.email_sent_at).toLocaleDateString('es')}</div>}
                          </div>
                        </div>
                      );
                    }

                    // REJECTED — Show rejection badge
                    if (approvalStatus === 'REJECTED') {
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: '12px', borderRadius: '8px' }}>
                          <span style={{ fontSize: '1.2rem' }}>❌</span>
                          <div>
                            <div style={{ color: '#f87171', fontWeight: 600, fontSize: '0.9rem' }}>Correo Rechazado</div>
                            {lead.campaign?.rejection_reason && <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px', fontStyle: 'italic' }}>"{lead.campaign.rejection_reason}"</div>}
                          </div>
                        </div>
                      );
                    }

                    // DRAFT with HTML ready — Show "Draft de Correo" button
                    if (hasDraft && approvalStatus !== 'APPROVED' && approvalStatus !== 'REJECTED' && outreachStatus !== 'SENT') {
                      return (
                        <button 
                          onClick={() => openDraftModal(lead)}
                          className="draft-email-btn"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                          </svg>
                          Draft de Correo
                        </button>
                      );
                    }

                    // PENDING/PROCESSING magnet — Generating
                    if (lead.campaign?.lead_magnet_status === 'PENDING' || lead.campaign?.lead_magnet_status === 'PROCESSING') {
                      return (
                        <button disabled className="draft-email-btn generating">
                          <svg className="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                          Preparando Draft...
                        </button>
                      );
                    }

                    // IDLE — No magnet yet, trigger generation
                    if (lead.campaign && (lead.campaign.lead_magnet_status === 'IDLE' || !lead.campaign.lead_magnet_status)) {
                      return (
                        <button 
                          onClick={async () => {
                            try {
                              await supabase.from('campaign_enriched_data')
                                .update({ lead_magnet_status: 'PENDING' })
                                .eq('id', lead.campaign.id);
                            } catch (e) { console.error(e); }
                          }}
                          className="draft-email-btn idle"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                          Generar Draft de Email
                        </button>
                      );
                    }

                    return null;
                  })()}
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

      {/* ═══════ EMAIL DRAFT PREVIEW MODAL ═══════ */}
      {draftModal.open && draftModal.campaign && (
        <div className="draft-modal-overlay" onClick={() => !actionLoading && setDraftModal({ open: false, lead: null, campaign: null })}>
          <div className="draft-modal" onClick={e => e.stopPropagation()}>
            <div className="draft-modal-header">
              <h3>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                Vista Previa del Correo
              </h3>
              <button className="close-modal-btn" onClick={() => !actionLoading && setDraftModal({ open: false, lead: null, campaign: null })}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="draft-modal-meta">
              <div><strong>Para:</strong> {draftModal.lead?.email || draftModal.lead?.email_address || 'Sin email'}</div>
              <div><strong>Negocio:</strong> {draftModal.lead?.business_name}</div>
              <div><strong>Asunto:</strong> {draftModal.campaign.email_draft_subject || 'Sin asunto'}</div>
            </div>

            <div className="draft-modal-preview">
              <iframe
                title="Email Preview"
                srcDoc={draftModal.campaign.email_draft_html}
                style={{ width: '100%', height: '450px', border: 'none', borderRadius: '8px', background: '#0D0D0D' }}
              />
            </div>

            {actionResult && (
              <div className={`draft-action-result ${actionResult.type}`}>
                {actionResult.message}
              </div>
            )}

            {!rejectMode ? (
              <div className="draft-modal-actions">
                <button 
                  className="draft-approve-btn" 
                  onClick={handleApproveEmail} 
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Enviando...' : '✅ Aprobar y Enviar'}
                </button>
                <button 
                  className="draft-reject-btn" 
                  onClick={() => setRejectMode(true)} 
                  disabled={actionLoading}
                >
                  ❌ Rechazar
                </button>
              </div>
            ) : (
              <div className="draft-reject-form">
                <label>¿Por qué rechazas este correo?</label>
                <textarea 
                  value={rejectReason} 
                  onChange={e => setRejectReason(e.target.value)} 
                  placeholder="Ej: El tono no es apropiado, quiero cambiar la oferta..."
                  rows={3}
                />
                <div className="draft-modal-actions">
                  <button 
                    className="draft-reject-confirm-btn" 
                    onClick={handleRejectEmail} 
                    disabled={actionLoading || !rejectReason.trim()}
                  >
                    {actionLoading ? 'Enviando...' : 'Enviar Feedback'}
                  </button>
                  <button 
                    className="draft-cancel-btn" 
                    onClick={() => { setRejectMode(false); setRejectReason(''); }} 
                    disabled={actionLoading}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
