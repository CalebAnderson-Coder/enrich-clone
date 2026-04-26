// ============================================================
// scripts/ghl_backfill_lead_panel.js
// Backfills 14 GHL custom panel fields + auto-note for all
// Empírika leads that have outreach_status='SENT' in
// campaign_enriched_data.
//
// Usage:
//   node scripts/ghl_backfill_lead_panel.js --dry     # preview first 3, no writes
//   node scripts/ghl_backfill_lead_panel.js --canary  # full writes for first 3 only
//   node scripts/ghl_backfill_lead_panel.js --all     # full writes for all
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────
const GHL_KEY     = process.env.EMPIRIKA_GHL_KEY;
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const BRAND_ID    = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const DELAY_MS    = 300;

if (!GHL_KEY) {
  console.error('FATAL: EMPIRIKA_GHL_KEY not set in .env');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// ── CLI flags ─────────────────────────────────────────────────
const args    = new Set(process.argv.slice(2));
const DRY     = args.has('--dry');
const CANARY  = args.has('--canary');
const RUN_ALL = args.has('--all');

if (!DRY && !CANARY && !RUN_ALL) {
  console.error('Uso: node scripts/ghl_backfill_lead_panel.js --dry | --canary | --all');
  process.exit(1);
}

// ── Load field map ────────────────────────────────────────────
const PANEL_FIELDS_PATH = path.join(ROOT, 'lib', 'ghl_panel_fields.json');
const PANEL_FIELDS = JSON.parse(fs.readFileSync(PANEL_FIELDS_PATH, 'utf-8')).fields;

// ── Supabase client ───────────────────────────────────────────
const SUPA = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── GHL headers ───────────────────────────────────────────────
const GHL_HEADERS = {
  Authorization: `Bearer ${GHL_KEY}`,
  Version:       '2021-04-15',
  'Content-Type':'application/json',
  Accept:        'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Supabase query ────────────────────────────────────────────
async function fetchSentLeads() {
  const { data, error } = await SUPA
    .from('leads')
    .select(`
      id,
      business_name,
      email_address,
      email,
      phone,
      industry,
      metro_area,
      website,
      google_maps_url,
      facebook_url,
      instagram_url,
      review_count,
      rating,
      qualification_score,
      lead_tier,
      campaign_enriched_data!inner (
        id,
        radiography_technical,
        attack_angle,
        email_sent_at,
        lead_magnets_data,
        outreach_status
      )
    `)
    .eq('brand_id', BRAND_ID)
    .eq('campaign_enriched_data.outreach_status', 'SENT');

  if (error) throw error;
  return data || [];
}

// ── GHL helpers (reimplemented locally — do NOT import tools/email.js) ────

async function findContactByEmail(email) {
  if (!email) return null;
  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set('locationId', LOCATION_ID);
  url.searchParams.set('query', email);
  url.searchParams.set('limit', '5');
  const res = await fetch(url.toString(), { headers: GHL_HEADERS });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`contact search ${res.status}: ${t.slice(0, 150)}`);
  }
  const body = await res.json();
  const list = body?.contacts || [];
  return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
}

async function updateContactFields(contactId, customFields) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: GHL_HEADERS,
    body: JSON.stringify({ customFields }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(body).slice(0, 250) };
  }
  return { ok: true };
}

async function getContactNotes(contactId) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    headers: GHL_HEADERS,
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return body?.notes || [];
}

async function createContactNote(contactId, body) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ body }),
  });
  const resp = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(resp).slice(0, 250) };
  }
  return { ok: true };
}

