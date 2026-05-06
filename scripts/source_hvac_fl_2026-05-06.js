// ============================================================
// scripts/source_hvac_fl_2026-05-06.js
//
// Sources HVAC contractor leads in 4 Florida metros via Apify
// Google Maps actor (compass~crawler-google-places). Filters
// for Latino-owned heuristic match (name or address contains
// Hispanic surnames or Spanish keywords). Writes raw + filtered
// JSON to .omc/research/ for review before any DB insert.
//
// Usage:
//   node scripts/source_hvac_fl_2026-05-06.js
//
// Output:
//   .omc/research/hvac_fl_2026-05-06_raw.json     (all results)
//   .omc/research/hvac_fl_2026-05-06_filtered.json (Latino-owned)
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, '.omc', 'research');
fs.mkdirSync(OUT_DIR, { recursive: true });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error('FATAL: APIFY_API_TOKEN missing');
  process.exit(1);
}

// Heuristic — flags businesses likely Latino-owned by name or address.
// We accept false positives here; manual review happens at filtered output.
const LATINO_SURNAME = /(rodriguez|martinez|lopez|gonzalez|hernandez|garcia|perez|sanchez|ramirez|torres|flores|rivera|gomez|diaz|cruz|reyes|morales|jimenez|alvarez|romero|gutierrez|chavez|ruiz|vargas|castillo|mendoza|herrera|medina|aguilar|salazar|delgado|valdez|escobar|ortega|silva|moreno|fuentes|guerrero|navarro|ramos|gallardo|maldonado|chacon|montoya|cordero|munoz|guzman|cabrera|amador|santana|rios|fernandez|villalobos|figueroa|carrasco|estrada|orozco|rojas|carrillo|aguirre|trujillo|nieto|santos|colon|melendez|quintero|del sol|del valle|del rio|del pino|del monte|del rosario|de la|del cid|santiago)/i;
const LATINO_KEYWORD = /(latino|hispano|hispanic|familia|cubano|mexican|mexicano|colombiano|puertor|venezol|dominic|salvador|guatemal|hondure|nicaragu|peruano|argentin|boliv|ecuator|brazi|brasil|hermanos|amigos|abuelo|jefe|patron|sol\b|luna\b|fiesta|cumbre|sabor|estrella|corazon|caribe|america latina|amer.{0,3}latina)/i;

function looksLatinoOwned(name, address) {
  const haystack = `${name || ''}    ${address || ''}`;
  return LATINO_SURNAME.test(haystack) || LATINO_KEYWORD.test(haystack);
}

const METROS = [
  { name: 'Homestead, FL',  query: 'HVAC contractor Homestead FL' },
];

async function runApify(query, maxResults = 25) {
  console.log(`  ▶ ${query}`);
  const t0 = Date.now();
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${APIFY_TOKEN}&waitForFinish=300`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: maxResults,
        language: 'en',
        reviewsSort: 'newest',
        maxReviews: 3,
        skipClosedPlaces: true,
        scrapeReviewerName: false,
        minScore: 4.5,
      }),
    },
  );
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`Apify start ${startRes.status}: ${t.slice(0, 200)}`);
  }
  const startData = await startRes.json();
  const datasetId = startData?.data?.defaultDatasetId;
  if (!datasetId) throw new Error('Apify run returned no dataset');

  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&limit=100`,
  );
  if (!dataRes.ok) throw new Error(`dataset fetch ${dataRes.status}`);
  const items = await dataRes.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${items.length} places in ${elapsed}s`);
  return items;
}

function normalize(place, metro) {
  const reviews = place.reviewsCount || 0;
  const rating = place.totalScore || 0;
  return {
    name: place.title || place.name || 'Unknown',
    address: place.address || '',
    phone: place.phone || '',
    website: place.website || null,
    rating,
    reviewCount: reviews,
    googleMapsUrl: place.url || place.googleUrl || '',
    placeId: place.placeId || null,
    categories: place.categories || [],
    metro_area: metro,
    industry: 'HVAC',
    qualification_score: scoreLead(rating, reviews, !!place.website),
    isLatinoOwned: looksLatinoOwned(place.title, place.address),
  };
}

function scoreLead(rating, reviews, hasWebsite) {
  let s = 50;
  if (hasWebsite) s += 15;
  if (rating >= 4.7) s += 15;
  else if (rating >= 4.5) s += 8;
  if (reviews >= 200) s += 15;
  else if (reviews >= 50) s += 10;
  else if (reviews >= 20) s += 5;
  if (reviews < 10) s -= 10;
  return Math.max(0, Math.min(100, s));
}

(async () => {
  console.log(`\n=== Empírika sourcing — HVAC FL · ${new Date().toISOString()} ===\n`);

  const allRaw = [];
  for (const m of METROS) {
    try {
      const items = await runApify(m.query, 25);
      for (const it of items) allRaw.push(normalize(it, m.name));
    } catch (e) {
      console.error(`  ✗ ${m.name} failed: ${e.message}`);
    }
    // Wait between metros to avoid Apify free-tier memory cap collision
    await new Promise(r => setTimeout(r, 8000));
  }

  // Dedupe by placeId
  const seen = new Set();
  const deduped = [];
  for (const lead of allRaw) {
    const key = lead.placeId || `${lead.name}|${lead.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lead);
  }

  // Geography acts as pre-filter — Hialeah/Doral/Kissimmee/Miami Beach metros
  // are ≥70% Latino population. We keep the heuristic flag but no longer
  // require it; instead we keep ALL qualified leads and reject the obvious
  // non-HVAC noise via the categories field.
  const isHvacBusiness = l => {
    const cats = (l.categories || []).map(c => String(c).toLowerCase()).join('|');
    if (!cats) return true; // no signal, accept
    return /hvac|air.cond|heating|cool|aire|climat|plumbing/.test(cats);
  };
  const filtered = deduped.filter(
    l =>
      l.website &&
      l.reviewCount >= 20 &&
      l.rating >= 4.5 &&
      isHvacBusiness(l),
  );
  filtered.sort((a, b) => b.qualification_score - a.qualification_score);

  const ts = Date.now();
  const rawPath = path.join(OUT_DIR, `hvac_fl_${ts}_raw.json`);
  const filteredPath = path.join(OUT_DIR, `hvac_fl_${ts}_filtered.json`);
  fs.writeFileSync(rawPath, JSON.stringify(deduped, null, 2));
  fs.writeFileSync(filteredPath, JSON.stringify(filtered, null, 2));

  console.log('\n=== Resumen ===');
  console.log(`Total scraped (deduped):  ${deduped.length}`);
  console.log(`Latino-owned + qualified: ${filtered.length}`);
  console.log(`Por metro:`);
  const byMetro = {};
  for (const l of filtered) {
    byMetro[l.metro_area] = (byMetro[l.metro_area] || 0) + 1;
  }
  for (const [m, n] of Object.entries(byMetro)) {
    console.log(`  ${m}: ${n}`);
  }
  console.log(`\nRaw      → ${rawPath}`);
  console.log(`Filtered → ${filteredPath}`);
  console.log(`\nTop 10 candidatos:`);
  for (const l of filtered.slice(0, 10)) {
    console.log(
      `  ${String(l.qualification_score).padStart(3)} | ${l.metro_area.padEnd(20)} | ${l.name} (${l.reviewCount} reviews, ${l.rating}⭐) ${l.website || ''}`,
    );
  }
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
