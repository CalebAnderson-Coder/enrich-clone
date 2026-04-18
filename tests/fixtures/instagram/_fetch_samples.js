// ============================================================
// tests/fixtures/instagram/_fetch_samples.js
// One-shot fetcher: pulls 3 Instagram HTML fixtures via Bright Data.
// Run once: `node tests/fixtures/instagram/_fetch_samples.js`
// ============================================================

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BD_SCRAPE = 'https://api.brightdata.com/request';
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_UNLOCKER_ZONE || 'mcp_unlocker';

if (!TOKEN) {
  console.error('BRIGHTDATA_API_TOKEN missing from .env');
  process.exit(1);
}

const SAMPLES = [
  { user: 'zuck',                                                 file: 'zuck.html'     },
  { user: 'nasa',                                                 file: 'nasa.html'     },
  { user: 'instagram_business_userthatdoesnotexist_12345xyz',     file: 'notfound.html' },
];

async function fetchOne({ user, file }) {
  const url = `https://www.instagram.com/${user}/`;
  console.log(`→ fetching ${url}`);

  const res = await fetch(BD_SCRAPE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ url, format: 'raw', zone: ZONE }),
  });

  const html = await res.text();
  const out = path.join(__dirname, file);
  await fs.writeFile(out, html, 'utf8');
  console.log(`  status=${res.status}  bytes=${html.length}  → ${file}`);
}

for (const s of SAMPLES) {
  try { await fetchOne(s); }
  catch (err) { console.error(`  failed ${s.user}: ${err.message}`); }
}

console.log('done.');
