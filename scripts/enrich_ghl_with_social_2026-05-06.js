// ============================================================
// scripts/enrich_ghl_with_social_2026-05-06.js
//
// Backfills social-handle custom fields + a summary note for
// every GHL contact created today (2026-05-06) by the HVAC FL
// batch (outreach_events.event_type='sent', channel='email',
// occurred_at >= 2026-05-06T12:00:00Z).
//
// Custom fields updated:
//   emprika__facebook_url   (id KnKcNQahb1bQFFQH0sOx)
//   emprika__instagram_url  (id Xt47l5bZCQtsf07bvKdp)
//   emprika__website_url    (id neh3G0JBd5UaOWLyQYA3)
//
// Also drops one [empirika-social-handles:v1] note per contact
// (idempotent — checks for existing note before creating).
//
// Usage:
//   node scripts/enrich_ghl_with_social_2026-05-06.js [--dry-run]
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── CLI flags ─────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');

// ── Config ────────────────────────────────────────────────────
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'uQPxZOmT4zVlMHfOGRw2';
const BRAND_ID    = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const DELAY_MS    = 200;
const NOTE_MARKER = '[empirika-social-handles:v1]';

// Token: prefer GHL_PRIVATE_TOKEN (same pattern as move_to_nuevo script),
// fall back to EMPIRIKA_GHL_KEY
const TOKEN = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;

if (!TOKEN) {
  console.error('FATAL: GHL_PRIVATE_TOKEN / EMPIRIKA_GHL_KEY not set');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// ── Load field map ────────────────────────────────────────────
const PANEL_FIELDS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'lib', 'ghl_panel_fields.json'), 'utf-8'),
).fields;

// Confirm required fields exist
const REQUIRED_FIELDS = ['emprika__facebook_url', 'emprika__instagram_url', 'emprika__website_url'];
for (const key of REQUIRED_FIELDS) {
  if (!PANEL_FIELDS[key]) {
    console.error(`FATAL: field "${key}" missing from lib/ghl_panel_fields.json`);
    process.exit(1);
  }
}

// ── Clients ───────────────────────────────────────────────────
const SUPA = createClient(SUPABASE_URL, SUPABASE_KEY);

const GHL_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── GHL API helpers ───────────────────────────────────────────

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

async function createContactNote(contactId, noteBody) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ body: noteBody }),
  });
  const resp = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(resp).slice(0, 250) };
  }
  return { ok: true };
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  if (DRY_RUN) console.log('\n[DRY-RUN] No GHL writes will happen.\n');

  // 1. Fetch today's sent events with a ghl_contact_id
  const { data: events, error: evErr } = await SUPA
    .from('outreach_events')
    .select('lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent')
    .gte('occurred_at', '2026-05-06T12:00:00Z');

  if (evErr) throw evErr;

  // Deduplicate: one entry per ghl_contact_id (use first event found)
  const contactMap = new Map(); // ghl_contact_id -> lead_id
  for (const ev of events) {
    const cid = ev.metadata?.ghl_contact_id;
    if (cid && !contactMap.has(cid)) {
      contactMap.set(cid, ev.lead_id);
    }
  }

  console.log(`=== Contactos a procesar: ${contactMap.size} ===\n`);

  if (contactMap.size === 0) {
    console.log('Nada que actualizar. Saliendo.');
    return;
  }

  // 2. Fetch lead social data for all lead IDs
  const leadIds = [...new Set(contactMap.values())];
  const { data: leads, error: leadErr } = await SUPA
    .from('leads')
    .select('id, business_name, instagram_url, facebook_url, linkedin_url, website')
    .in('id', leadIds);

  if (leadErr) throw leadErr;

  const leadById = new Map(leads.map((l) => [l.id, l]));

  // 3. Process each contact
  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (const [contactId, leadId] of contactMap.entries()) {
    const lead = leadById.get(leadId);
    if (!lead) {
      console.log(`  SKIP ${contactId} — lead ${leadId} not found in DB`);
      skipped++;
      continue;
    }

    const ig  = lead.instagram_url || '';
    const fb  = lead.facebook_url  || '';
    const web = lead.website        || '';
    const li  = lead.linkedin_url   || '';

    // Skip if no social data at all
    if (!ig && !fb && !web && !li) {
      console.log(`  SKIP ${contactId} — ${lead.business_name} (sin redes)`);
      skipped++;
      continue;
    }

    console.log(`  → ${lead.business_name} [${contactId}]`);
    if (ig)  console.log(`      IG:  ${ig}`);
    if (fb)  console.log(`      FB:  ${fb}`);
    if (web) console.log(`      WEB: ${web}`);
    if (li)  console.log(`      LI:  ${li}`);

    if (!DRY_RUN) {
      // 3a. Build custom fields (only non-empty values)
      const customFields = [];
      if (ig)  customFields.push({ id: PANEL_FIELDS['emprika__instagram_url'].id, key: 'emprika__instagram_url', field_value: ig });
      if (fb)  customFields.push({ id: PANEL_FIELDS['emprika__facebook_url'].id,  key: 'emprika__facebook_url',  field_value: fb });
      if (web) customFields.push({ id: PANEL_FIELDS['emprika__website_url'].id,   key: 'emprika__website_url',   field_value: web });

      if (customFields.length > 0) {
        const fieldRes = await updateContactFields(contactId, customFields);
        if (!fieldRes.ok) {
          console.error(`    ✗ Error actualizando fields: ${fieldRes.status} — ${fieldRes.error}`);
          failed++;
          await sleep(DELAY_MS);
          continue;
        }
        await sleep(DELAY_MS);
      }

      // 3b. Check for existing note (idempotent)
      const notes = await getContactNotes(contactId);
      await sleep(DELAY_MS);

      const alreadyHasNote = notes.some((n) => (n.body || '').includes(NOTE_MARKER));
      if (alreadyHasNote) {
        console.log(`    (nota ya existe, omitida)`);
      } else {
        // Build note body
        const lines = [`${NOTE_MARKER} — Redes sociales Empírika`];
        if (ig)  lines.push(`Instagram: ${ig}`);
        if (fb)  lines.push(`Facebook: ${fb}`);
        if (li)  lines.push(`LinkedIn: ${li}`);
        if (web) lines.push(`Website: ${web}`);

        const noteRes = await createContactNote(contactId, lines.join('\n'));
        if (!noteRes.ok) {
          console.error(`    ✗ Error creando nota: ${noteRes.status} — ${noteRes.error}`);
          // Don't count as full failure — fields were written
        } else {
          console.log(`    ✓ nota creada`);
        }
        await sleep(DELAY_MS);
      }
    }

    updated++;
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Omitidos:     ${skipped}`);
  console.log(`Fallos:       ${failed}`);
  if (DRY_RUN) console.log(`\n[DRY-RUN] Sin cambios reales en GHL.`);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
