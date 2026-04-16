import React, { useState, useEffect } from 'react';
import './LeadsView.css';
import OutreachReviewModal from '../components/OutreachReviewModal';
import { apiGet, apiPost } from '../lib/apiClient';

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('pendientes');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [lightboxLabel, setLightboxLabel] = useState('');

  // Close lightbox on ESC
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') setLightboxUrl(null); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 15000);
    return () => clearInterval(interval);
  }, []);

  // Strip markdown fences and extract clean readable text from AI-generated fields
  const cleanText = (raw) => {
    if (!raw || typeof raw !== 'string') return raw;
    // Remove markdown code fences like ```json ... ``` or ``` ... ```
    let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    // If the remaining text looks like a JSON object, try to extract meaningful string
    if (cleaned.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleaned);
        const val = parsed.attack_angle || parsed.summary || parsed.radiography_technical
          || parsed.text || Object.values(parsed).find(v => typeof v === 'string' && v.length > 20);
        if (val) cleaned = val.trim();
      } catch (_) { /* keep cleaned as-is */ }
    }
    return cleaned;
  };

  // Determine lead status from campaign data + email draft availability
  // "pendiente" = ONLY when there is a valid English draft ready for client approval
  // "procesando" = agents still working (no draft yet)
  const getLeadStatus = (campaignData, emailDraft) => {
    if (campaignData?.outreach_status === 'REJECTED') return 'rechazado';
    if (campaignData?.outreach_status === 'APPROVED' || campaignData?.outreach_status === 'SENT' || campaignData?.email_sent_at) return 'enviado';
    const draft = emailDraft || '';
    const isValidDraft = draft.length > 50
      && !draft.toLowerCase().includes('max iterations')
      && !draft.toLowerCase().includes('agent encountered')
      && !draft.toLowerCase().includes('error');
    return isValidDraft ? 'pendiente' : 'procesando';
  };

  const fetchLeads = async () => {
    try {
      const res = await apiGet('/leads?limit=500');
      if (!res.ok) {
        console.error(`Error fetching /api/leads: ${res.status}`);
        return;
      }
      const payload = await res.json();
      const backendLeads = payload.leads || [];

      const joinedLeads = backendLeads.map(lead => {
        const campArray = lead.campaign_enriched_data || [];
        const camp = campArray[0] || null;
        const mega = lead.mega_profile || {};

        // Normalize outreach copy: check magnetData JSONB first (where dispatcher writes),
        // then fall back to outreach_copy column and mega_profile
        const magnetData = camp?.lead_magnets_data || {};
        let emailDraft = null;

        // Priority 1: Dispatcher writes email_draft_subject + email_draft_html into lead_magnets_data JSONB
        // Also check legacy keys: angela_email_subject / angela_email_body (older dispatcher format)
        const draftSubject = magnetData.email_draft_subject || magnetData.angela_email_subject;
        const draftHtml = magnetData.email_draft_html || magnetData.angela_email_body;
        if (draftSubject && draftHtml) {
          emailDraft = `Subject: ${draftSubject}\n\n${draftHtml}`;
        }

        // Priority 2: Raw outreach_copy column (legacy path)
        if (!emailDraft && camp?.outreach_copy) {
          emailDraft = camp.outreach_copy;
          if (emailDraft.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(emailDraft);
              const inner = parsed.outreach_copy || parsed;
              emailDraft = inner.subject
                ? `Subject: ${inner.subject}\n\n${inner.body || ''}`
                : inner.body || emailDraft;
            } catch (_) { /* keep as-is */ }
          }
        }

        // Priority 3: mega_profile.outreach (legacy path)
        if (!emailDraft && mega?.outreach?.subject) {
          emailDraft = `Subject: ${mega.outreach.subject}\n\n${mega.outreach.body || ''}`;
        }

        return {
          id: lead.id,
          business_name: lead.business_name || 'Sin Nombre',
          owner_name: lead.owner_name || null,
          phone: lead.phone || null,
          email: lead.email || lead.email_address || null,
          website: lead.website || null,
          rating: lead.rating || null,
          reviews_count: lead.review_count || 0,
          google_maps_url: lead.google_maps_url || null,
          city: lead.metro_area || null,
          industry: lead.industry || 'Servicios',
          metro_area: lead.metro_area || 'US',
          qualification_score: lead.qualification_score || (lead.rating ? Math.round(lead.rating * 18) : 50),
          score_breakdown: lead.score_breakdown || null,
          mega_profile: mega,
          facebook_url: lead.facebook_url || null,
          instagram_url: lead.instagram_url || null,
          linkedin_url: lead.linkedin_url || null,
          // Campaign join fields
          campaign_enriched_data: campArray,
          outreach_status: lead.outreach_status || camp?.outreach_status || null,
          email_draft: emailDraft,
          _status: getLeadStatus(camp, emailDraft),
        };
      });

      setLeads(joinedLeads);
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  // Filter leads by active tab
  const filteredLeads = leads.filter(lead => {
    if (activeTab === 'pendientes') return lead._status === 'pendiente';
    if (activeTab === 'enviados') return lead._status === 'enviado';
    if (activeTab === 'rechazados') return lead._status === 'rechazado';
    return true; // 'todos'
  });

  const tabCounts = {
    pendientes: leads.filter(l => l._status === 'pendiente').length,
    enviados: leads.filter(l => l._status === 'enviado').length,
    rechazados: leads.filter(l => l._status === 'rechazado').length,
    todos: leads.length,
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

  const handleOpenReview = (lead) => {
    setSelectedLead(lead);
    setIsModalOpen(true);
  };

  const handleRegenerate = async (leadId, agentNotes) => {
    try {
      const response = await apiPost(`/leads/${leadId}/regenerate-outreach`, { notes: agentNotes });
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error regenerating:', err);
      return null;
    }
  };

  const handleSaveOutreach = async (leadId, outreachData) => {
    try {
      const response = await apiPost(`/leads/${leadId}/outreach`, {
        outreach: outreachData,
        status: 'DRAFT'
      });
      if (!response.ok) throw new Error(`Save draft failed: ${response.status}`);

      setIsModalOpen(false);
      fetchLeads();
    } catch (err) {
      console.error('Error saving:', err);
      alert('Error al guardar el borrador');
    }
  };

  const handleApproveOutreach = async (leadId, outreachData) => {
    try {
      const response = await apiPost(`/leads/${leadId}/outreach`, {
        outreach: outreachData,
        status: 'APPROVED'
      });

      if (!response.ok) throw new Error('Failed to approve');

      setIsModalOpen(false);
      fetchLeads();
    } catch (err) {
      console.error('Error approving:', err);
      alert('Error al aprobar y enviar');
    }
  };

  const handleRejectLead = async (leadId, agentNotes) => {
    try {
      const response = await apiPost(`/leads/${leadId}/outreach`, {
        outreach: selectedLead?.mega_profile?.outreach || {},
        status: 'REJECTED',
        notes: agentNotes || ''
      });

      if (!response.ok) throw new Error('Failed to reject');

      setIsModalOpen(false);
      fetchLeads();
    } catch (err) {
      console.error('Error rejecting:', err);
      alert('Error al rechazar lead');
    }
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
          <strong style={{ color: '#fff' }}>{leads.length}</strong> Leads Totales
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="leads-tabs" style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '4px', border: '1px solid rgba(255,255,255,0.06)' }}>
        {[
          { key: 'pendientes', label: 'Pendientes', icon: '📋', color: '#eab308' },
          { key: 'enviados', label: 'Enviados', icon: '✅', color: '#10b981' },
          { key: 'rechazados', label: 'Rechazados', icon: '✗', color: '#ef4444' },
          { key: 'todos', label: 'Todos', icon: '📊', color: '#8b5cf6' },
        ].map(tab => (
          <button 
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              background: activeTab === tab.key ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: activeTab === tab.key ? tab.color : 'var(--text-secondary)',
              boxShadow: activeTab === tab.key ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
            }}
          >
            {tab.icon} {tab.label} <span style={{ opacity: 0.7, marginLeft: '4px', fontSize: '0.8rem' }}>({tabCounts[tab.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="leads-grid">
          {[1, 2, 3].map(i => <div key={i} className="skeleton-card" />)}
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="empty-leads-container">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <h3>{activeTab === 'pendientes' ? '¡Todo aprobado!' : 'No hay leads en esta categoría'}</h3>
          <p>{activeTab === 'pendientes' 
            ? 'Todos los leads han sido procesados. Revisa la pestaña "Enviados" para ver el historial.' 
            : 'Los agentes están buscando activamente posibles prospectos en segundo plano.'}</p>
        </div>
      ) : (
        <div className="leads-grid">
          {filteredLeads.map(lead => {
            const score = lead.qualification_score || 0;
            const tierClass = getTierClass(score);
            
            const whatsappLink = lead.phone ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}` : null;
            const phoneLink = lead.phone ? `tel:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            const smsLink = lead.phone ? `sms:${lead.phone.replace(/[^0-9+]/g, '')}` : null;
            const websiteUrl = lead.website && !lead.website.startsWith('http') ? `https://${lead.website}` : lead.website;

            // Build social links: use DB values if present, otherwise construct smart search links
            const mapsQuery = encodeURIComponent(`${lead.business_name} ${lead.city || lead.metro_area || ''}`);
            const googleMapsLink = lead.google_maps_url
              || `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

            const fbQuery = encodeURIComponent(lead.business_name || '');
            const facebookLink = lead.facebook_url
              || `https://www.facebook.com/search/top?q=${fbQuery}`;

            let instagramLink = lead.instagram_url || null;
            if (!instagramLink && lead.website && lead.website.includes('instagram.com/')) {
              instagramLink = lead.website;
            }
            // Fallback: Instagram search by business name
            if (!instagramLink) {
              const igQuery = encodeURIComponent((lead.business_name || '').replace(/\s+/g, ''));
              instagramLink = `https://www.instagram.com/${igQuery}`;
            }

            const linkedinLink = lead.linkedin_url || null;

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
            
            const resumen = cleanText(campaignData?.radiography_technical || rawMega.situational_summary) || `Evaluando el potencial digital de ${lead.business_name}...`;
            const puntosDolor = cleanText(campaignData?.attack_angle || rawMega.pain_points) || `Identificando ineficiencias en el embudo actual de ${lead.business_name}...`;
            
            // Strategy for card display: strategic recommendation (NOT the email draft, NOT the attack_angle which is shown above)
            let rawEstrategia = rawMega.strategic_recommendation || '';
            
            // Check if the outreach email draft is ready (use pre-normalized field from fetchLeads)
            const outreachCopy = lead.email_draft || campaignData?.outreach_copy || '';
            const hasEmailDraft = outreachCopy.length > 50 
              && !outreachCopy.toLowerCase().includes('max iterations')
              && !outreachCopy.toLowerCase().includes('agent encountered');
            
            const estrategia = rawEstrategia 
              || (hasEmailDraft ? 'Propuesta lista para revisión ↓' : `Angela está diseñando la propuesta personalizada para este prospecto.`);

            // Lead magnet image (if assigned by lead_magnet_worker)
            const magnetData = campaignData?.lead_magnets_data || {};
            const magnetImagePath = magnetData.image_path; // e.g. "assets/landing_niches/7. Paisajismo/img.png"
            // In production VITE_API_URL is "" so serverRoot is "" → relative URL like /assets/...
            // In dev VITE_API_URL is undefined so we fall back to localhost:4000
            const rawApiUrl = import.meta.env.VITE_API_URL !== undefined
              ? import.meta.env.VITE_API_URL
              : (import.meta.env.PROD ? '' : 'http://localhost:4000/api');
            const serverRoot = rawApiUrl.replace(/\/api$/, '');
            const encodedPath = magnetImagePath
              ? magnetImagePath.split('/').map(encodeURIComponent).join('/')
              : null;
            const magnetImageUrl = encodedPath ? `${serverRoot}/${encodedPath}` : null;
            const magnetLabel = magnetData.niche_folder || 'Preview';

            return (
              <div key={lead.id} className="lead-card">
                <div className="lead-card-header">
                  <h3 className="lead-name" title={lead.business_name}>{lead.business_name || 'Prospecto Sin Nombre'}</h3>
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
                    
                    {hasEmailDraft && (
                      <p style={{ color: '#10b981', fontSize: '0.8rem', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ✉️ Email draft listo — haz click en "Revisar Outreach" para ver y editar
                      </p>
                    )}
                  </div>
                </div>

                {magnetImageUrl && (
                  <div
                    className="magnet-preview"
                    onClick={() => { setLightboxUrl(magnetImageUrl); setLightboxLabel(magnetLabel); }}
                    style={{
                      margin: '12px 0',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      background: 'rgba(16, 185, 129, 0.05)',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(16,185,129,0.7)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(16,185,129,0.3)'}
                    title="Click to view full image"
                  >
                    <div style={{
                      padding: '10px 14px',
                      background: 'rgba(16, 185, 129, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      fontSize: '0.75rem',
                      color: '#10b981',
                      fontWeight: 600,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        LEAD MAGNET — {magnetLabel}
                      </div>
                      <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>🔍 Click to expand</span>
                    </div>
                  </div>
                )}

                <div className="lead-contact-channels">
                  <div className="outreach-action-row">
                    <button className="review-outreach-btn" onClick={() => handleOpenReview(lead)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      Revisar Outreach
                    </button>
                    {lead.outreach_status === 'APPROVED' && (
                      <span className="status-label approved">✓ Aprobado</span>
                    )}
                    {lead.outreach_status === 'SENT' && (
                      <span className="status-label approved" style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>✉️ Enviado</span>
                    )}
                    {lead.outreach_status === 'REJECTED' && (
                      <span className="status-label rejected" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>✗ Rechazado</span>
                    )}
                    {lead.outreach_status === 'DRAFT' && (
                      <span className="status-label draft" style={{ color: '#eab308', background: 'rgba(234, 179, 8, 0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>✏️ Borrador</span>
                    )}
                  </div>

                  <h5 className="channels-title small">CANALES DE CONTACTO DIRECTO</h5>
                  <div className="channels-row">
                    {/* WhatsApp — only active if phone exists */}
                    {whatsappLink ? (
                      <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="channel-btn" title={`WhatsApp: ${lead.phone}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                      </a>
                    ) : (
                      <div className="channel-btn" style={{ opacity: 0.25 }} title="No phone available">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                      </div>
                    )}

                    {/* Facebook — always active (search fallback) */}
                    <a href={facebookLink} target="_blank" rel="noopener noreferrer" className="channel-btn" title={`Search on Facebook: ${lead.business_name}`}>
                      <svg className="channel-icon-blue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                    </a>

                    {/* Instagram — always active (profile search fallback) */}
                    <a href={instagramLink} target="_blank" rel="noopener noreferrer" className="channel-btn" title={`Search on Instagram: ${lead.business_name}`}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    </a>

                    {/* Google Maps — always active (search fallback) */}
                    <a href={googleMapsLink} target="_blank" rel="noopener noreferrer" className="channel-btn primary" title={`Find on Google Maps: ${lead.business_name}`}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedLead && (
        <OutreachReviewModal 
          lead={selectedLead}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveOutreach}
          onApprove={handleApproveOutreach}
          onRegenerate={handleRegenerate}
          onReject={handleRejectLead}
        />
      )}

      {/* Lightbox for lead magnet images */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 20,
            right: 24,
            color: '#fff',
            fontSize: '1.5rem',
            cursor: 'pointer',
            opacity: 0.7,
            fontWeight: 300,
            lineHeight: 1,
          }}>✕</div>
          <div style={{
            marginBottom: '16px',
            color: '#10b981',
            fontWeight: 700,
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>📸 LEAD MAGNET — {lightboxLabel}</div>
          <img
            src={lightboxUrl}
            alt="Lead magnet"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '80vh',
              borderRadius: '16px',
              boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
              objectFit: 'contain',
              border: '1px solid rgba(16,185,129,0.3)',
            }}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'block';
            }}
          />
          <div style={{ display:'none', color:'#ef4444', marginTop:16, fontSize:'0.9rem' }}>
            ⚠️ Image not found at: {lightboxUrl}
          </div>
          <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
            Click anywhere or press ESC to close
          </div>
        </div>
      )}
    </div>
  );
}
