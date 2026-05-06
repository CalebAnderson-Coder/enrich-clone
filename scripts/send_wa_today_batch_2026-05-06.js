// ============================================================
// scripts/send_wa_today_batch_2026-05-06.js
//
// Sends the approved Meta WhatsApp template `cold_leads_welcome`
// to the 34 leads from today's HVAC FL email batch (2026-05-06).
// Each lead already received an email earlier today and has a
// GHL contact + opportunity in stage NUEVO. The WhatsApp is the
// second touch in a multi-channel sequence.
//
// Reads target leads from outreach_events (where ghl_contact_id is
// stamped), not from campaign_enriched_data — so it does not collide
// with the autonomous dispatcher's own WA loop.
//
// Idempotent: a lead is skipped if outreach_events already contains
// a 'sent' event with channel='whatsapp' for that lead_id.
//
// Usage:
//   node scripts/send_wa_today_batch_2026-05-06.js --dry-run  # preview only
//   node scripts/send_wa_today_batch_2026-05-06.js --canary   # send to 1 lead
//   node scripts/send_wa_today_batch_2026-05-06.js --top=5    # send to top N by score
//   node scripts/send_wa_today_batch_2026-05-06.js --all      # send to all eligible
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const TEMPLATE_NAME = 'cold_leads_welcome';

// Body byte-for-byte identical to the Meta-approved template
// (verified 2026-04-28 by client José Sánchez).
const TEMPLATE_RAW_BODY =
  '*¡Hola, equipo de {{contact.name}}! ¿Cómo están?*\n' +
  'Les habla José Sánchez de Empirika Group. Los contacto porque a mi equipo le ' +
  'llamó la atención su trabajo en {{contact.city}}. Por eso, nos tomamos la ' +
  'libertad de diseñar una propuesta visual de cómo luciría su página web 100% ' +
  'personalizada, enfocada a convertir leads en potenciales clientes.🚀\n\n' +
  'La propuesta la tienen disponible en la bandeja de entrada de: {{contact.email}} \n\n' +
  'Sabiendo esto, ¿les gustaría que agendemos una breve llamada para comentar los detalles?';

