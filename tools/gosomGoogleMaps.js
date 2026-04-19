// ============================================================
// tools/gosomGoogleMaps.js — Google Maps scraper via local gosom REST API.
// Replaces apifyGoogleMaps.js: same tool name/shape, no vendor cost.
// ============================================================
// Backend: `gosom/google-maps-scraper` running in Docker at GOSOM_BASE_URL.
// Default: http://localhost:9090 (container `gmaps-scraper`, web mode).
//
// Flow: POST /api/v1/jobs → poll GET /api/v1/jobs/{id} until status=ok →
//       GET /api/v1/jobs/{id}/download (CSV) → parse → normalize → return.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const BASE = process.env.GOSOM_BASE_URL || 'http://localhost:9090';
const POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_TIME_SEC = 300;   // 5 min per job (gosom's own internal cap)
const POLL_TIMEOUT_MS = 360_000;    // 6 min wall-clock timeout on the JS side

async function createJob({ keywords, depth = 1, email = true, fast = false, maxTimeSec = DEFAULT_MAX_TIME_SEC, lang = 'en' }) {
  const res = await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `scout-${Date.now()}`,
      keywords,
      lang,
      zoom: 15,
      depth,
      email,
      fast_mode: fast,
      max_time: maxTimeSec,
    }),
  });
  if (!res.ok) throw new Error(`gosom createJob failed ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function getJob(id) {
  const res = await fetch(`${BASE}/api/v1/jobs/${id}`);
  if (!res.ok) throw new Error(`gosom getJob failed ${res.status}`);
  return res.json();
}

async function downloadCSV(id) {
  const res = await fetch(`${BASE}/api/v1/jobs/${id}/download`);
  if (!res.ok) throw new Error(`gosom downloadCSV failed ${res.status}`);
  return res.text();
}

async function waitUntilDone(id) {
  const start = Date.now();
  // gosom JSON uses PascalCase ("Status") — observed values: "ok", "failed",
  // presumably also "working"/"pending" during execution.
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const j = await getJob(id);
    const s = String(j.Status ?? j.status ?? '').toLowerCase();
    if (s === 'ok') return j;
    if (s === 'failed') throw new Error(`job failed: ${JSON.stringify(j).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('gosom job timeout after 6min');
}

/**
 * Parse gosom CSV output. Fields observed (v1.12.0):
 *   title, category, address, phone, website, email, website_phones,
 *   open_hours, rating, review_count, latitude, longitude,
 *   url (Google Maps), place_id, ...
 * Quoted fields can contain commas and escaped quotes (""). Minimal parser
 * good enough for gosom output — not a general CSV parser.
 */
function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCSVRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVRow(lines[i]);
    if (cells.length === 0) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = cells[c] ?? '';
    rows.push(obj);
  }
  return rows;
}

function splitCSVRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function flattenAddress(raw) {
  if (!raw) return '';
  if (typeof raw !== 'string') return String(raw);
  // gosom sometimes packs address as JSON: {street, city, state, postal_code, country}
  if (raw.trim().startsWith('{')) {
    try {
      const o = JSON.parse(raw);
      return [o.street, o.city, o.state, o.postal_code].filter(Boolean).join(', ');
    } catch { /* fall through */ }
  }
  return raw;
}

// Wix/Squarespace/etc placeholder emails to skip (not real contacts).
const PLACEHOLDER_EMAIL_RX = /@(mysite|example|domain|yoursite|test|wixsite)\.(com|net|org)$/i;

export const scrapeGoogleMaps = new Tool({
  name: 'scrape_google_maps',
  description: `Search Google Maps for businesses matching a query in a specific location. Returns business name, address, phone, website, email, rating, review count, and Google Maps URL. Use for lead prospection of Latino-owned service businesses in US metro areas.`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (e.g. "remodeling contractors Orlando FL")' },
      maxResults: { type: 'number', description: 'Max results to keep after filtering (default 20)' },
      minReviews: { type: 'number', description: 'Minimum reviews to qualify (default 20)' },
      minRating: { type: 'number', description: 'Minimum star rating (default 4.0)' },
    },
    required: ['query'],
  },
  fn: async (args) => {
    const { query, maxResults = 20, minReviews = 20, minRating = 4.0 } = args;
    console.log(`  🗺️  [gosomGMaps] Scraping: "${query}" (max ${maxResults})`);

    try {
      const jobId = await createJob({ keywords: [query], email: true, fast: false });
      console.log(`  ⏳ [gosomGMaps] Job ${jobId} queued, polling...`);
      await waitUntilDone(jobId);
      const csv = await downloadCSV(jobId);
      const rows = parseCSV(csv);

      // gosom CSV columns (v1.12.0): title, category, address, phone, website,
      // review_count, review_rating, latitude, longitude, place_id, link, emails,
      // complete_address, open_hours, owner, ...
      const normalized = rows.map(r => {
        const emailsRaw = r.emails || r.email || '';
        const candidates = emailsRaw ? String(emailsRaw).split(/[|,;]/).map(s => s.trim()).filter(Boolean) : [];
        const realEmails = candidates.filter(e => !PLACEHOLDER_EMAIL_RX.test(e));
        return {
          name: r.title || 'Unknown',
          address: flattenAddress(r.complete_address || r.address),
          phone: r.phone || '',
          website: r.website || null,
          email: realEmails[0] || null,
          rating: toNum(r.review_rating),
          reviewCount: toNum(r.review_count),
          googleMapsUrl: r.link || '',
          categories: r.category ? [r.category] : [],
          placeId: r.place_id || null,
          latitude: r.latitude ? toNum(r.latitude) : null,
          longitude: r.longitude ? toNum(r.longitude) : null,
        };
      });

      const qualified = normalized
        .filter(l => l.reviewCount >= minReviews && l.rating >= minRating)
        .slice(0, maxResults);

      console.log(`  ✅ [gosomGMaps] ${normalized.length} scraped → ${qualified.length} passed filters`);

      return JSON.stringify({
        mock: false,
        query,
        jobId,
        totalScraped: normalized.length,
        totalQualified: qualified.length,
        results: qualified,
      });
    } catch (err) {
      console.error(`  ❌ [gosomGMaps] ${err.message}`);
      // Agent MUST NOT fabricate leads when scraper fails (see Scout prompt).
      return JSON.stringify({ error: err.message, query, results: [] });
    }
  },
});
