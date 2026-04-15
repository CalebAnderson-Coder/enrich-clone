// ============================================================
// workers/email_enrichment_worker.js — Email Address Enrichment
// Scrapes websites (homepage + /contact) via Firecrawl to find
// contact emails for leads that are missing email_address.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../lib/supabase.js';

// ── Config ───────────────────────────────────────────────────
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'fc-eac1599ed25044feb68df593f82e6a32';
const BATCH_SIZE = 10;      // leads per batch
const DELAY_MS  = 1500;     // delay between scrapes (rate limiting)
const MAX_LEADS = parseInt(process.env.ENRICHMENT_MAX_LEADS || '500', 10);

// ── Email Extraction ─────────────────────────────────────────

/**
 * Extract valid email addresses from raw text.
 * Filters out common false positives (image files, css, js, etc.).
 */
function extractEmails(text) {
  if (!text) return [];

  // Broad email regex
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
  const raw = text.match(emailRegex) || [];

  // Dedupe + lowercase
  const unique = [...new Set(raw.map(e => e.toLowerCase()))];

  // Filter out false positives
  const blacklistDomains = [
    'example.com', 'sentry.io', 'wixpress.com', 'wordpress.org',
    'w3.org', 'schema.org', 'gravatar.com', 'googleapis.com',
    'cloudflare.com', 'squarespace.com', 'godaddy.com',
  ];
  const blacklistExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js',
    '.woff', '.woff2', '.ttf', '.eot', '.ico',
  ];

  return unique.filter(email => {
    // Skip image/asset false positives
    if (blacklistExtensions.some(ext => email.includes(ext))) return false;
    // Skip platform/framework emails
    if (blacklistDomains.some(d => email.endsWith(`@${d}`))) return false;
    // Must have at least 2 chars before @
    if (email.indexOf('@') < 2) return false;
    // Skip noreply/mailer-daemon
    if (/noreply|no-reply|mailer-daemon|postmaster|webmaster/i.test(email)) return false;
    return true;
  });
}

/**
 * Score an email to pick the best contact address.
 * Higher = better.
 */
function scoreEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  // Prefer contact/info/hello/sales patterns
  if (/^(info|contact|hello|hola|sales|ventas)$/.test(local)) return 100;
  if (/^(admin|office|team|support|service)$/.test(local)) return 80;
  // Personal-looking emails (first name patterns) are good
  if (/^[a-z]{2,15}$/.test(local)) return 70;
  // Generic catch-all
  return 50;
}

/**
 * Pick the single best email from a list of candidates.
 */
function pickBestEmail(emails) {
  if (emails.length === 0) return null;
  if (emails.length === 1) return emails[0];
  return emails.sort((a, b) => scoreEmail(b) - scoreEmail(a))[0];
}

// ── Firecrawl Scraper ────────────────────────────────────────

async function scrapePage(url) {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
      }),
    });

    if (!response.ok) {
      console.log(`    ⚠️ Firecrawl ${response.status} for ${url}`);
      return null;
    }

    const data = await response.json();
    if (data.success && data.data?.markdown) {
      return data.data.markdown;
    }
    return null;
  } catch (err) {
    console.log(`    ⚠️ Scrape error for ${url}: ${err.message}`);
    return null;
  }
}

// ── Simple fallback: direct fetch with regex ─────────────────

async function directFetch(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const html = await response.text();
    return html.slice(0, 50000); // limit to first 50KB
  } catch {
    return null;
  }
}

// ── Fast Reachability Check ──────────────────────────────────

/**
 * Quick HTTP HEAD to check if a domain is actually alive.
 * Returns true if we get any HTTP response (even 404).
 * Returns false if DNS fails or connection times out.
 */
async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return true; // any response = domain exists
  } catch {
    return false; // DNS failure, timeout, connection refused
  }
}

/**
 * Extract the domain from a URL for email match validation.
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Filter emails to prefer those matching the lead's domain.
 * If domain-matched emails exist, return only those.
 * Otherwise return all (some sites use gmail/outlook).
 */
