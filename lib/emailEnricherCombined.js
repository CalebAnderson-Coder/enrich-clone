// ============================================================
// lib/emailEnricherCombined.js — Pipeline cascade Hunter →
//   scraping → fallback for verified contact emails.
//
// Reemplaza el patrón previo de "guess info@dominio" que generó
// 8 bounces. Aquí: si el cascade no encuentra evidencia de un
// email real, devuelve null y el lead se marca NO_EMAIL — el
// outreach skipea el envío. Cero adivinación.
//
// Cascade strategy:
//   1. Cache check — if lead already has a verified email
//      (mega_profile.email_source ∈ ['hunter','scraped','manual']),
//      skip and return cached.
//   2. Hunter Domain Search (priority: personal type, conf > 80).
//      Persona name guardado para personalizar el email.
//   3. Scraping del sitio (homepage + /contact + /about) — extrae
//      emails del dominio propio.
//   4. Nada encontrado → null. Caller marca lead NO_EMAIL.
//
// Output shape:
//   { email, source, confidence, persona_name?, persona_position?, all_found? }
//   | null
//
// Cost per lead enriched:
//   - Hunter Domain Search: 1 free credit (50/mes free tier)
//   - Scraping: $0 (Scrapling internal o fetch directo)
// ============================================================

import { domainSearch, emailVerifier as hunterVerifier } from '../tools/hunterEnrichment.js';
import { discoverEmail }                                 from './emailVerifier.js';

const VERIFIED_SOURCES = new Set(['hunter', 'scraped', 'manual']);

/**
 * Best-effort domain extractor. Strips protocol, www, trailing slash,
 * query string and path. Returns null if nothing usable.
 */
function extractDomain(input) {
  if (!input) return null;
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  return d && d.includes('.') ? d : null;
}

/**
 * Returns the email currently cached on the lead if it was verified
 * by a non-guess source. Otherwise null (will trigger fresh enrichment).
 */
function readCachedVerifiedEmail(lead) {
  const cachedEmail = lead.email_address || lead.email;
  if (!cachedEmail) return null;
  const source = lead.mega_profile?.email_source;
  if (VERIFIED_SOURCES.has(source)) {
    return {
      email: cachedEmail.toLowerCase(),
      source,
      confidence: lead.mega_profile?.email_confidence ?? 0.8,
      persona_name: lead.mega_profile?.email_persona_name ?? null,
      cached: true,
    };
  }
  return null;
}

/**
 * Enrich a single lead's email field.
 *
 * @param {object} args
 * @param {object} args.lead          — must include id, website OR domain
 * @param {object} args.supabase      — Supabase client
 * @param {object} [args.log]
 * @param {boolean} [args.persist=true] — write enriched email back to leads table
 * @returns {Promise<{email, source, confidence, persona_name?} | null>}
 */
