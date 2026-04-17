import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import OutreachReviewModal from '../components/OutreachReviewModal';
import { apiGet, apiPost } from '../lib/apiClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import AnimatedCard from '@/components/shared/AnimatedCard';
import StaggerChildren, { staggerItem } from '@/components/shared/StaggerChildren';
import FadePresence, { fadeVariants } from '@/components/shared/FadePresence';
import { snappy } from '@/components/shared/motion';
import {
  CheckCircle,
  Inbox,
  Star,
  Phone,
  Globe,
  Flame,
  Mail,
  Image as ImageIcon,
  Pencil,
  MapPin,
  ExternalLink,
  Zap,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Status metadata — unified badge variants + labels
const STATUS_META = {
  pendiente:  { label: 'Borrador listo',  badgeClass: 'bg-semantic-warning/15 text-semantic-warning border-semantic-warning/40' },
  procesando: { label: 'Procesando',      badgeClass: 'bg-surface-700/60 text-surface-300 border-surface-600' },
  enviado:    { label: 'Enviado',         badgeClass: 'bg-semantic-success/15 text-semantic-success border-semantic-success/40' },
  rechazado:  { label: 'Rechazado',       badgeClass: 'bg-semantic-danger/15 text-semantic-danger border-semantic-danger/40' },
};

const TIER_META = {
  hot:  { label: 'HOT',  chipClass: 'bg-semantic-danger/20 text-semantic-danger border-semantic-danger/40', icon: Flame },
  warm: { label: 'WARM', chipClass: 'bg-semantic-warning/20 text-semantic-warning border-semantic-warning/40', icon: Zap },
  cold: { label: 'FRÍO', chipClass: 'bg-semantic-info/20 text-semantic-info border-semantic-info/40', icon: null },
};

const FILTERS = [
  { key: 'all',  label: 'Todos' },
  { key: 'hot',  label: 'HOT' },
  { key: 'warm', label: 'WARM' },
  { key: 'cold', label: 'FRÍO' },
];

export default function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('pendientes');
  const [tierFilter, setTierFilter] = useState('all');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [lightboxLabel, setLightboxLabel] = useState('');

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 15000);
    return () => clearInterval(interval);
  }, []);

  // Strip markdown fences and extract clean readable text from AI-generated fields
  const cleanText = (raw) => {
    if (!raw || typeof raw !== 'string') return raw;
    let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
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
        const magnetData = camp?.lead_magnets_data || {};
        let emailDraft = null;

        const draftSubject = magnetData.email_draft_subject || magnetData.angela_email_subject;
        const draftHtml = magnetData.email_draft_html || magnetData.angela_email_body;
        if (draftSubject && draftHtml) {
          emailDraft = `Subject: ${draftSubject}\n\n${draftHtml}`;
        }

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

  const getTier = (score) => {
    if (score >= 80) return 'hot';
    if (score >= 50) return 'warm';
    return 'cold';
  };

  // Counts per tier (across ALL leads, irrespective of status tab)
  const tierCounts = {
    all:  leads.length,
    hot:  leads.filter(l => getTier(l.qualification_score || 0) === 'hot').length,
    warm: leads.filter(l => getTier(l.qualification_score || 0) === 'warm').length,
    cold: leads.filter(l => getTier(l.qualification_score || 0) === 'cold').length,
  };

  // Status tab filter, then tier filter
  const filteredLeads = leads
    .filter(lead => {
      if (activeTab === 'pendientes') return lead._status === 'pendiente';
      if (activeTab === 'enviados')   return lead._status === 'enviado';
      if (activeTab === 'rechazados') return lead._status === 'rechazado';
      return true;
    })
    .filter(lead => {
      if (tierFilter === 'all') return true;
      return getTier(lead.qualification_score || 0) === tierFilter;
    });

  const tabCounts = {
    pendientes: leads.filter(l => l._status === 'pendiente').length,
    enviados:   leads.filter(l => l._status === 'enviado').length,
    rechazados: leads.filter(l => l._status === 'rechazado').length,
    todos: leads.length,
  };

  const handleOpenReview = (lead) => {
    setSelectedLead(lead);
    setIsModalOpen(true);
  };

  const handleRegenerate = async (leadId, agentNotes) => {
    const t = toast.loading('Angela regenerando outreach…');
    try {
      const response = await apiPost(`/leads/${leadId}/regenerate-outreach`, { notes: agentNotes });
      const data = await response.json();
      toast.success('Outreach regenerado', { id: t, description: 'Revisá el nuevo borrador.' });
      return data;
    } catch (err) {
      console.error('Error regenerating:', err);
      toast.error('Error regenerando', { id: t, description: err?.message || 'Reintentá en un momento.' });
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
      toast.success('Borrador guardado', { description: 'Podés volver a editarlo cuando quieras.' });
      fetchLeads();
    } catch (err) {
      console.error('Error saving:', err);
      toast.error('Error al guardar el borrador', { description: err?.message || '' });
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
      toast.success('Draft aprobado', { description: 'El outreach se enviará en la próxima cola.' });
      fetchLeads();
    } catch (err) {
      console.error('Error approving:', err);
      toast.error('Error al aprobar y enviar', { description: err?.message || '' });
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
      toast.success('Lead rechazado', { description: 'Lo removimos del pipeline activo.' });
      fetchLeads();
    } catch (err) {
      console.error('Error rejecting:', err);
      toast.error('Error al rechazar lead', { description: err?.message || '' });
    }
  };

  // ── Render helpers ───────────────────────────────────────────────
  const renderSkeletonGrid = () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-6 mt-4">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Card key={i} className="p-6 bg-surface-900 border-surface-700 flex flex-col gap-4 min-h-[500px]">
          <div className="flex justify-between items-start gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="rounded-lg border border-surface-700 p-4 flex flex-col gap-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex gap-2 mt-auto">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );

  const renderEmptyState = () => {
    const isAllApproved = activeTab === 'pendientes' && leads.length > 0;
    const Icon = isAllApproved ? CheckCircle : Inbox;
    const hotCount = tierCounts.hot;
    const copy = isAllApproved
      ? {
          title: '¡Todo aprobado!',
          body: hotCount > 0
            ? `${hotCount} leads HOT esperando tu approve → mirá la pestaña "Enviados" para ver el histórico.`
            : 'Todos los leads han sido procesados. Revisá la pestaña "Enviados" para ver el histórico.',
          cta: null,
        }
      : tierFilter !== 'all'
        ? {
            title: `No hay leads ${TIER_META[tierFilter].label}`,
            body: 'Probá limpiar el filtro o cambiar de pestaña.',
            cta: { label: 'Mostrar todos los tiers', action: () => setTierFilter('all') },
          }
        : {
            title: 'No hay leads en esta categoría',
            body: 'Los agentes están buscando activamente nuevos prospectos en segundo plano.',
            cta: null,
          };

    return (
      <FadePresence>
        <motion.div
          key={`empty-${activeTab}-${tierFilter}`}
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex flex-col items-center justify-center text-center py-20 px-6 rounded-2xl border border-dashed border-surface-700 bg-surface-900/40 mt-4"
        >
          <div className="w-20 h-20 rounded-full bg-primary-500/10 border border-primary-500/30 flex items-center justify-center mb-5">
            <Icon className="w-10 h-10 text-primary-500" />
          </div>
          <h3 className="text-2xl font-semibold text-surface-50 mb-2">{copy.title}</h3>
          <p className="text-surface-400 max-w-md mb-6">{copy.body}</p>
          {copy.cta && (
            <Button onClick={copy.cta.action} className="bg-primary-500 hover:bg-primary-600 text-white">
              {copy.cta.label}
            </Button>
          )}
        </motion.div>
      </FadePresence>
    );
  };

  return (
    <div className="p-10 flex flex-col gap-6 animate-in fade-in duration-300">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
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

      {/* Header */}
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-surface-400 bg-clip-text text-transparent mb-1">
            Leads Precualificados
          </h2>
          <p className="text-surface-400">Contactabilidad multicanal y pipeline de prospección</p>
        </div>
        <div className="bg-surface-800/60 border border-surface-700 px-4 py-2 rounded-full text-sm text-surface-400">
          <strong className="text-surface-50 num-tabular">{leads.length}</strong> Leads totales
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-surface-900/50 border border-surface-700 rounded-xl p-1">
        {[
          { key: 'pendientes', label: 'Pendientes' },
          { key: 'enviados',   label: 'Enviados' },
          { key: 'rechazados', label: 'Rechazados' },
          { key: 'todos',      label: 'Todos' },
        ].map(tab => (
          <motion.button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            whileTap={{ scale: 0.97 }}
            aria-pressed={activeTab === tab.key}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              activeTab === tab.key
                ? 'bg-surface-800 text-surface-50 shadow-elevation-1'
                : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50'
            )}
          >
            {tab.label}
            <span className="ml-2 opacity-70 text-xs font-medium num-tabular">({tabCounts[tab.key]})</span>
          </motion.button>
        ))}
      </div>

      {/* Tier filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-surface-500 mr-1">Filtrar por tier:</span>
        {FILTERS.map(f => {
          const active = tierFilter === f.key;
          const meta = TIER_META[f.key] || null;
          const activeChipClass = meta
            ? meta.chipClass
            : 'bg-surface-700 text-surface-50 border-surface-600';
          return (
            <motion.button
              key={f.key}
              type="button"
              onClick={() => setTierFilter(f.key)}
              whileTap={{ scale: 0.95 }}
              aria-pressed={active}
              aria-label={`Filtrar tier ${f.label}, ${tierCounts[f.key]} leads`}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                active
                  ? activeChipClass + ' ring-1 ring-white/10'
                  : 'bg-surface-900/60 text-surface-400 border-surface-700 hover:border-surface-600 hover:text-surface-200'
              )}
            >
              {meta?.icon ? <meta.icon className="h-3 w-3" aria-hidden="true" /> : null}
              {f.label}
              <span className="opacity-70 num-tabular">({tierCounts[f.key]})</span>
            </motion.button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        renderSkeletonGrid()
      ) : filteredLeads.length === 0 ? (
        renderEmptyState()
      ) : (
        <StaggerChildren
          staggerDelay={0.04}
          className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-6 mt-2"
        >
          {filteredLeads.map(lead => {
            const score = lead.qualification_score || 0;
            const tier = getTier(score);
            const tierMeta = TIER_META[tier];

            const whatsappLink = lead.phone ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}` : null;
            const websiteUrl = lead.website && !lead.website.startsWith('http') ? `https://${lead.website}` : lead.website;

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
            if (!instagramLink) {
              const igQuery = encodeURIComponent((lead.business_name || '').replace(/\s+/g, ''));
              instagramLink = `https://www.instagram.com/${igQuery}`;
            }

            const campaignData = lead.campaign_enriched_data && lead.campaign_enriched_data[0] ? lead.campaign_enriched_data[0] : null;
            const rawMega = lead.mega_profile || {};

            const fbAdsUrl = rawMega?.meta_ads?.adLibraryUrl || `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(lead.business_name)}&search_type=keyword_unordered`;
            let hasAdsIndicator = 'Desconocido';
            if (lead.score_breakdown && typeof lead.score_breakdown === 'object') {
              const str = JSON.stringify(lead.score_breakdown).toLowerCase();
              if (str.includes('no meta ads') || str.includes('not in meta ad')) hasAdsIndicator = 'No';
              else if (str.includes('has active meta ads') || str.includes('active ads')) hasAdsIndicator = 'Sí';
            }
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === false) hasAdsIndicator = 'No';
            if (rawMega?.meta_ads && rawMega.meta_ads.hasActiveAds === true) hasAdsIndicator = 'Sí';

            const resumen = cleanText(campaignData?.radiography_technical || rawMega.situational_summary) || `Evaluando el potencial digital de ${lead.business_name}...`;
            const puntosDolor = cleanText(campaignData?.attack_angle || rawMega.pain_points) || `Identificando ineficiencias en el embudo actual de ${lead.business_name}...`;

            let rawEstrategia = rawMega.strategic_recommendation || '';
            const outreachCopy = lead.email_draft || campaignData?.outreach_copy || '';
            const hasEmailDraft = outreachCopy.length > 50
              && !outreachCopy.toLowerCase().includes('max iterations')
              && !outreachCopy.toLowerCase().includes('agent encountered');

            const estrategia = rawEstrategia
              || (hasEmailDraft ? 'Propuesta lista para revisión ↓' : `Angela está diseñando la propuesta personalizada para este prospecto.`);

            const magnetData = campaignData?.lead_magnets_data || {};
            const magnetImagePath = magnetData.image_path;
            const rawApiUrl = import.meta.env.VITE_API_URL !== undefined
              ? import.meta.env.VITE_API_URL
              : (import.meta.env.PROD ? '' : 'http://localhost:4000/api');
            const serverRoot = rawApiUrl.replace(/\/api$/, '');
            const encodedPath = magnetImagePath
              ? magnetImagePath.split('/').map(encodeURIComponent).join('/')
              : null;
            const magnetImageUrl = encodedPath ? `${serverRoot}/${encodedPath}` : null;
            const magnetLabel = magnetData.niche_folder || 'Preview';

            // Status badge — prefer explicit outreach_status, fall back to _status
            const badgeStatus = (
              lead.outreach_status === 'APPROVED' || lead.outreach_status === 'SENT'
                ? 'enviado'
                : lead.outreach_status === 'REJECTED'
                  ? 'rechazado'
                  : lead.outreach_status === 'DRAFT'
                    ? 'pendiente'
                    : lead._status
            );
            const statusMeta = STATUS_META[badgeStatus] || STATUS_META.procesando;

            return (
              <motion.div key={lead.id} variants={staggerItem}>
                <AnimatedCard className="h-full">
                  <Card className="card-premium border-0 h-full p-6 flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-3">
                      <h3 className="text-xl font-bold text-surface-50 leading-tight flex-1" title={lead.business_name}>
                        {lead.business_name || 'Prospecto Sin Nombre'}
                      </h3>
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={snappy}
                      >
                        <Badge
                          variant="outline"
                          className={cn(
                            'uppercase tracking-wider font-bold text-[10px] flex items-center gap-1 px-2 py-1',
                            tierMeta.chipClass
                          )}
                        >
                          {tierMeta.icon ? <tierMeta.icon className="h-3 w-3" /> : null}
                          {tierMeta.label}
                        </Badge>
                      </motion.div>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2 text-surface-400">
                        <MapPin className="h-4 w-4 text-surface-500" />
                        <span>{lead.industry || 'Servicios'} • {lead.metro_area || 'Desconocido'}</span>
                      </div>

                      {lead.rating && (
                        <div className="flex items-center gap-2">
                          <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                          <strong className="text-amber-400 num-tabular">{lead.rating}</strong>
                          <span className="text-surface-500 num-tabular">({lead.reviews_count || 0} reseñas)</span>
                        </div>
                      )}

                      {lead.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-rose-400" />
                          <span className="text-surface-50 font-medium">{lead.phone}</span>
                        </div>
                      )}

                      {websiteUrl && (
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-sky-400" />
                          <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 underline font-medium truncate"
                          >
                            {websiteUrl}
                          </a>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-surface-400">
                        <Zap className="h-4 w-4 text-surface-500" />
                        <span>
                          Anuncios Meta:{' '}
                          <strong className={cn(
                            hasAdsIndicator === 'No' && 'text-semantic-success',
                            hasAdsIndicator === 'Sí' && 'text-semantic-danger',
                            hasAdsIndicator === 'Desconocido' && 'text-surface-400'
                          )}>
                            {hasAdsIndicator}
                          </strong>
                        </span>
                        <a
                          href={fbAdsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 text-xs text-sky-400 underline inline-flex items-center gap-0.5"
                        >
                          Ver Ad Library <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    {/* Score bar */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-surface-800 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${score}%` }}
                          transition={{ duration: 0.9, ease: 'easeOut' }}
                          className="h-full rounded-full bg-gradient-to-r from-semantic-success to-emerald-400"
                        />
                      </div>
                      <span className="text-sm font-bold text-surface-50 min-w-[48px] text-right">{score}/100</span>
                    </div>

                    {/* Analysis */}
                    <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkle />
                        <h4 className="text-sm font-bold text-semantic-success">Análisis del Prospecto</h4>
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-semantic-danger mb-1">Resumen Situacional:</h5>
                        <p className="text-xs text-surface-200 italic leading-relaxed">{resumen}</p>
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-semantic-danger mb-1">Puntos de Dolor:</h5>
                        <p className="text-xs text-surface-200 leading-relaxed">{puntosDolor}</p>
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-semantic-success mb-1">Estrategia de Venta:</h5>
                        <p className="text-xs text-surface-200 leading-relaxed">{estrategia}</p>
                      </div>
                      {hasEmailDraft && (
                        <p className="text-[11px] text-semantic-success flex items-center gap-1.5 mt-1">
                          <Mail className="h-3 w-3" />
                          Email draft listo — click "Revisar Outreach"
                        </p>
                      )}
                    </div>

                    {/* Lead magnet preview */}
                    {magnetImageUrl && (
                      <motion.button
                        type="button"
                        onClick={() => { setLightboxUrl(magnetImageUrl); setLightboxLabel(magnetLabel); }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        aria-label={`Ver lead magnet ${magnetLabel} para ${lead.business_name}`}
                        className="rounded-xl border border-semantic-success/30 bg-semantic-success/5 px-4 py-2.5 flex items-center justify-between text-xs text-semantic-success font-semibold hover:border-semantic-success/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <span className="flex items-center gap-2">
                          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          LEAD MAGNET — {magnetLabel}
                        </span>
                        <span className="opacity-70 font-normal">Click para expandir</span>
                      </motion.button>
                    )}

                    {/* Action row */}
                    <div className="flex items-center justify-between mt-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenReview(lead)}
                        className="border-primary-500/40 bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 hover:text-primary-500"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Revisar Outreach
                      </Button>
                      {lead.outreach_status && (
                        <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider', statusMeta.badgeClass)}>
                          {statusMeta.label}
                        </Badge>
                      )}
                    </div>

                    {/* Channels */}
                    <div>
                      <h5 className="text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-2">Canales de contacto</h5>
                      <div className="flex gap-2 flex-wrap">
                        {whatsappLink ? (
                          <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-10 h-10 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center text-surface-300 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            aria-label={`WhatsApp a ${lead.business_name}: ${lead.phone}`}
                          >
                            <MessageCircle size={18} aria-hidden="true" />
                          </a>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-surface-800/40 border border-surface-700 flex items-center justify-center text-surface-600 opacity-40" aria-hidden="true">
                            <MessageCircle size={18} aria-hidden="true" />
                          </div>
                        )}
                        <a
                          href={facebookLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-10 h-10 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          aria-label={`Buscar ${lead.business_name} en Facebook`}
                        >
                          <FacebookIcon />
                        </a>
                        <a
                          href={instagramLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-10 h-10 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center text-surface-300 hover:bg-pink-500/20 hover:text-pink-400 hover:border-pink-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          aria-label={`Buscar ${lead.business_name} en Instagram`}
                        >
                          <InstaIcon />
                        </a>
                        <a
                          href={googleMapsLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-10 h-10 rounded-lg bg-primary-500 border border-primary-500 flex items-center justify-center text-white hover:bg-primary-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900"
                          aria-label={`Ver ${lead.business_name} en Google Maps`}
                        >
                          <MapPin className="h-4 w-4" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                  </Card>
                </AnimatedCard>
              </motion.div>
            );
          })}
        </StaggerChildren>
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

      {/* Lead magnet lightbox — Dialog shadcn */}
      <Dialog open={!!lightboxUrl} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
        <DialogContent className="max-w-5xl p-0 bg-transparent border-0 shadow-none">
          <DialogTitle className="sr-only">Lead magnet — {lightboxLabel}</DialogTitle>
          <div className="flex flex-col items-center gap-3">
            <div className="text-semantic-success font-bold text-xs uppercase tracking-widest flex items-center gap-2">
              <ImageIcon className="h-3.5 w-3.5" />
              LEAD MAGNET — {lightboxLabel}
            </div>
            {lightboxUrl && (
              <img
                src={lightboxUrl}
                alt={`Preview del lead magnet — ${lightboxLabel}`}
                className="max-w-[85vw] max-h-[75vh] rounded-2xl border border-semantic-success/30 shadow-elevation-3 object-contain bg-black"
              />
            )}
            <div className="text-xs text-surface-500 mt-1">Click en la X o apretá ESC para cerrar</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Inline SVG helpers (kept out of render loop for clarity) ──
function Sparkle() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-semantic-success">
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function InstaIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