function filterByDomain(emails, websiteUrl) {
  const domain = extractDomain(websiteUrl);
  if (!domain) return emails;

  const domainMatched = emails.filter(e => {
    const emailDomain = e.split('@')[1];
    return emailDomain === domain || emailDomain === `www.${domain}`;
  });

  // If we found domain-specific emails, prefer those exclusively
  if (domainMatched.length > 0) return domainMatched;

  // Otherwise keep personal emails (gmail, outlook, yahoo) — owner might use them
  const personalProviders = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'aol.com', 'live.com'];
  const personalEmails = emails.filter(e => {
    const emailDomain = e.split('@')[1];
    return personalProviders.includes(emailDomain);
  });
  if (personalEmails.length > 0) return personalEmails;

  // Last resort: return all but only if the domain isn't clearly generic/unrelated
  const genericDomains = ['atom.com', 'test.com', 'mail.com', 'temp.com', 'email.com'];
  return emails.filter(e => {
    const emailDomain = e.split('@')[1];
    return !genericDomains.includes(emailDomain);
  });
}

// ── Enrich a Single Lead ─────────────────────────────────────

async function enrichLead(lead) {
  const { id, business_name, website } = lead;
  const base = website.replace(/\/+$/, '');

  console.log(`  🔍 ${business_name} → ${base}`);

  // FAST PRE-CHECK: skip unreachable/fake domains immediately
  const alive = await isReachable(base);
  if (!alive) {
    console.log(`    ⛔ Domain unreachable (DNS/timeout) — skipping`);
    return { id, business_name, status: 'UNREACHABLE' };
  }

  let allEmails = [];

  // 1) Direct HTML fetch on homepage (faster than Firecrawl, good enough for email scraping)
  const html = await directFetch(base);
  if (html) {
    allEmails.push(...extractEmails(html));
  }

  // 2) Try /contact via direct fetch (only if homepage didn't yield emails)
  if (allEmails.length === 0) {
    const contactHtml = await directFetch(`${base}/contact`);
    if (contactHtml) {
      allEmails.push(...extractEmails(contactHtml));
    }
  }

  // 3) Try /about via direct fetch
  if (allEmails.length === 0) {
    const aboutHtml = await directFetch(`${base}/about`);
    if (aboutHtml) {
      allEmails.push(...extractEmails(aboutHtml));
    }
  }

  // 4) Firecrawl as premium fallback (better JS rendering)
  if (allEmails.length === 0) {
    console.log(`    🔥 Trying Firecrawl for JS-rendered content...`);
    const firecrawlContent = await scrapePage(base);
    if (firecrawlContent) {
      allEmails.push(...extractEmails(firecrawlContent));
    }
  }

  // Dedupe
  allEmails = [...new Set(allEmails)];

  // Domain-match filter (reject unrelated emails like service@atom.com)
  allEmails = filterByDomain(allEmails, base);

  // 5) ★ HUNTER.IO FALLBACK — Professional API enrichment
  if (allEmails.length === 0 && process.env.HUNTER_API_KEY) {
    console.log(`    🔎 Trying Hunter.io API enrichment...`);
    try {
      const { enrichLeadWithHunter } = await import('../tools/hunterEnrichment.js');
      const hunterResult = await enrichLeadWithHunter({
        website: base,
        contact_name: lead.owner_name || lead.contact_name || null,
      });

      if (hunterResult.email) {
        allEmails.push(hunterResult.email);
        console.log(`    🎯 Hunter.io found: ${hunterResult.email} (${hunterResult.confidence}% confidence, via ${hunterResult.source})`);

        // Update contact name if Hunter discovered one
        if (hunterResult.contactName && supabase) {
          await supabase
            .from('leads')
            .update({ owner_name: hunterResult.contactName })
            .eq('id', id);
        }
      } else {
        console.log(`    ❌ Hunter.io: no email found`);
      }
    } catch (hunterErr) {
      console.log(`    ⚠️ Hunter.io error: ${hunterErr.message}`);
    }
  }

  if (allEmails.length === 0) {
    console.log(`    ❌ No email found for ${business_name}`);
    return { id, business_name, status: 'NO_EMAIL_FOUND' };
  }

  const bestEmail = pickBestEmail(allEmails);
  console.log(`    ✅ Found: ${bestEmail} (${allEmails.length} total candidates)`);

  // Update Supabase
  const { error } = await supabase
    .from('leads')
    .update({ email_address: bestEmail })
    .eq('id', id);

  if (error) {
    console.error(`    ❌ DB update failed for ${id}: ${error.message}`);
    return { id, business_name, status: 'DB_ERROR', error: error.message };
  }

  return {
    id,
    business_name,
    status: 'ENRICHED',
    email: bestEmail,
    all_candidates: allEmails,
  };
}

