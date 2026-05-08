// ============================================================
// lib/leadMiniAuditEnricher.js — Per-lead mini-audit cache
//
// Wraps lib/miniAudit.js with caching to leads.mega_profile.mini_audit.
// Idempotent: if a fresh audit (<7 days) already exists, returns it
// from cache without burning DataForSEO credits.
//
// Skipped when:
//   - No website on the lead row
//   - DataForSEO env vars missing
//   - Domain looks like a marketplace (yelp.com, facebook.com, etc.)
// ============================================================

import { runMiniAudit } from './miniAudit.js';

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const SKIP_DOMAINS = new Set([
  'yelp.com', 'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com',
  'angi.com', 'thumbtack.com', 'bbb.org', 'homeadvisor.com', 'yellowpages.com',
  'google.com', 'maps.google.com', 'm.facebook.com',
]);

function extractDomainFromLead(lead) {
  const candidates = [lead.website, lead.domain, lead.url].filter(Boolean);
  for (const c of candidates) {
    let d = String(c).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '').split('/')[0].split('?')[0];
    if (d && !SKIP_DOMAINS.has(d) && d.includes('.')) return d;
  }
  return null;
}

function isFresh(miniAudit) {
  if (!miniAudit?.run_at) return false;
  return Date.now() - new Date(miniAudit.run_at).getTime() < CACHE_TTL_MS;
}

/**
 * Returns the lead's mini-audit, running and caching if needed.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase
 * @param {object} args.lead — must have at least { id, mega_profile, website }
 * @param {object} [args.log]
 * @param {boolean} [args.forceRefresh=false]
 * @returns {Promise<{ ok, hallazgos, top_competitor, run_at, cost_usd, cached, skipped, reason }>}
 */
export async function ensureLeadMiniAudit({ supabase, lead, log = null, forceRefresh = false }) {
  const mega = lead?.mega_profile || {};
  const cached = mega.mini_audit;

  if (!forceRefresh && isFresh(cached)) {
    return { ...cached, cached: true, skipped: false };
  }

  if (!process.env.DATAFORSEO_LOGIN && !process.env.DATAFORSEO_AUTH_BASIC) {
    return { ok: false, skipped: true, reason: 'missing_credentials', hallazgos: [] };
  }

  const domain = extractDomainFromLead(lead);
  if (!domain) {
    return { ok: false, skipped: true, reason: 'no_valid_domain', hallazgos: [] };
  }

  const audit = await runMiniAudit(domain);
  log?.info?.('mini_audit completed', {
    lead_id: lead.id, domain, ok: audit.ok, cost: audit.cost_usd, hallazgos: audit.hallazgos?.length,
  });

  // Cache to mega_profile
  try {
    const newMega = { ...mega, mini_audit: audit };
    await supabase.from('leads').update({ mega_profile: newMega }).eq('id', lead.id);
  } catch (err) {
    log?.warn?.('mini_audit persist failed', { lead_id: lead.id, err: err.message });
  }

  return { ...audit, cached: false, skipped: false };
}

/**
 * Render the mini-audit findings as a Spanish prompt block ready
 * to inject into Angela's outreach prompt.
 */
export function renderHallazgosBlock(audit) {
  if (!audit?.ok || !audit.hallazgos?.length) return '';
  const lines = audit.hallazgos.slice(0, 3).map((h, i) => `${i + 1}. ${h.headline}`);
  return [
    '',
    '════════════════════════════════════════',
    'HALLAZGOS REALES DE SU SITIO (datos en vivo de Google):',
    ...lines,
    '════════════════════════════════════════',
    'Usá UNO de estos hallazgos como gancho del Touch 1 (observación). Citá el dato exacto.',
    'Touch 1 cierra con CTA: "¿Te mando el mini-reporte completo en PDF? (1 página, gratis, sin compromiso)" — esto genera respuestas, NO pidas reunión todavía.',
    '',
  ].join('\n');
}
