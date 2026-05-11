// ============================================================
// scripts/ghl_create_panel_fields.js
// Idempotently creates 14 GHL custom fields for the Empírika
// location and writes lib/ghl_panel_fields.json with the
// fieldKey → { id, dataType, name } map.
//
// Usage:
//   node scripts/ghl_create_panel_fields.js
//
// Re-running is a no-op: existing fields are detected and skipped.
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────
const GHL_KEY     = process.env.EMPIRIKA_GHL_KEY;
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const BASE_URL    = 'https://services.leadconnectorhq.com';
const DELAY_MS    = 250;

if (!GHL_KEY) {
  console.error('FATAL: EMPIRIKA_GHL_KEY not set in .env');
  process.exit(1);
}

const GHL_HEADERS = {
  'Authorization': `Bearer ${GHL_KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
};

// ── The 14 fields to create ───────────────────────────────────
// dataType is tried first; fallback (if any) is the second entry.
const DESIRED_FIELDS = [
  { name: 'Empírika · Website URL',         dataType: 'URL',         fallback: 'TEXT', hint: 'empirika_website_url' },
  { name: 'Empírika · Google Maps URL',     dataType: 'URL',         fallback: 'TEXT', hint: 'empirika_gmaps_url' },
  { name: 'Empírika · Facebook URL',        dataType: 'URL',         fallback: 'TEXT', hint: 'empirika_facebook_url' },
  { name: 'Empírika · Instagram URL',       dataType: 'URL',         fallback: 'TEXT', hint: 'empirika_instagram_url' },
  { name: 'Empírika · Industry',            dataType: 'TEXT',        fallback: null,   hint: 'empirika_industry' },
  { name: 'Empírika · Metro Area',          dataType: 'TEXT',        fallback: null,   hint: 'empirika_metro_area' },
  { name: 'Empírika · Review Count',        dataType: 'NUMERICAL',   fallback: 'TEXT', hint: 'empirika_review_count' },
  { name: 'Empírika · Rating',              dataType: 'NUMERICAL',   fallback: 'TEXT', hint: 'empirika_rating' },
  { name: 'Empírika · Qualification Score', dataType: 'NUMERICAL',   fallback: 'TEXT', hint: 'empirika_qualification_score' },
  { name: 'Empírika · Lead Tier',           dataType: 'TEXT',        fallback: null,   hint: 'empirika_lead_tier' },
  { name: 'Empírika · Genoma',              dataType: 'LARGE_TEXT',  fallback: null,   hint: 'empirika_genoma' },
  { name: 'Empírika · Attack Angle',        dataType: 'LARGE_TEXT',  fallback: null,   hint: 'empirika_attack_angle' },
  { name: 'Empírika · Last Email Sent At',  dataType: 'DATE',        fallback: 'TEXT', hint: 'empirika_last_email_sent_at' },
  { name: 'Empírika · Outreach Path',       dataType: 'TEXT',        fallback: null,   hint: 'empirika_outreach_path' },
  // ── Sprint 2026-05-09 additions (pixel tracking + follow-up touch 2) ──
  { name: 'Empírika · Email Opened At',     dataType: 'DATE',        fallback: 'TEXT', hint: 'empirika_email_opened_at' },
  { name: 'Empírika · Follow-up Touch 2 At',dataType: 'DATE',        fallback: 'TEXT', hint: 'empirika_followup_touch2_at' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── GHL API helpers ───────────────────────────────────────────

async function listCustomFields() {
  const url = `${BASE_URL}/locations/${LOCATION_ID}/customFields`;
  const res = await fetch(url, { headers: GHL_HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET customFields failed ${res.status}: ${body}`);
  }
  const json = await res.json();
  // GHL returns { customFields: [...] }
  return json.customFields || json.fields || [];
}

async function createCustomField(name, dataType) {
  const url = `${BASE_URL}/locations/${LOCATION_ID}/customFields`;
  const body = JSON.stringify({
    name,
    dataType,
    model:       'contact',
    placeholder: '',
    showInForms: false,
  });
  const res = await fetch(url, { method: 'POST', headers: GHL_HEADERS, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, body: json };
  }
  // GHL returns { customField: { id, fieldKey, dataType, ... } }
  const field = json.customField || json;
  return { ok: true, field };
}

// ── Short key extraction (strip "contact." prefix) ────────────
function shortKey(fieldKey) {
  if (!fieldKey) return fieldKey;
  return fieldKey.startsWith('contact.') ? fieldKey.slice('contact.'.length) : fieldKey;
}