// ── Utilities ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   📧 Email Enrichment Worker                    ║');
  console.log('╚══════════════════════════════════════════════════╝');

  if (!supabase) {
    console.error('❌ Supabase not configured. Exiting.');
    process.exit(1);
  }

  // Fetch leads with website but no email
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, website')
    .is('email_address', null)
    .not('website', 'is', null)
    .neq('website', '')
    .limit(MAX_LEADS);

  if (error) {
    console.error('❌ Failed to query leads:', error.message);
    process.exit(1);
  }

  // Filter to only those with actual HTTP URLs
  const enrichable = leads.filter(l => l.website && l.website.startsWith('http'));

  console.log(`\n📊 Total leads without email: ${leads.length}`);
  console.log(`📊 Enrichable (have website): ${enrichable.length}`);
  console.log(`📊 Batch size: ${BATCH_SIZE} | Delay: ${DELAY_MS}ms`);
  console.log(`📊 Firecrawl API: ${FIRECRAWL_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`📊 Hunter.io API: ${process.env.HUNTER_API_KEY ? '✅ configured (fallback active)' : '⏭️ not configured (skipping)'}\n`);

  const results = {
    enriched: 0,
    no_email: 0,
    unreachable: 0,
    errors: 0,
    details: [],
  };

  // Process in batches
  for (let i = 0; i < enrichable.length; i += BATCH_SIZE) {
    const batch = enrichable.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(enrichable.length / BATCH_SIZE);
    console.log(`\n── Batch ${batchNum}/${totalBatches} (${batch.length} leads) ──`);

    for (const lead of batch) {
      try {
        const result = await enrichLead(lead);
        results.details.push(result);

        if (result.status === 'ENRICHED') results.enriched++;
        else if (result.status === 'UNREACHABLE') results.unreachable++;
        else if (result.status === 'NO_EMAIL_FOUND') results.no_email++;
        else results.errors++;

      } catch (err) {
        console.error(`    💥 Unexpected error for ${lead.business_name}: ${err.message}`);
        results.errors++;
        results.details.push({
          id: lead.id,
          business_name: lead.business_name,
          status: 'CRASH',
          error: err.message,
        });
      }

      // Rate limiting
      await sleep(DELAY_MS);
    }
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   📧 Enrichment Complete                        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ✅ Enriched:       ${String(results.enriched).padStart(4)} leads                ║`);
  console.log(`║  ⛔ Unreachable:    ${String(results.unreachable).padStart(4)} leads (fake URLs)   ║`);
  console.log(`║  ❌ No email found: ${String(results.no_email).padStart(4)} leads                ║`);
  console.log(`║  ⚠️  Errors:        ${String(results.errors).padStart(4)} leads                ║`);
  console.log(`║  📊 Total processed:${String(enrichable.length).padStart(4)} leads                ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  // Show enriched details
  const enriched = results.details.filter(d => d.status === 'ENRICHED');
  if (enriched.length > 0) {
    console.log('\n🎯 Enriched leads (ready for outreach):');
    enriched.forEach(d => {
      console.log(`   • ${d.business_name}: ${d.email}`);
    });
    console.log(`\n💡 Run 'node outreach_dispatcher.js' to generate AI drafts for these leads.`);
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
