// Send WhatsApp outreach via GHL to all SENT leads with phone+email+metro_area.
// - Renders Spanish template per lead, replacing {BUSINESS_NAME}, {CITY}, {EMAIL}.
// - Looks up GHL contact by email (creates one if missing via dedupe path).
// - POST /conversations/messages with type=WhatsApp via direct GHL API.
// - Idempotent: skips leads already stamped wa_sent_at in lead_magnets_data.
//
// Usage:
//   node scripts/send_whatsapp_outreach.js --canary    # send to FIRST 1 only (smoke)
//   node scripts/send_whatsapp_outreach.js --dry       # preview rendered messages, no send
//   node scripts/send_whatsapp_outreach.js --all       # send all
//
// Resultado: persiste wa_sent_at, wa_message_id (o wa_error) en lead_magnets_data.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { verifyAndStampLead } from './wa_lookup_gate.js';

const SUPA = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const GHL_KEY     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
const BRAND_ID    = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const TEMPLATE_NAME = 'cold_leads_welcome';

// Raw template body — must match the GHL-approved template byte-for-byte.
// Merge fields stay as literals; GHL/Meta resolves them via `placeholders`.
// 2026-04-28: copy actualizado por cliente Empírika (José Sánchez). El saludo
// va en negrita WhatsApp (*…*) y se eliminó la firma final "Empirika Group".
// IMPORTANTE: para que el lead reciba este formato hay que actualizar también
// el template "cold_leads_welcome" en Meta/GHL Business Manager — Meta envía
// la versión registrada, no este string. Este código alimenta solo el render
// preview (--dry) y el stamp wa_last_body que consume el auditor 10b.
const TEMPLATE_RAW_BODY =
  '*¡Hola, equipo de {{contact.name}}! ¿Cómo están?*\n' +
  'Les habla José Sánchez de Empirika Group. Los contacto porque a mi equipo le ' +
  'llamó la atención su trabajo en {{contact.city}}. Por eso, nos tomamos la ' +
  'libertad de diseñar una propuesta visual de cómo luciría su página web 100% ' +
  'personalizada, enfocada a convertir leads en potenciales clientes.🚀\n\n' +
  'La propuesta la tienen disponible en la bandeja de entrada de: {{contact.email}} \n\n' +
  'Sabiendo esto, ¿les gustaría que agendemos una breve llamada para comentar los detalles?';

const args = new Set(process.argv.slice(2));
const DRY     = args.has('--dry');
const CANARY  = args.has('--canary');
const RUN_ALL = args.has('--all');
if (!DRY && !CANARY && !RUN_ALL) {
  console.error('Specify --dry, --canary, or --all');
  process.exit(1);
}

// Plan D (2026-04-22, Brian-approved): WhatsApp B2B penetration in US is
// ~15-20% overall, but concentrated in Latino-majority metros. Narrow the
// WA dispatch branch to these metros to raise verified-mobile hit rate and
// cut Twilio Lookup spend on dead-end zones. Email channel is unaffected
// (this filter lives in send_whatsapp_outreach.js only).
// Matching is substring on metro_area, case-insensitive — metro_area values
// in the DB look like "Miami, FL", "Los Angeles, CA", etc.
const METRO_ALLOWLIST = [
  'miami', 'hialeah', 'doral', 'kendall',                  // South FL
  'los angeles', 'long beach', 'santa ana', 'anaheim',     // LA / OC
  'queens', 'bronx', 'jackson heights', 'corona',          // NYC Latino
  'chicago',                                                // Pilsen/Little Village fall under "Chicago, IL"
  'houston',                                                // Gulfton/Spring Branch
  'san antonio', 'el paso', 'mcallen', 'laredo',           // TX LatAm
  'phoenix', 'mesa',                                        // AZ LatAm
];
function isLatinoMetro(metro) {
  if (!metro) return false;
  const m = String(metro).toLowerCase();
  return METRO_ALLOWLIST.some(needle => m.includes(needle));
}

const ghlHeaders = {
  Authorization: `Bearer ${GHL_KEY}`,
  Version:       '2021-04-15',
  'Content-Type':'application/json',
  Accept:        'application/json',
};

// Placeholders map to template components: header has {{contact.name}} (1 var);
// body has {{contact.city}} and {{contact.email}} (2 vars, in order).
function buildPlaceholders({ business_name, city, email }) {
  return {
    header: [business_name],
    body:   [city, email],
  };
}

function renderPreview({ business_name, city, email }) {
  return TEMPLATE_RAW_BODY
    .replace('{{contact.name}}',  business_name)
    .replace('{{contact.city}}',  city)
    .replace('{{contact.email}}', email);
}

function normCity(metro) {
  if (!metro) return 'su zona';
  return String(metro).split(',')[0].trim() || 'su zona';
}

async function findContactByEmail(email) {
  if (!email) return null;
  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set('locationId', LOCATION_ID);
  url.searchParams.set('query', email);
  url.searchParams.set('limit', '5');
  const res = await fetch(url, { headers: ghlHeaders });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`contact search ${res.status}: ${t.slice(0, 150)}`);
  }
  const body = await res.json();
  const list = body?.contacts || [];
  return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
}