// ── Main ──────────────────────────────────────────────────────
async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  GHL Panel Fields — Empírika');
  console.log(`  Location: ${LOCATION_ID}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. List all existing custom fields.
  console.log('→ Fetching existing custom fields…');
  const existing = await listCustomFields();
  console.log(`  Found ${existing.length} existing fields.`);

  // Log the existing fields on first call to understand the schema.
  if (existing.length > 0) {
    console.log('\n  Existing field sample (first 3):');
    existing.slice(0, 3).forEach(f => {
      console.log(`    name="${f.name}" fieldKey="${f.fieldKey}" dataType="${f.dataType}" id="${f.id}"`);
    });
    console.log('');
  }

  // Build lookup map by name (case-insensitive).
  const existingByName = new Map();
  for (const f of existing) {
    existingByName.set((f.name || '').toLowerCase().trim(), f);
  }

  // 2. Process each desired field.
  const results = {};
  let created  = 0;
  let skipped  = 0;
  let fallback = 0;

  for (let i = 0; i < DESIRED_FIELDS.length; i++) {
    const desired = DESIRED_FIELDS[i];
    const nameLower = desired.name.toLowerCase().trim();

    // Check if already exists.
    if (existingByName.has(nameLower)) {
      const f = existingByName.get(nameLower);
      const key = shortKey(f.fieldKey) || desired.hint;
      console.log(`  [SKIP] "${desired.name}" → already exists (id=${f.id}, key=${key})`);
      results[key] = { id: f.id, dataType: f.dataType, name: f.name };
      skipped++;
      continue;
    }

    // Try creating with primary dataType.
    let createdField = null;
    let usedDataType = desired.dataType;

    const attempt = await createCustomField(desired.name, desired.dataType);
    if (attempt.ok) {
      createdField = attempt.field;
    } else {
      // Log the error detail.
      console.log(`  [WARN] Create "${desired.name}" with dataType=${desired.dataType} failed: ${attempt.status}`);
      console.log(`         Body: ${JSON.stringify(attempt.body).slice(0, 200)}`);

      if (desired.fallback) {
        console.log(`         Retrying with fallback dataType=${desired.fallback}…`);
        await sleep(DELAY_MS);
        const retry = await createCustomField(desired.name, desired.fallback);
        if (retry.ok) {
          createdField = retry.field;
          usedDataType = desired.fallback;
          fallback++;
          console.log(`  [FALLBACK] "${desired.name}" created as ${desired.fallback}`);
        } else {
          console.log(`  [ERROR] Fallback also failed for "${desired.name}": ${retry.status}`);
          console.log(`          Body: ${JSON.stringify(retry.body).slice(0, 200)}`);
          // Record as failed with hint key so downstream agents can see the gap.
          results[desired.hint] = { id: null, dataType: null, name: desired.name, error: 'creation_failed' };
          continue;
        }
      } else {
        console.log(`  [ERROR] No fallback configured for "${desired.name}".`);
        results[desired.hint] = { id: null, dataType: null, name: desired.name, error: 'creation_failed' };
        continue;
      }
    }

    const key = shortKey(createdField?.fieldKey) || desired.hint;
    console.log(`  [CREATE] "${desired.name}" → id=${createdField?.id}, key=${key}, dataType=${usedDataType}`);
    results[key] = { id: createdField?.id, dataType: usedDataType, name: desired.name };
    created++;

    // Polite delay between creates.
    if (i < DESIRED_FIELDS.length - 1) await sleep(DELAY_MS);
  }

  // 3. Write lib/ghl_panel_fields.json.
  const outputPath = path.join(ROOT, 'lib', 'ghl_panel_fields.json');
  const output = {
    generated_at: new Date().toISOString(),
    location_id:  LOCATION_ID,
    fields:       results,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  // 4. Summary.
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  DONE — ${created} created, ${skipped} already existed, ${fallback} fallback to TEXT`);
  console.log(`  JSON written → ${outputPath}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // 5. Print the field map for easy verification.
  console.log('Field map:');
  for (const [key, val] of Object.entries(results)) {
    const status = val.error ? '  FAILED' : (val.id ? '  OK    ' : '  ?     ');
    console.log(`  ${status}  ${key.padEnd(40)} id=${val.id || 'null'}  dataType=${val.dataType || 'null'}`);
  }
  console.log('');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
