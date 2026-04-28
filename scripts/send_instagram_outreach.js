// Send Instagram DM outreach via GHL to leads with instagram_url.
// - Hermano de send_whatsapp_outreach.js — misma estructura, distinto canal.
// - GHL conversations/messages soporta type='IG' nativamente cuando la cuenta
//   IG está enlazada al location (Empírika: @empirikagroup → uQPxZOmT4zVlMHfOGRw2).
// - Idempotente: skips leads ya stampados con ig_sent_at en lead_magnets_data.
// - NO usa Meta template approval (IG DM acepta texto libre).
// - NO usa metro allowlist (IG es global; el filtro Latino aplica solo a WA).
//
// Usage:
//   node scripts/send_instagram_outreach.js --dry       # preview, no send
//   node scripts/send_instagram_outreach.js --canary    # send first 1 only
//   node scripts/send_instagram_outreach.js --all       # send all candidates
//
// Resultado: persiste ig_sent_at, ig_message_id (o ig_error) en lead_magnets_data.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPA = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const GHL_KEY     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
const BRAND_ID    = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE    = 'https://services.leadconnectorhq.com';

// IG DM no admite asteriscos como negrita (es Markdown WA-style). Mantenemos
// el copy core pero sin formato. Las mismas variables que el WA template.
function renderBody({ business_name, city, email }) {
  const emailLine = email
    ? `\n\nLa propuesta la tienen disponible en la bandeja de entrada de: ${email}`
    : '';
  return [
    `¡Hola, equipo de ${business_name}! ¿Cómo están?`,
    `Les habla José Sánchez de Empirika Group. Los contacto porque a mi equipo le ` +
    `llamó la atención su trabajo en ${city}. Por eso, nos tomamos la libertad de ` +
    `diseñar una propuesta visual de cómo luciría su página web 100% personalizada, ` +
    `enfocada a convertir leads en potenciales clientes.🚀${emailLine}`,
    `¿Les gustaría que agendemos una breve llamada para comentar los detalles?`,
  ].join('\n\n');
}

const args = new Set(process.argv.slice(2));
const DRY     = args.has('--dry');
const CANARY  = args.has('--canary');
const RUN_ALL = args.has('--all');
if (!DRY && !CANARY && !RUN_ALL) {
  console.error('Specify --dry, --canary, or --all');
  process.exit(1);
}

const ghlHeaders = {
  Authorization: `Bearer ${GHL_KEY}`,
  Version:       '2021-04-15',
  'Content-Type':'application/json',
  Accept:        'application/json',
};

function normCity(metro) {
  if (!metro) return 'su zona';
  return String(metro).split(',')[0].trim() || 'su zona';
}

// IG handle from instagram_url (https://instagram.com/foo/ → foo)
function extractIgHandle(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/([^/?#]+)/i);
  return m ? m[1].replace(/^@/, '') : null;
}

async function findContactByQuery(query, exactField = null) {
  if (!query) return null;
  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set('locationId', LOCATION_ID);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', '5');
  const res = await fetch(url, { headers: ghlHeaders });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`contact search ${res.status}: ${t.slice(0, 150)}`);
  }
  const body = await res.json();
  const list = body?.contacts || [];
  // Verifier audit 2026-04-28: cuando el caller pide exactField, exigir
  // match exacto (case-insensitive) en esa propiedad. Sin esto el primer
  // resultado del fuzzy search puede ser un contacto distinto del lead.
  if (!exactField) return list[0] || null;
  return list.find(c => (c?.[exactField] || '').toLowerCase() === query.toLowerCase()) || null;
}

// Try several keys to find the GHL contact that matches this lead.
// email y phone se exigen exactos; handle y business_name aceptan first-match
// porque el fuzzy search es la única vía cuando no hay identificador único.
async function resolveContact({ email, phone, instagramHandle, businessName }) {
  if (email) {
    const c = await findContactByQuery(email, 'email');
    if (c?.id) return { contact: c, matched_by: 'email' };
  }
  if (phone) {
    const c = await findContactByQuery(phone, 'phone');
    if (c?.id) return { contact: c, matched_by: 'phone' };
  }
  if (instagramHandle) {
    const c = await findContactByQuery(instagramHandle);
    if (c?.id) return { contact: c, matched_by: 'instagram_handle' };
  }
  if (businessName) {
    const c = await findContactByQuery(businessName);
    if (c?.id) return { contact: c, matched_by: 'business_name' };
  }
  return { contact: null, matched_by: null };
}

