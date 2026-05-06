// ============================================================
// lib/emailVerifier.js
//
// Discovers a verified contact email for a business by scraping
// its public website pages. Returns only emails that:
//   1. Are syntactically valid
//   2. Use the business's own domain (no third-party mailto: links)
//   3. Aren't on the obvious-noise denylist (privacy@, abuse@,
//      postmaster@, no-reply@, wordpress@, etc.)
//
// Strategy: fetch homepage + /contact + /contacto + /about, dump
// page body, regex-extract addresses, rank by inbox-quality
// preference (info > contact > service > sales > the rest).
//
// Returns:
//   { email: string, source: string, allFound: string[] } on hit
//   null on miss (caller should skip the lead — no guessing fallback)
// ============================================================

const TIMEOUT_MS = 8000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
};

// Common contact paths in English + Spanish
const PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/contacto',
  '/contactanos',
  '/contactenos',
  '/about',
  '/about-us',
  '/nosotros',
  '/quienes-somos',
];

// Inbox prefixes to deprioritize (legal/abuse boxes, role bots)
const NOISE_PREFIXES = new Set([
  'privacy', 'privacidad', 'abuse', 'postmaster', 'noreply', 'no-reply',
  'do-not-reply', 'donotreply', 'mailer-daemon', 'unsubscribe',
  'webmaster', 'wordpress', 'admin@wordpress', 'spam', 'security',
  'dmarc', 'dkim', 'compliance', 'legal', 'gdpr', 'ccpa',
]);

// Inbox prefixes ranked best → worst for cold outreach
const PREFERRED = ['info', 'hello', 'contact', 'contacto', 'service', 'servicio', 'sales', 'ventas', 'office', 'team', 'support'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function rootDomain(host) {
  if (!host) return '';
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return host;
}

function extractEmails(html, expectedDomain) {
  const found = new Set();
  if (!html) return [];
  const matches = html.match(EMAIL_RE) || [];
  const expected = rootDomain(expectedDomain);

  for (const raw of matches) {
    const email = raw.toLowerCase()
      .replace(/[.,;:)\]>]+$/, '')   // strip trailing punctuation
      .replace(/^[<([]+/, '');       // strip leading punctuation
    if (!email.includes('@')) continue;
    const [local, dom] = email.split('@');
    if (!local || !dom) continue;
    if (NOISE_PREFIXES.has(local)) continue;
    if (local.length > 64) continue;        // max RFC local-part
    // Reject example/sentry/wix/cloudflare boilerplate
    if (/example|test@|@example|@sentry|@wixsite|@cloudflare|@localhost/.test(email)) continue;
    if (rootDomain(dom) !== expected) continue;
    found.add(email);
  }
  return [...found];
}

function rankEmails(emails) {
  return emails.slice().sort((a, b) => {
    const la = a.split('@')[0];
    const lb = b.split('@')[0];
    const ia = PREFERRED.indexOf(la);
    const ib = PREFERRED.indexOf(lb);
    if (ia !== -1 && ib === -1) return -1;
    if (ia === -1 && ib !== -1) return 1;
    if (ia !== -1 && ib !== -1) return ia - ib;
    return la.length - lb.length; // shorter local part wins ties
  });
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('html') && !ctype.includes('text')) return null;
    const text = await res.text();
    return text.length > 500_000 ? text.slice(0, 500_000) : text;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function urlBase(websiteUrl) {
  try {
    const u = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    return `${u.protocol}//${u.hostname.replace(/^www\./, '')}`;
  } catch {
    return null;
  }
}

/**
 * Scrape candidate emails from a business website.
 *
 * @param {string} websiteUrl  The business website (any URL on the domain).
 * @returns {Promise<{email:string, source:string, allFound:string[]}|null>}
 */
export async function discoverEmail(websiteUrl) {
  const base = urlBase(websiteUrl);
  if (!base) return null;
  const domain = new URL(base).hostname;

  const allFound = new Set();
  let firstHitSource = null;

  for (const p of PATHS) {
    const url = base + p;
    const html = await fetchPage(url);
    if (!html) continue;
    const emails = extractEmails(html, domain);
    if (emails.length > 0 && !firstHitSource) firstHitSource = url;
    for (const e of emails) allFound.add(e);
    if (allFound.size >= 5) break; // enough to rank
  }

  if (allFound.size === 0) return null;
  const ranked = rankEmails([...allFound]);
  return {
    email: ranked[0],
    source: firstHitSource,
    allFound: ranked,
  };
}