export async function enrichLeadEmail({ lead, supabase, log = null, persist = true }) {
  const cached = readCachedVerifiedEmail(lead);
  if (cached) return cached;

  const domain = extractDomain(lead.website || lead.domain || lead.url);
  if (!domain) {
    log?.info?.('emailEnricher: no usable domain', { lead_id: lead.id });
    return null;
  }

  let result = null;

  // ── Step 1: Hunter Domain Search (only if API key configured) ──
  if (process.env.HUNTER_API_KEY) {
    try {
      // Pull personal emails first (real people, higher response rate)
      const personalSearch = await domainSearch(domain, { limit: 3, type: 'personal' });
      const personalHit = personalSearch?.emails?.find((e) => (e.confidence ?? 0) >= 80);
      if (personalHit) {
        result = {
          email: personalHit.value.toLowerCase(),
          source: 'hunter',
          confidence: personalHit.confidence / 100,
          persona_name: [personalHit.first_name, personalHit.last_name].filter(Boolean).join(' ') || null,
          persona_position: personalHit.position || null,
          all_found: personalSearch.emails.map((e) => e.value),
        };
      }

      // If no high-confidence personal, try generic emails (info@, contact@) but
      // require Hunter to have actually verified them (confidence > 80) — this is
      // very different from the "guess info@" pattern that caused the bounces.
      if (!result) {
        const genericSearch = await domainSearch(domain, { limit: 3, type: 'generic' });
        const genericHit = genericSearch?.emails?.find((e) => (e.confidence ?? 0) >= 80);
        if (genericHit) {
          result = {
            email: genericHit.value.toLowerCase(),
            source: 'hunter',
            confidence: genericHit.confidence / 100,
            persona_name: null,
            persona_position: null,
            all_found: genericSearch.emails.map((e) => e.value),
          };
        }
      }
    } catch (err) {
      log?.warn?.('emailEnricher: Hunter step failed', { domain, err: err.message });
    }
  }

  // ── Step 2: Scraping fallback (always tries) ──
  if (!result) {
    try {
      const websiteUrl = lead.website?.startsWith('http') ? lead.website : `https://${domain}`;
      const scraped = await discoverEmail(websiteUrl);
      if (scraped?.email) {
        result = {
          email: scraped.email.toLowerCase(),
          source: 'scraped',
          confidence: 0.7, // scraping can find live but role addresses
          persona_name: null,
          persona_position: null,
          all_found: scraped.allFound || [],
        };
      }
    } catch (err) {
      log?.warn?.('emailEnricher: scraping step failed', { domain, err: err.message });
    }
  }

  // ── Step 3: Hunter SMTP verifier on the result (if we have key) ──
  // Re-confirms the address is deliverable. Drops result if Hunter
  // says undeliverable.
  if (result && process.env.HUNTER_API_KEY) {
    try {
      const verify = await hunterVerifier(result.email);
      if (verify?.status === 'undeliverable' || verify?.status === 'invalid') {
        log?.info?.('emailEnricher: dropped by Hunter SMTP verifier', {
          email: result.email, status: verify.status,
        });
        result = null;
      } else if (verify?.score) {
        result.confidence = Math.max(result.confidence, verify.score / 100);
      }
    } catch (err) {
      log?.warn?.('emailEnricher: Hunter verify failed (keeping result)', { err: err.message });
    }
  }

  // ── Step 4: persist to leads table ──
  if (persist && result) {
    try {
      const newMega = {
        ...(lead.mega_profile || {}),
        email_source:        result.source,
        email_confidence:    result.confidence,
        email_persona_name:  result.persona_name,
        email_position:      result.persona_position,
        email_enriched_at:   new Date().toISOString(),
        email_all_found:     result.all_found || [],
      };
      await supabase.from('leads')
        .update({
          email_address: result.email,
          email: result.email,
          mega_profile: newMega,
        })
        .eq('id', lead.id);
    } catch (err) {
      log?.warn?.('emailEnricher: persist failed', { lead_id: lead.id, err: err.message });
    }
  }

  if (!result && persist) {
    // Mark lead so the outreach loop skips it
    try {
      const newMega = {
        ...(lead.mega_profile || {}),
        email_source:      'no_email_found',
        email_enriched_at: new Date().toISOString(),
      };
      await supabase.from('leads')
        .update({ outreach_status: 'NO_EMAIL', mega_profile: newMega })
        .eq('id', lead.id);
      log?.info?.('emailEnricher: lead marked NO_EMAIL', { lead_id: lead.id, domain });
    } catch (err) {
      log?.warn?.('emailEnricher: NO_EMAIL persist failed', { lead_id: lead.id, err: err.message });
    }
  }

  return result;
}

/**
 * Returns true if a lead's email is "trusted enough to send".
 * Used by the outreach pre-send guard to skip ungrounded sends.
 */
export function isLeadEmailVerified(lead) {
  const source = lead.mega_profile?.email_source;
  return VERIFIED_SOURCES.has(source) && Boolean(lead.email_address || lead.email);
}