// ── Custom fields builder ─────────────────────────────────────
function buildCustomFields(row, ced) {
  const fieldDefs = [
    { key: 'emprika__website_url',         value: row.website },
    { key: 'emprika__google_maps_url',     value: row.google_maps_url },
    { key: 'emprika__facebook_url',        value: row.facebook_url },
    { key: 'emprika__instagram_url',       value: row.instagram_url },
    { key: 'emprika__industry',            value: row.industry },
    { key: 'emprika__metro_area',          value: row.metro_area },
    { key: 'emprika__review_count',        value: row.review_count },
    { key: 'emprika__rating',              value: row.rating },
    { key: 'emprika__qualification_score', value: row.qualification_score },
    { key: 'emprika__lead_tier',           value: row.lead_tier },
    { key: 'emprika__genoma',              value: (ced.radiography_technical || '').slice(0, 2000) },
    { key: 'emprika__attack_angle',        value: (ced.attack_angle || '').slice(0, 2000) },
    {
      key:   'emprika__last_email_sent_at',
      value: ced.email_sent_at ? new Date(ced.email_sent_at).toISOString() : '',
    },
    { key: 'emprika__outreach_path',       value: 'email' },
  ];

  const out = [];
  for (const { key, value } of fieldDefs) {
    if (value === null || value === undefined || value === '') continue;
    const fieldMeta = PANEL_FIELDS[key];
    if (!fieldMeta?.id) {
      console.warn(`  [WARN] Campo desconocido en panel_fields.json: ${key}`);
      continue;
    }
    out.push({ id: fieldMeta.id, key, field_value: value });
  }
  return out;
}

// ── Note template (IR1: Spanish-only) ────────────────────────
function buildNote(row, ced) {
  const score  = row.qualification_score ?? '—';
  const tier   = row.lead_tier           || '—';
  const metro  = row.metro_area          || '—';
  const ind    = row.industry            || '—';

  const genoma = ced.radiography_technical
    ? (ced.radiography_technical.length > 300
        ? ced.radiography_technical.slice(0, 300) + '...'
        : ced.radiography_technical)
    : 'Sin enriquecimiento todavía.';

  const angulo = ced.attack_angle
    ? (ced.attack_angle.length > 200
        ? ced.attack_angle.slice(0, 200) + '...'
        : ced.attack_angle)
    : 'Sin enriquecimiento todavía.';

  const lines = [
    `[empirika-genoma:v1] · score ${score} · ${tier} · ${metro} · ${ind}`,
    '─────────────────────────────────────────────',
    `Genoma: ${genoma}`,
    '',
    `Ángulo de ataque: ${angulo}`,
    '',
    'Links:',
    `🌐 ${row.website        || '—'}`,
    `🗺️ ${row.google_maps_url || '—'}`,
    `📘 ${row.facebook_url   || '—'}`,
    `📷 ${row.instagram_url  || '—'}`,
    '',
    `Generado: ${new Date().toISOString()}`,
  ];

  return lines.join('\n');
}

