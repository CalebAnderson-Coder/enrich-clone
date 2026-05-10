// Send SMS outreach via Twilio to all SENT leads with phone+email+metro_area.
// - Renders Spanish template per lead, replacing {BUSINESS_NAME}, {CITY}, {EMAIL}.
// - Picks FROM number by lead state (TX → Ballinger TX number, FL → rotates CA/PA).
// - Idempotent: skips leads already stamped sms_sent_at in lead_magnets_data.
//
// Usage:
//   node scripts/send_sms_outreach.js --dry       # preview rendered messages, no send
//   node scripts/send_sms_outreach.js --canary    # send to FIRST 1 only (smoke)
//   node scripts/send_sms_outreach.js --all       # send all
//
// Resultado: persiste sms_sent_at, sms_message_sid, sms_from_used, sms_city_used
// (o sms_error + sms_error_code) en lead_magnets_data.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { sendSMS } from './twilio.js';

const SUPA = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

// FROM number pool by state. TX has local match; FL leads rotate the other 2.
const FROM_BY_STATE = {
  TX: ['+13252080289'],                    // Ballinger, TX
  FL: ['+12137211375', '+15707019535'],    // CA + PA (no FL number available)
};
const FROM_FALLBACK = ['+12137211375', '+15707019535', '+13252080289'];

const args = new Set(process.argv.slice(2));
const DRY     = args.has('--dry');
const CANARY  = args.has('--canary');
const RUN_ALL = args.has('--all');
if (!DRY && !CANARY && !RUN_ALL) {
  console.error('Specify --dry, --canary, or --all');
  process.exit(1);
}

function renderTemplate({ business_name, city, email }) {
  return `Hola, equipo de ${business_name}. Soy José Sánchez de Empirika Group. Nos llamó la atención su trabajo en ${city}. Enviamos una propuesta visual de su web a ${email}. ¿Agendamos una llamada breve? STOP para salir.`;
}

function parseStateFromMetro(metro) {
  if (!metro) return null;
  const parts = String(metro).split(',').map(s => s.trim());
  // Try last part (common GMaps format "City, ST, US").
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].toUpperCase();
    if (/^[A-Z]{2}$/.test(p)) return p;
  }
  // City-name heuristics fallback.
  const first = (parts[0] || '').toLowerCase();
  if (['houston','dallas','san antonio','austin'].includes(first)) return 'TX';
  if (['miami','orlando','tampa','jacksonville'].includes(first)) return 'FL';
  return null;
}

function normCity(metro) {
  if (!metro) return 'su zona';
  return String(metro).split(',')[0].trim() || 'su zona';
}

let rrIndex = 0;
function pickFrom(state) {
  const pool = FROM_BY_STATE[state] || FROM_FALLBACK;
  const from = pool[rrIndex % pool.length];
  rrIndex++;
  return from;
}

async function fetchLeads() {
  const { data, error } = await SUPA
    .from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data, leads!inner(id, business_name, email_address, phone, metro_area)')
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'SENT');
  if (error) throw error;

  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const lead = row.leads;
    if (!lead || seen.has(lead.id)) continue;
    if (!lead.phone || !lead.email_address || !lead.metro_area) continue;
    if ((row.lead_magnets_data || {}).sms_sent_at) continue; // already sent
    seen.add(lead.id);
    out.push(row);
  }
  return out;
}

function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (String(raw).trim().startsWith('+')) return String(raw).trim();
  return null;
}

async function main() {
  const todo = await fetchLeads();
  console.log(`[start] ${todo.length} leads pending SMS (mode: ${DRY ? 'DRY' : CANARY ? 'CANARY-1' : 'ALL'})`);

  const batch = CANARY ? todo.slice(0, 1) : todo;
  let sent = 0, failed = 0, skipped = 0;

  for (const row of batch) {
    const lead = row.leads;
    const city = normCity(lead.metro_area);
    const state = parseStateFromMetro(lead.metro_area);
    const to = toE164(lead.phone);
    const from = pickFrom(state);
    const message = renderTemplate({
      business_name: lead.business_name,
      city,
      email: lead.email_address,
    });

    if (!to) {
      console.log(`SKIP bad-phone: ${lead.business_name} (${lead.phone})`);
      skipped++;
      continue;
    }

    if (DRY) {
      console.log('\n──────────────────────────────────');
      console.log(`TO: ${lead.business_name} (${to}) [${city}/${state || '??'}] FROM ${from}`);
      console.log(`(${message.length} chars, ~${Math.ceil(message.length / 160)} segments)`);
      console.log(message);
      sent++;
      continue;
    }

    try {
      const res = await sendSMS({ to, body: message, from });
      const md = { ...(row.lead_magnets_data || {}) };
      if (res.messageSid) {
        md.sms_sent_at     = new Date().toISOString();
        md.sms_message_sid = res.messageSid;
        md.sms_status      = res.status;
        md.sms_from_used   = from;
        md.sms_city_used   = city;
        md.sms_state_used  = state;
        sent++;
        console.log(`✓ ${lead.business_name} [${city}/${state}] ${from}→${to} sid=${res.messageSid} status=${res.status}`);
      } else {
        md.sms_error      = res.error;
        md.sms_error_code = res.code || null;
        md.sms_from_tried = from;
        failed++;
        console.log(`✗ ${lead.business_name}: ${res.error}${res.code ? ' code=' + res.code : ''}`);
      }
      await SUPA.from('campaign_enriched_data').update({ lead_magnets_data: md }).eq('id', row.id);
    } catch (e) {
      failed++;
      console.log(`! ${lead.business_name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n[done] sent=${sent} failed=${failed} skipped=${skipped} of ${batch.length}`);
  if (CANARY && todo.length > 1) console.log(`Canary OK → re-run with --all to send remaining ${todo.length - 1}.`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
