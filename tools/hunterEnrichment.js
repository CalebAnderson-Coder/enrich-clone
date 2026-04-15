// ============================================================
// tools/hunterEnrichment.js — Hunter.io Email Enrichment API
// Finds professional email addresses via domain search & email finder
// Free tier: 50 credits/month (1 credit per email found)
// ============================================================

import { logger as rootLogger } from '../lib/logger.js';
const logger = rootLogger.child({ module: 'hunter-enrichment' });

const HUNTER_API_BASE = 'https://api.hunter.io/v2';

/**
 * Get the Hunter API key from environment.
 */
function getApiKey() {
  const key = process.env.HUNTER_API_KEY;
  if (!key) {
    logger.warn('HUNTER_API_KEY not set — Hunter.io enrichment disabled');
    return null;
  }
  return key;
}

/**
 * Domain Search — Find all email addresses associated with a domain.
 * Uses 1 credit per email found in the response.
 * 
 * @param {string} domain - e.g. "intercom.io"
 * @param {Object} [options] - Additional options
 * @param {string} [options.type] - Filter by email type: 'personal' or 'generic'
 * @param {number} [options.limit] - Max results (default: 5)
 * @returns {Object} { emails: Array, organization: string, pattern: string, meta: Object }
 */
export async function domainSearch(domain, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { emails: [], organization: null, pattern: null, meta: { error: 'NO_API_KEY' } };

  const params = new URLSearchParams({
    domain,
    api_key: apiKey,
    limit: String(options.limit || 5),
  });

  if (options.type) params.set('type', options.type);

  try {
    const response = await fetch(`${HUNTER_API_BASE}/domain-search?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Hunter domain-search failed [${response.status}]: ${errorBody}`);
      return { emails: [], organization: null, pattern: null, meta: { error: `HTTP_${response.status}`, detail: errorBody } };
    }

    const json = await response.json();
    const data = json.data || {};

    const emails = (data.emails || []).map(e => ({
      email: e.value,
      type: e.type,            // 'personal' or 'generic'
      confidence: e.confidence, // 0-100
      firstName: e.first_name,
      lastName: e.last_name,
      position: e.position,
      department: e.department,
      sources: (e.sources || []).length,
    }));

    return {
      emails,
      organization: data.organization,
      pattern: data.pattern,    // e.g. "{first}.{last}" 
      meta: {
        results: data.emails?.length || 0,
        creditsUsed: json.meta?.params?.limit || emails.length,
        remainingCredits: null, // Hunter doesn't return this in search
      },
    };
  } catch (err) {
    logger.error(`Hunter domain-search error: ${err.message}`);
    return { emails: [], organization: null, pattern: null, meta: { error: err.message } };
  }
}

/**
 * Email Finder — Find the most likely email for a specific person at a domain.
 * Uses 1 credit per successful find.
 * 
 * @param {string} domain - Company domain
 * @param {string} firstName - Person's first name
 * @param {string} lastName - Person's last name
 * @returns {Object} { email: string|null, confidence: number, meta: Object }
 */
export async function emailFinder(domain, firstName, lastName) {
  const apiKey = getApiKey();
  if (!apiKey) return { email: null, confidence: 0, meta: { error: 'NO_API_KEY' } };

  if (!firstName || !lastName) {
    return { email: null, confidence: 0, meta: { error: 'MISSING_NAME' } };
  }

  const params = new URLSearchParams({
    domain,
    first_name: firstName,
    last_name: lastName,
    api_key: apiKey,
  });

  try {
    const response = await fetch(`${HUNTER_API_BASE}/email-finder?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Hunter email-finder failed [${response.status}]: ${errorBody}`);
      return { email: null, confidence: 0, meta: { error: `HTTP_${response.status}`, detail: errorBody } };
    }

    const json = await response.json();
    const data = json.data || {};

    return {
      email: data.email || null,
      confidence: data.confidence || 0,
      position: data.position,
      company: data.company,
      meta: {
        score: data.score,
        sources: (data.sources || []).length,
      },
    };
  } catch (err) {
    logger.error(`Hunter email-finder error: ${err.message}`);
    return { email: null, confidence: 0, meta: { error: err.message } };
  }
}

/**
 * Email Verifier — Check if an email address is valid and deliverable.
 * Uses 0.5 credits per verification.
 * 
 * @param {string} email - Email to verify
 * @returns {Object} { status: string, score: number, meta: Object }
 */