async function sendWhatsApp(contactId, placeholders) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders,
    body: JSON.stringify({
      type:      'WhatsApp',
      contactId,
      message:   TEMPLATE_RAW_BODY,
      whatsapp: {
        type: 'template',
        template: { name: TEMPLATE_NAME, lang: 'es_MX', category: 'MARKETING' },
        placeholders,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(body).slice(0, 250) };
  }
  return { ok: true, messageId: body?.messageId || body?.id || null, conversationId: body?.conversationId || null };
}

async function fetchLeads() {
  const { data, error } = await SUPA
    .from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data, leads!inner(id, business_name, email_address, phone, metro_area)')
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'SENT');
  if (error) throw error;

  // Dedupe by lead.id, keep first row.
  const seen = new Set();
  const out = [];
  let skipped_metro = 0;
  for (const row of data || []) {
    const lead = row.leads;
    if (!lead || seen.has(lead.id)) continue;
    if (!lead.phone || !lead.email_address || !lead.metro_area) continue;
    if ((row.lead_magnets_data || {}).wa_sent_at) continue; // already sent
    if (!isLatinoMetro(lead.metro_area)) { skipped_metro++; seen.add(lead.id); continue; }
    seen.add(lead.id);
    out.push(row);
  }
  if (skipped_metro > 0) console.log(`[metro_filter] skipped ${skipped_metro} leads outside Latino-metro allowlist (Plan D)`);
  return out;
}

async function main() {
  const todo = await fetchLeads();
  console.log(`[start] ${todo.length} leads pending WhatsApp (mode: ${DRY ? 'DRY' : CANARY ? 'CANARY-1' : 'ALL'})`);

  const batch = CANARY ? todo.slice(0, 1) : todo;
  let sent = 0, failed = 0, skipped = 0, skipped_not_verified = 0, skipped_lookup_failed = 0;

  for (const row of batch) {
    const lead = row.leads;
    const city = normCity(lead.metro_area);

    // Plan B gate: pre-flight Twilio Lookup verdict must be wa_verified===true.
    // Under DRY we do not spend Twilio cost; treat unverified leads as "would gate".
    let lmd = row.lead_magnets_data || {};
    if (lmd.wa_verified !== true) {
      if (lmd.wa_verified === false) {
        const reason = lmd.wa_lookup_details?.reason || lmd.wa_lookup_error || 'unknown';
        console.log(`[wa_gate] SKIP ${lead.id}: wa_verified=false (${reason})`);
        skipped_not_verified++;
        continue;
      }
      if (DRY) {
        console.log(`[wa_gate] DRY would verify ${lead.id} (${lead.phone}) and gate if not mobile`);
        skipped_not_verified++;
        continue;
      }
      try {
        const res = await verifyAndStampLead(lead.id, lead.phone);
        if (res.error || !res.verified) {
          const reason = res.error || 'not_mobile';
          console.log(`[wa_gate] SKIP ${lead.id}: wa_verified=false (${reason})`);
          if (res.error) skipped_lookup_failed++; else skipped_not_verified++;
          continue;
        }
        lmd = { ...lmd, wa_verified: true };
      } catch (e) {
        console.log(`[wa_gate] SKIP ${lead.id}: lookup threw ${e.message}`);
        skipped_lookup_failed++;
        continue;
      }
    }
    const placeholders = buildPlaceholders({
      business_name: lead.business_name,
      city,
      email:         lead.email_address,
    });

    if (DRY) {
      console.log('\n──────────────────────────────────');
      console.log(`TO: ${lead.business_name} (${lead.phone}) [${city}]`);
      console.log(`placeholders: ${JSON.stringify(placeholders)}`);
      console.log('--- rendered preview ---');
      console.log(renderPreview({ business_name: lead.business_name, city, email: lead.email_address }));
      sent++;
      continue;
    }

    try {
      const contact = await findContactByEmail(lead.email_address);
      if (!contact?.id) { console.log(`SKIP no-contact: ${lead.business_name} (${lead.email_address})`); skipped++; continue; }

      const send = await sendWhatsApp(contact.id, placeholders);
      const md = { ...lmd };
      md.ghl_contact_id = contact.id;
      if (send.ok) {
        md.wa_sent_at        = new Date().toISOString();
        md.wa_message_id     = send.messageId;
        md.wa_conversation_id= send.conversationId;
        md.wa_city_used      = city;
        // Plan v3 iter-2 A5: stamp rendered body so auditor metric 10b
        // (whatsapp_spanish_violation_count_24h) can lint what was actually sent.
        md.wa_last_body      = renderPreview({ business_name: lead.business_name, city, email: lead.email_address });
        sent++;
        console.log(`✓ ${lead.business_name} [${city}] → msg ${send.messageId}`);
      } else {
        md.wa_error = `${send.status}: ${send.error}`;
        failed++;
        console.log(`✗ ${lead.business_name}: ${send.status} ${send.error}`);
      }
      await SUPA.from('campaign_enriched_data').update({ lead_magnets_data: md }).eq('id', row.id);
    } catch (e) {
      failed++;
      console.log(`! ${lead.business_name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n[done] sent=${sent} failed=${failed} skipped=${skipped} skipped_not_verified=${skipped_not_verified} skipped_lookup_failed=${skipped_lookup_failed} of ${batch.length}`);
  if (CANARY && todo.length > 1) console.log(`Canary OK → re-run with --all to send remaining ${todo.length - 1}.`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
