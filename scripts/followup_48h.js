// ============================================================
// scripts/followup_48h.js
//
// Sends a soft-bump follow-up email 48h after the first email.
// Designed to run hourly as a Render cron job. Deterministic
// copy (no LLM dependency) so it survives Gemini/NVIDIA outages.
//
// Eligibility:
//   - outreach_events.event_type='sent' AND channel='email'
//   - occurred_at <= now() - 48h
//   - NO outreach_events.event_type='followup_sent' for that lead
//   - NO outreach_events.event_type='replied' for that lead
//   - NO outreach_events.event_type='bounced' for that lead
//   - leads.outreach_status = 'SENT'
//   - brand_id = Empírika
//
// On success:
//   - Logs outreach_events (event_type='followup_sent', channel='email',
//     metadata.followup_n=1, metadata.parent_message_id=<original>)
//   - Adds a note to the GHL contact (if ghl_contact_id present)
//   - Adds tag `fu1-sent` to GHL contact
//
// Usage:
//   node scripts/followup_48h.js              # live mode (full)
//   node scripts/followup_48h.js --dry-run    # preview, no sends
//   node scripts/followup_48h.js --limit=N    # cap how many to send
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── CLI flags ────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;

const BRAND_ID = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const FU_HOURS = parseInt(process.env.FOLLOWUP_HOURS || '48', 10);
// Don't bump leads contacted longer than this — past the "fresh memory" window.
const FU_MAX_AGE_DAYS = parseInt(process.env.FU_MAX_AGE_DAYS || '14', 10);
const MAX_PER_HOUR = parseInt(process.env.FU_MAX_PER_HOUR || '30', 10);

// ── Supabase ─────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL + SUPABASE_*_KEY required');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SMTP ─────────────────────────────────────────────────────
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const FROM_NAME = process.env.SMTP_FROM_NAME || 'José Sánchez';
const FROM_ADDR = SMTP_USER || 'jsanchez@empirikagroup.com';

let transporter = null;
if (SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS.trim() },
    tls: { rejectUnauthorized: false },
  });
}

// ── GHL config ───────────────────────────────────────────────
const GHL_TOKEN = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_PRIVATE_TOKEN;
const GHL_LOC = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = GHL_TOKEN
  ? {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  : null;

// ── Follow-up copy ───────────────────────────────────────────
function buildFollowupCopy(businessName) {
  const subject = `${businessName} — quería confirmar si lo recibiste`;
  const body = `<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #222; max-width: 600px;">
<p>Hola,</p>
<p>Hace dos días te escribí a propósito de la página web profesional que diseñé pensando específicamente en ${escapeHtml(businessName)}. Quería confirmar si te llegó el correo y el adjunto con el preview del diseño.</p>
<p>No te quiero quitar tiempo — si no te interesa o ya tienes proveedor, solo respóndeme con un "no gracias" y elimino tu contacto de mi lista.</p>
<p>Si te resulta útil, basta con una palabra y te paso los siguientes pasos. La propuesta inicial no tiene costo.</p>
<p>Un saludo,<br/>José Sánchez<br/>Empírika</p>
</div>`;
  return { subject, body };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Eligibility query ────────────────────────────────────────
async function findEligibleLeads() {
  // outreach_events sent in the window: ≥ FU_HOURS but ≤ FU_MAX_AGE_DAYS ago.
  // Floor avoids spamming stale contacts; ceiling avoids missing recent ones.
  const ceilingIso = new Date(Date.now() - FU_HOURS * 3600 * 1000).toISOString();
  const floorIso = new Date(Date.now() - FU_MAX_AGE_DAYS * 86400 * 1000).toISOString();

  const { data: sentEvents, error: sentErr } = await supabase
    .from('outreach_events')
    .select('id, lead_id, message_id, occurred_at, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent')
    .lte('occurred_at', ceilingIso)
    .gte('occurred_at', floorIso)
    .order('occurred_at', { ascending: true })
    .limit(LIMIT * 3);

  if (sentErr) throw sentErr;
  if (!sentEvents?.length) return [];

  const leadIds = [...new Set(sentEvents.map(e => e.lead_id))];

  // Disqualifying events on the same lead
  const { data: blockEvents } = await supabase
    .from('outreach_events')
    .select('lead_id, event_type')
    .eq('brand_id', BRAND_ID)
    .in('lead_id', leadIds)
    .in('event_type', ['followup_sent', 'replied', 'bounced', 'unsubscribed']);

  const blocked = new Set((blockEvents || []).map(e => e.lead_id));

  // Pick first-sent event per lead, skip blocked
  const seen = new Set();
  const candidates = [];
  for (const e of sentEvents) {
    if (seen.has(e.lead_id)) continue;
    seen.add(e.lead_id);
    if (blocked.has(e.lead_id)) continue;
    candidates.push(e);
    if (candidates.length >= LIMIT) break;
  }
  if (!candidates.length) return [];

  // Hydrate with lead info
  const { data: leads } = await supabase
    .from('leads')
    .select('id, business_name, email_address, email, outreach_status')
    .in('id', candidates.map(c => c.lead_id))
    .eq('outreach_status', 'SENT');

  const byId = new Map((leads || []).map(l => [l.id, l]));

  return candidates
    .map(c => {
      const lead = byId.get(c.lead_id);
      if (!lead) return null;
      const email = lead.email_address || lead.email;
      if (!email) return null;
      return {
        leadId: lead.id,
        businessName: lead.business_name,
        email,
        originalMessageId: c.message_id,
        originalSentAt: c.occurred_at,
        ghlContactId: c.metadata?.ghl_contact_id || null,
      };
    })
    .filter(Boolean);
}

// ── Outreach event logger ────────────────────────────────────
async function logFollowupEvent(target, info) {
  const payload = {
    lead_id: target.leadId,
    brand_id: BRAND_ID,
    channel: 'email',
    event_type: 'followup_sent',
    message_id: info.messageId,
    metadata: {
      followup_n: 1,
      parent_message_id: target.originalMessageId,
      parent_sent_at: target.originalSentAt,
      from: FROM_ADDR,
      sender_name: FROM_NAME,
      script: 'followup_48h',
      ghl_contact_id: target.ghlContactId,
    },
  };
  const { error } = await supabase.from('outreach_events').insert(payload);
  if (error) console.warn(`  [WARN] log fallido lead=${target.leadId}: ${error.message}`);
}

// ── GHL sync ─────────────────────────────────────────────────
async function ghlAddNote(contactId, body) {
  if (!GHL_HEADERS || !contactId) return;
  try {
    await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: GHL_HEADERS,
      body: JSON.stringify({ body }),
    });
  } catch (e) {
    console.warn(`  [WARN] GHL note fail: ${e.message}`);
  }
}