async function sendInstagramDM(contactId, message) {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders,
    body: JSON.stringify({
      type:      'IG',
      contactId,
      message,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(body).slice(0, 250) };
  }
  return {
    ok: true,
    messageId:      body?.messageId || body?.id || null,
    conversationId: body?.conversationId || null,
  };
}

async function fetchLeads() {
  // Candidatos: leads con instagram_url poblado, ya en estado SENT, y aún
  // sin ig_sent_at. Verifier audit 2026-04-28: filtrar por outreach_status='SENT'
  // igual que el script hermano send_whatsapp_outreach.js. Sin este filtro,
  // --all procesaría leads PENDING/DISQUALIFIED.
  const { data, error } = await SUPA
    .from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data, leads!inner(id, business_name, email_address, phone, metro_area, instagram_url)')
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'SENT');
  if (error) throw error;

  const seen = new Set();
  const out  = [];
  for (const row of data || []) {
    const lead = row.leads;
    if (!lead || seen.has(lead.id)) continue;
    if (!lead.instagram_url) continue;
    if ((row.lead_magnets_data || {}).ig_sent_at) continue; // already sent
    seen.add(lead.id);
    out.push(row);
  }
  return out;
}

async function main() {
  const todo = await fetchLeads();
  console.log(`[start] ${todo.length} leads pending Instagram DM (mode: ${DRY ? 'DRY' : CANARY ? 'CANARY-1' : 'ALL'})`);

  const batch = CANARY ? todo.slice(0, 1) : todo;
  let sent = 0, failed = 0, skipped = 0;

  for (const row of batch) {
    const lead   = row.leads;
    const city   = normCity(lead.metro_area);
    const handle = extractIgHandle(lead.instagram_url);
    const body   = renderBody({
      business_name: lead.business_name,
      city,
      email:         lead.email_address || null,
    });

    if (DRY) {
      console.log('\n──────────────────────────────────');
      console.log(`TO: ${lead.business_name} → ig=@${handle || '?'} [${city}]`);
      console.log('--- rendered preview ---');
      console.log(body);
      sent++;
      continue;
    }

    try {
      const { contact, matched_by } = await resolveContact({
        email:           lead.email_address,
        phone:           lead.phone,
        instagramHandle: handle,
        businessName:    lead.business_name,
      });
      if (!contact?.id) {
        console.log(`SKIP no-contact: ${lead.business_name} (no GHL match)`);
        skipped++;
        continue;
      }

      const send = await sendInstagramDM(contact.id, body);
      const md = { ...(row.lead_magnets_data || {}) };
      md.ghl_contact_id = contact.id;
      md.ig_contact_matched_by = matched_by;
      if (send.ok) {
        md.ig_sent_at         = new Date().toISOString();
        md.ig_message_id      = send.messageId;
        md.ig_conversation_id = send.conversationId;
        md.ig_handle_used     = handle;
        md.ig_last_body       = body; // for auditor lint parity with wa_last_body
        sent++;
        console.log(`✓ ${lead.business_name} [@${handle}] → msg ${send.messageId}`);
      } else {
        md.ig_error = `${send.status}: ${send.error}`;
        failed++;
        console.log(`✗ ${lead.business_name}: ${send.status} ${send.error}`);
      }
      await SUPA.from('campaign_enriched_data').update({ lead_magnets_data: md }).eq('id', row.id);
    } catch (e) {
      failed++;
      console.log(`! ${lead.business_name}: ${e.message}`);
    }
    // Small pacing between sends — Meta dislikes bursts.
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n[done] sent=${sent} failed=${failed} skipped=${skipped} of ${batch.length}`);
  if (CANARY && todo.length > 1) {
    console.log(`Canary OK → re-run with --all to send remaining ${todo.length - 1}.`);
  }
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