export async function emailVerifier(email) {
  const apiKey = getApiKey();
  if (!apiKey) return { status: 'unknown', score: 0, meta: { error: 'NO_API_KEY' } };

  const params = new URLSearchParams({
    email,
    api_key: apiKey,
  });

  try {
    const response = await fetch(`${HUNTER_API_BASE}/email-verifier?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Hunter email-verifier failed [${response.status}]: ${errorBody}`);
      return { status: 'unknown', score: 0, meta: { error: `HTTP_${response.status}` } };
    }

    const json = await response.json();
    const data = json.data || {};

    return {
      status: data.status,     // 'valid', 'invalid', 'accept_all', 'webmail', 'disposable', 'unknown'
      score: data.score || 0,  // 0-100
      result: data.result,     // 'deliverable', 'undeliverable', 'risky'
      meta: {
        mxRecords: data.mx_records,
        smtpServer: data.smtp_server,
        smtpCheck: data.smtp_check,
      },
    };
  } catch (err) {
    logger.error(`Hunter email-verifier error: ${err.message}`);
    return { status: 'unknown', score: 0, meta: { error: err.message } };
  }
}

/**
 * Account Info — Check remaining API credits.
 * Does NOT consume credits.
 * 
 * @returns {Object} { plan: string, credits: { used, available }, meta: Object }
 */
export async function getAccountInfo() {
  const apiKey = getApiKey();
  if (!apiKey) return { plan: null, credits: { used: 0, available: 0 }, meta: { error: 'NO_API_KEY' } };

  try {
    const params = new URLSearchParams({ api_key: apiKey });
    const response = await fetch(`${HUNTER_API_BASE}/account?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return { plan: null, credits: { used: 0, available: 0 }, meta: { error: `HTTP_${response.status}` } };
    }

    const json = await response.json();
    const data = json.data || {};
    const requests = data.requests || {};

    return {
      plan: data.plan_name,
      email: data.email,
      credits: {
        used: requests.searches?.used || 0,
        available: requests.searches?.available || 0,
      },
      meta: {
        resetDate: data.reset_date,
        teamId: data.team_id,
      },
    };
  } catch (err) {
    return { plan: null, credits: { used: 0, available: 0 }, meta: { error: err.message } };
  }
}

/**
 * High-level enrichment function for a lead.
 * Tries domainSearch first, falls back to email patterns.
 * Returns the best email found or null.
 * 
 * @param {Object} lead - Lead object with { website, contact_name }
 * @returns {Object} { email, confidence, source, meta }
 */
export async function enrichLeadWithHunter(lead) {
  const { extractDomain } = await import('../lib/domainValidator.js');
  const domain = extractDomain(lead.website);

  if (!domain) {
    return { email: null, confidence: 0, source: 'hunter', meta: { error: 'NO_DOMAIN' } };
  }

  logger.info(`[Hunter] Enriching domain: ${domain}`);

  // Strategy 1: If we have a contact name, use Email Finder (more precise)
  if (lead.contact_name) {
    const nameParts = lead.contact_name.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');

      const finderResult = await emailFinder(domain, firstName, lastName);
      if (finderResult.email && finderResult.confidence >= 60) {
        logger.info(`[Hunter] Found via Email Finder: ${finderResult.email} (${finderResult.confidence}%)`);
        return {
          email: finderResult.email,
          confidence: finderResult.confidence,
          source: 'hunter_email_finder',
          meta: finderResult.meta,
        };
      }
    }
  }

  // Strategy 2: Domain Search — get any email associated with the domain
  const searchResult = await domainSearch(domain, { limit: 3, type: 'personal' });
  if (searchResult.emails.length > 0) {
    // Pick highest confidence email
    const best = searchResult.emails.sort((a, b) => b.confidence - a.confidence)[0];
    logger.info(`[Hunter] Found via Domain Search: ${best.email} (${best.confidence}%)`);
    return {
      email: best.email,
      confidence: best.confidence,
      source: 'hunter_domain_search',
      contactName: best.firstName && best.lastName ? `${best.firstName} ${best.lastName}` : null,
      position: best.position,
      meta: searchResult.meta,
    };
  }

  // Strategy 3: Try generic emails if no personal found
  const genericResult = await domainSearch(domain, { limit: 3, type: 'generic' });
  if (genericResult.emails.length > 0) {
    const best = genericResult.emails.sort((a, b) => b.confidence - a.confidence)[0];
    logger.info(`[Hunter] Found generic email: ${best.email} (${best.confidence}%)`);
    return {
      email: best.email,
      confidence: best.confidence,
      source: 'hunter_domain_search_generic',
      meta: genericResult.meta,
    };
  }

  logger.info(`[Hunter] No email found for domain: ${domain}`);
  return { email: null, confidence: 0, source: 'hunter', meta: { error: 'NO_RESULTS' } };
}
