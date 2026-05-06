// ============================================================
// scripts/reverify_guessed_emails_2026-05-06.js
//
// Re-runs the website-scrape email verifier against every lead
// from the 2026-05-06 batch that was sent before the verifier
// was integrated (i.e. metadata.email_verified is not 'true').
// Classifies each as CONFIRMED / WRONG / UNKNOWN and prints a
// punch-list. Optional --apply mode persists the verifier
// findings and tags the GHL contact.
//
// Usage:
//   node scripts/reverify_guessed_emails_2026-05-06.js          # dry, just report
//   node scripts/reverify_guessed_emails_2026-05-06.js --apply  # update Supabase + GHL tags
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { discoverEmail } from '../lib/emailVerifier.js';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = GHL_TOKEN
  ? {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  : null;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

async function ghlAddTag(contactId, tags) {
  if (!GHL_HEADERS || !contactId) return;
  await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ tags }),
  }).catch(() => {});
}

async function ghlAddNote(contactId, body) {
  if (!GHL_HEADERS || !contactId) return;
  await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ body }),
  }).catch(() => {});
}

(async () => {
  console.log(`\n=== Re-verify batch 2026-05-06 (info@ guess sends) ===`);
  console.log(`Mode: ${APPLY ? 'APPLY (update DB + GHL)' : 'DRY-RUN (report only)'}\n`);

  // Pull the 17 guessed-info leads
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, email_address, website, metro_area')
    .eq('brand_id', BRAND_ID)
    .eq('scraped_by', 'apify_compass_2026-05-06_run2')
    .eq('outreach_status', 'SENT');
  if (error) throw error;

  // Need outreach_events to filter only the unverified ones + grab GHL contact id
  const { data: events } = await supabase
    .from('outreach_events')
    .select('lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent');
  const ghlByLead = new Map();
  const verifiedByLead = new Map();
  for (const e of events || []) {
    ghlByLead.set(e.lead_id, e.metadata?.ghl_contact_id || null);
    verifiedByLead.set(e.lead_id, e.metadata?.email_verified === true);
  }

  const targets = leads.filter(l => verifiedByLead.get(l.id) !== true);
  console.log(`Targets (unverified sends): ${targets.length}\n`);

  const buckets = { CONFIRMED: [], WRONG: [], UNKNOWN: [] };

  for (const t of targets) {
    process.stdout.write(`  · ${t.business_name.padEnd(45)} `);
    const result = await discoverEmail(t.website);
    if (!result) {
      console.log(`UNKNOWN — sin email publicado`);
      buckets.UNKNOWN.push({ ...t, ghlContactId: ghlByLead.get(t.id) });
      continue;
    }
    const sentEmail = (t.email_address || '').toLowerCase();
    const allFoundLc = result.allFound.map(e => e.toLowerCase());
    if (allFoundLc.includes(sentEmail)) {
      console.log(`✓ CONFIRMED — ${sentEmail} aparece en sitio`);
      buckets.CONFIRMED.push({ ...t, found: result.allFound, ghlContactId: ghlByLead.get(t.id) });
    } else {
      console.log(`✗ WRONG — sitio publica ${result.email} (probable bounce de ${sentEmail})`);
      buckets.WRONG.push({
        ...t,
        sentEmail,
        correctEmail: result.email,
        found: result.allFound,
        source: result.source,
        ghlContactId: ghlByLead.get(t.id),
      });
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`CONFIRMED:  ${buckets.CONFIRMED.length}  ← guess matchea email publicado`);
  console.log(`WRONG:      ${buckets.WRONG.length}  ← guess es incorrecto, hay email mejor`);
  console.log(`UNKNOWN:    ${buckets.UNKNOWN.length}  ← sitio sin email publicado, riesgo bounce`);

  if (buckets.WRONG.length) {
    console.log(`\nWRONG detalle:`);
    for (const w of buckets.WRONG) {
      console.log(`  ${w.business_name}`);
      console.log(`    enviado:   ${w.sentEmail}`);
      console.log(`    correcto:  ${w.correctEmail}  (${w.source})`);
      if (w.found.length > 1) console.log(`    otros:     ${w.found.slice(1).join(', ')}`);
    }
  }

  if (buckets.UNKNOWN.length) {
    console.log(`\nUNKNOWN detalle:`);
    for (const u of buckets.UNKNOWN) {
      console.log(`  ${u.business_name.padEnd(45)} → ${u.email_address}`);
    }
  }

  if (!APPLY) {
    console.log(`\n(dry-run — pasa --apply para escribir tags/notas en GHL)`);
    return;
  }

  // APPLY: tag the WRONG and UNKNOWN contacts in GHL so they're visible
  console.log(`\nAplicando tags en GHL…`);
  for (const w of buckets.WRONG) {
    if (!w.ghlContactId) continue;
    await ghlAddTag(w.ghlContactId, ['email-bounce-risk', 'email-corregido-disponible']);
    await ghlAddNote(w.ghlContactId, `[email-verify:2026-05-06] Email enviado (${w.sentEmail}) probablemente erróneo.
Email real publicado en sitio: ${w.correctEmail}
Otros encontrados: ${w.found.join(', ')}
Fuente: ${w.source}
Acción sugerida: re-enviar a ${w.correctEmail} en una segunda tanda manual.`);
    console.log(`  ✓ ${w.business_name} — tagged WRONG`);
  }
  for (const u of buckets.UNKNOWN) {
    if (!u.ghlContactId) continue;
    await ghlAddTag(u.ghlContactId, ['email-bounce-risk', 'email-no-publicado']);
    await ghlAddNote(u.ghlContactId, `[email-verify:2026-05-06] Email enviado (${u.email_address}) no se pudo confirmar contra sitio web.
El sitio no publica direcciones de email — probable formulario de contacto.
Acción sugerida: monitorear bounce, considerar contacto por teléfono.`);
    console.log(`  ✓ ${u.business_name} — tagged UNKNOWN`);
  }

  // Persist verifier status to outreach_events.metadata for the FU48h cron's awareness
  const updates = [
    ...buckets.WRONG.map(w => ({ id: w.id, status: 'guess_wrong', correctEmail: w.correctEmail })),
    ...buckets.UNKNOWN.map(u => ({ id: u.id, status: 'guess_unknown' })),
    ...buckets.CONFIRMED.map(c => ({ id: c.id, status: 'guess_confirmed' })),
  ];

  for (const u of updates) {
    const { data: rows } = await supabase
      .from('outreach_events')
      .select('id, metadata')
      .eq('lead_id', u.id)
      .eq('event_type', 'sent')
      .eq('channel', 'email')
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (!rows?.length) continue;
    const newMeta = {
      ...rows[0].metadata,
      verifier_recheck: u.status,
      verifier_recheck_at: new Date().toISOString(),
      verifier_recheck_correct_email: u.correctEmail || null,
    };
    await supabase.from('outreach_events').update({ metadata: newMeta }).eq('id', rows[0].id);
  }
  console.log(`\nMetadata actualizada en ${updates.length} outreach_events.`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