// ── Process one lead ──────────────────────────────────────────
async function processLead(row, ced, { dryRun }) {
  const email = row.email_address || row.email;
  if (!email) return { skipped: true, reason: 'no_email' };

  let contact = null;
  try {
    contact = await findContactByEmail(email);
  } catch (e) {
    return { skipped: true, reason: 'no_ghl_contact', detail: e.message };
  }
  if (!contact?.id) return { skipped: true, reason: 'no_ghl_contact' };

  const customFields = buildCustomFields(row, ced);
  const noteBody     = buildNote(row, ced);

  if (dryRun) {
    console.log(`\n  [DRY] "${row.business_name}" (${email})`);
    console.log(`    GHL contact: ${contact.id}`);
    console.log(`    Campos a actualizar: ${customFields.length}`);
    customFields.forEach(f => console.log(`      ${f.key}: ${String(f.field_value).slice(0, 60)}`));
    console.log(`    Nota:\n${noteBody.split('\n').map(l => '      ' + l).join('\n')}`);
    return { ok: true, dry: true, contactId: contact.id };
  }

  // Update custom fields.
  const upd = await updateContactFields(contact.id, customFields);
  if (!upd.ok) {
    return { skipped: true, reason: 'api_error', detail: `fields update ${upd.status}: ${upd.error}` };
  }

  // Drop note (idempotent).
  let noteCreated = false;
  let noteSkipped = false;
  try {
    const existingNotes = await getContactNotes(contact.id);
    const alreadyHasNote = existingNotes.some(n =>
      (n.body || '').startsWith('[empirika-genoma:v1]')
    );
    if (alreadyHasNote) {
      noteSkipped = true;
    } else {
      const noteRes = await createContactNote(contact.id, noteBody);
      if (noteRes.ok) {
        noteCreated = true;
      } else {
        console.warn(`  [WARN] nota no creada para ${contact.id}: ${noteRes.error}`);
      }
    }
  } catch (e) {
    console.warn(`  [WARN] error al manejar notas para ${contact.id}: ${e.message}`);
  }

  return { ok: true, contactId: contact.id, noteCreated, noteSkipped };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const mode = DRY ? 'DRY' : CANARY ? 'CANARY-3' : 'ALL';
  console.log('═══════════════════════════════════════════════════════');
  console.log('  GHL Lead Panel Backfill — Empírika');
  console.log(`  Location: ${LOCATION_ID}`);
  console.log(`  Modo: ${mode}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Query Supabase.
  console.log('→ Consultando Supabase…');
  const rows = await fetchSentLeads();
  console.log(`→ Universe: ${rows.length} leads con outreach_status=SENT\n`);

  const batch = (DRY || CANARY) ? rows.slice(0, 3) : rows;

  // Stats.
  let fieldsUpdated    = 0;
  let notesCreated     = 0;
  let notesSkipped     = 0;
  let errorSkipped     = 0;
  const skipReasons    = { no_email: 0, no_ghl_contact: 0, api_error: 0 };

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    // campaign_enriched_data is returned as array from the join.
    const cedArr = Array.isArray(row.campaign_enriched_data)
      ? row.campaign_enriched_data
      : [row.campaign_enriched_data];
    const ced = cedArr[0] || {};

    const biz = row.business_name || '(sin nombre)';
    console.log(`[${i + 1}/${batch.length}] ${biz} (${row.email_address || row.email || 'sin email'})`);

    let result;
    try {
      result = await processLead(row, ced, { dryRun: DRY });
    } catch (e) {
      console.log(`  ! excepción: ${e.message}`);
      errorSkipped++;
      skipReasons.api_error++;
      if (i < batch.length - 1) await sleep(DELAY_MS);
      continue;
    }

    if (result.skipped) {
      const reason = result.reason || 'unknown';
      console.log(`  SKIP: ${reason}${result.detail ? ' — ' + result.detail : ''}`);
      errorSkipped++;
      if (reason in skipReasons) skipReasons[reason]++;
    } else if (result.dry) {
      fieldsUpdated++;
    } else {
      fieldsUpdated++;
      if (result.noteCreated) notesCreated++;
      if (result.noteSkipped) notesSkipped++;
      console.log(`  ✓ campos actualizados${result.noteCreated ? ' + nota creada' : ''}${result.noteSkipped ? ' (nota ya existía)' : ''}`);
    }

    if (i < batch.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`[backfill] universe=${rows.length}`);
  console.log(`  matched_supabase=${rows.length}`);
  console.log(`  matched_ghl_contact=${fieldsUpdated + notesCreated + notesSkipped}`);
  console.log(`  fields_updated=${fieldsUpdated}`);
  console.log(`  notes_created=${notesCreated} notes_skipped_existing=${notesSkipped}`);
  console.log(`  errors_skipped=${errorSkipped} (no_email: ${skipReasons.no_email}, no_ghl_contact: ${skipReasons.no_ghl_contact}, api_error: ${skipReasons.api_error})`);
  console.log('═══════════════════════════════════════════════════════');

  if (CANARY && rows.length > 3) {
    console.log(`\nCanary OK → re-ejecutar con --all para procesar los ${rows.length - 3} restantes.`);
  }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