// Latino-density allowlist for the today batch. Matches substring,
// case-insensitive, against metro_area.
const METRO_ALLOWLIST = [
  'miami', 'hialeah', 'doral', 'kendall',
  'kissimmee', 'orlando',
  'cape coral', 'lehigh acres',
  'tampa',
];
function isLatinoMetro(metro) {
  if (!metro) return false;
  const m = String(metro).toLowerCase();
  return METRO_ALLOWLIST.some(needle => m.includes(needle));
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CANARY = args.includes('--canary');
const ALL = args.includes('--all');
const topArg = args.find(a => a.startsWith('--top='));
const TOP_N = topArg ? parseInt(topArg.split('=')[1], 10) : null;
if (!DRY && !CANARY && !ALL && !TOP_N) {
  console.error('Pasa --dry-run, --canary, --top=N, o --all');
  process.exit(1);
}

if (!GHL_KEY) { console.error('FATAL: GHL key missing'); process.exit(1); }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

const ghlHeaders = {
  Authorization: `Bearer ${GHL_KEY}`,
  Version: '2021-04-15',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function normCity(metro) {
  if (!metro) return 'su zona';
  return String(metro).split(',')[0].trim() || 'su zona';
}

function renderPreview({ business_name, city, email }) {
  return TEMPLATE_RAW_BODY
    .replace('{{contact.name}}', business_name)
    .replace('{{contact.city}}', city)
    .replace('{{contact.email}}', email);
}

async function sendWhatsApp(contactId, businessName, city, email) {
  const placeholders = { header: [businessName], body: [city, email] };
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders,
    body: JSON.stringify({
      type: 'WhatsApp',
      contactId,
      message: TEMPLATE_RAW_BODY,
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

(async () => {
  // 1. Pull eligible leads
  const { data: rows } = await supabase
    .from('outreach_events')
    .select('lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent')
    .gte('occurred_at', '2026-05-06T12:00:00Z')
    .not('metadata->>ghl_contact_id', 'is', null);

  const leadIds = [...new Set((rows || []).map(r => r.lead_id))];
  const ghlByLead = new Map();
  for (const r of rows || []) ghlByLead.set(r.lead_id, r.metadata.ghl_contact_id);

  // Already sent WA?
  const { data: waSent } = await supabase
    .from('outreach_events')
    .select('lead_id')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'whatsapp')
    .eq('event_type', 'sent');
  const waAlready = new Set((waSent || []).map(r => r.lead_id));

  // Hydrate
  const { data: leads } = await supabase
    .from('leads')
    .select('id, business_name, email_address, phone, metro_area, qualification_score')
    .in('id', leadIds);

  const eligible = (leads || [])
    .filter(l => l.phone && l.phone.match(/^\+1[2-9]\d{9}$/))
    .filter(l => l.email_address)
    .filter(l => l.metro_area)
    .filter(l => isLatinoMetro(l.metro_area))
    .filter(l => !waAlready.has(l.id))
    .map(l => ({ ...l, ghl_contact_id: ghlByLead.get(l.id) }))
    .filter(l => l.ghl_contact_id)
    .sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));

  let batch = eligible;
  if (CANARY) batch = eligible.slice(0, 1);
  else if (TOP_N) batch = eligible.slice(0, TOP_N);

  console.log(`\n=== WhatsApp send · template '${TEMPLATE_NAME}' ===`);
  console.log(`Mode:        ${DRY ? 'DRY' : CANARY ? 'CANARY (1)' : TOP_N ? `TOP ${TOP_N}` : 'ALL'}`);
  console.log(`Eligibles:   ${eligible.length} (de ${leadIds.length} contactados hoy)`);
  console.log(`A enviar:    ${batch.length}\n`);

  let sent = 0, failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const l = batch[i];
    const city = normCity(l.metro_area);

    console.log(`[${i + 1}] ${l.business_name} (${l.phone}) [${city}] · score ${l.qualification_score}`);
    console.log(`    placeholders: ${JSON.stringify({ header: [l.business_name], body: [city, l.email_address] })}`);

    if (DRY) {
      console.log(`    [DRY] preview:\n${renderPreview({ business_name: l.business_name, city, email: l.email_address }).split('\n').map(s => '      ' + s).join('\n')}`);
      sent++;
      continue;
    }

    const r = await sendWhatsApp(l.ghl_contact_id, l.business_name, city, l.email_address);
    if (r.ok) {
      console.log(`    ✓ sent — ${r.messageId} (conv ${r.conversationId})`);
      await supabase.from('outreach_events').insert({
        lead_id: l.id,
        brand_id: BRAND_ID,
        channel: 'whatsapp',
        event_type: 'sent',
        message_id: r.messageId,
        metadata: {
          template: TEMPLATE_NAME,
          template_lang: 'es_MX',
          phone: l.phone,
          ghl_contact_id: l.ghl_contact_id,
          ghl_conversation_id: r.conversationId,
          script: 'send_wa_today_batch_2026-05-06',
          rendered_body: renderPreview({ business_name: l.business_name, city, email: l.email_address }),
        },
      });
      sent++;
    } else {
      console.log(`    ✗ FAIL ${r.status}: ${r.error}`);
      await supabase.from('outreach_events').insert({
        lead_id: l.id,
        brand_id: BRAND_ID,
        channel: 'whatsapp',
        event_type: 'failed',
        metadata: { template: TEMPLATE_NAME, phone: l.phone, error: r.error, status: r.status, script: 'send_wa_today_batch_2026-05-06' },
      });
      failed++;
    }

    // Throttle 30s — conservative for "Activa: calidad pendiente" templates
    if (!DRY && i < batch.length - 1) await new Promise(r => setTimeout(r, 30000));
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Sent:   ${sent}`);
  console.log(`Failed: ${failed}`);
})().catch(err => { console.error('FATAL:', err); process.exit(2); });