async function ghlAddTag(contactId, tag) {
  if (!GHL_HEADERS || !contactId) return;
  try {
    await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: GHL_HEADERS,
      body: JSON.stringify({ tags: [tag] }),
    });
  } catch (e) {
    console.warn(`  [WARN] GHL tag fail: ${e.message}`);
  }
}

// ── Send loop ────────────────────────────────────────────────
async function sendOne(target) {
  const { subject, body } = buildFollowupCopy(target.businessName);
  console.log(`\n→ ${target.businessName} <${target.email}>`);
  console.log(`  subject: ${subject}`);
  console.log(`  parent: ${target.originalMessageId}`);

  if (DRY_RUN) {
    console.log('  [DRY] skipped');
    return { status: 'dry_run' };
  }
  if (!transporter) {
    console.log('  [WARN] no SMTP — skip');
    return { status: 'no_transport' };
  }

  // Threaded reply: same Subject "Re:", set In-Reply-To + References
  const headers = {};
  if (target.originalMessageId) {
    headers['In-Reply-To'] = target.originalMessageId;
    headers['References'] = target.originalMessageId;
  }

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_ADDR}>`,
      to: [target.email],
      subject,
      html: body,
      headers,
    });
    console.log(`  ✓ sent — messageId=${info.messageId}`);

    await logFollowupEvent(target, info);

    if (target.ghlContactId) {
      const noteBody = `[empirika-followup-1:2026-05-06] Follow-up automático enviado tras 48h sin respuesta.
Asunto: "${subject}"
Message-ID: ${info.messageId}
Origen: scripts/followup_48h.js (cron Render hourly)`;
      await ghlAddNote(target.ghlContactId, noteBody);
      await ghlAddTag(target.ghlContactId, 'fu1-sent');
    }

    return { status: 'sent', messageId: info.messageId };
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    await supabase.from('outreach_events').insert({
      lead_id: target.leadId,
      brand_id: BRAND_ID,
      channel: 'email',
      event_type: 'failed',
      metadata: {
        attempt: 'followup_1',
        to: target.email,
        error: err.message,
        script: 'followup_48h',
      },
    }).then(() => {}, () => {});
    return { status: 'error', error: err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== Empírika Follow-up 48h ===`);
  console.log(`Mode:   ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Window: between ${FU_HOURS}h and ${FU_MAX_AGE_DAYS}d since first send`);
  console.log(`Cap:    ${LIMIT} sends this run`);
  console.log(`SMTP:   ${transporter ? `OK (${FROM_ADDR})` : 'NOT CONFIGURED'}`);
  console.log(`GHL:    ${GHL_HEADERS ? 'OK' : 'NOT CONFIGURED — notes/tags skipped'}\n`);

  const targets = await findEligibleLeads();
  console.log(`Eligibles: ${targets.length}`);

  if (!targets.length) {
    console.log('Nada que enviar. Saliendo limpio.');
    return;
  }

  // Throttle: respetar MAX_PER_HOUR
  const throttleMs = Math.ceil(3600_000 / Math.max(1, MAX_PER_HOUR));
  const results = [];
  for (const t of targets) {
    results.push(await sendOne(t));
    if (!DRY_RUN) await new Promise(r => setTimeout(r, throttleMs));
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.length - sent - errors;

  console.log(`\n=== Resumen ===`);
  console.log(`Sent:    ${sent}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Skipped: ${skipped}`);

  process.exit(errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
