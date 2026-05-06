// ============================================================
// scripts/send_wa_cta_email_2026-05-06.js
//
// Sends a brief follow-up email to today's 2026-05-06 HVAC batch
// with a prominent "Hablemos por WhatsApp" button. The button is
// a wa.me click-to-chat link with a pre-filled Spanish message —
// when the lead clicks, their WhatsApp opens with the message
// ready to send. Once they tap "Send", they become the initiator,
// which opens a 24h free-form messaging window for José.
//
// Why: Meta paused Marketing-category templates to US (+1)
// numbers in April 2025; the pause is still active May 2026.
// All 6 outbound WA templates from earlier today were blocked
// (status='failed' in GHL Conversations). Inbound-initiated
// conversations are NOT subject to the pause — once the lead
// taps Send, José can reply with anything (text, image, link)
// for 24 hours without a template at all.
//
// Eligibility:
//   - leads from today's batch with valid email_address
//   - dedup against outreach_events where script='send_wa_cta_email_2026-05-06'
//
// Usage:
//   node scripts/send_wa_cta_email_2026-05-06.js --dry-run
//   node scripts/send_wa_cta_email_2026-05-06.js --top=N
//   node scripts/send_wa_cta_email_2026-05-06.js --all
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SCRIPT_TAG = 'send_wa_cta_email_2026-05-06';

// Empírika WhatsApp Business number (sender for the CTA destination).
const WA_NUMBER = '56922480500';
const WA_PRESET_TEXT =
  'Hola José, vi tu propuesta para mi negocio y quisiera saber más sobre la página web que diseñaron.';
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_PRESET_TEXT)}`;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const topArg = args.find(a => a.startsWith('--top='));
const TOP_N = topArg ? parseInt(topArg.split('=')[1], 10) : null;
if (!DRY_RUN && !ALL && !TOP_N) {
  console.error('Pasa --dry-run, --top=N, o --all');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = process.env.SMTP_FROM_NAME || 'José Sánchez';
const FROM_ADDR = SMTP_USER || 'jsanchez@empirikagroup.com';
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: { user: SMTP_USER, pass: (SMTP_PASS || '').trim() },
  tls: { rejectUnauthorized: false },
});

function buildEmail(businessName) {
  const subject = `${businessName} — ¿hablamos también por WhatsApp?`;
  const safeName = businessName.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #222; max-width: 600px;">
<p>Hola,</p>

<p>Hace unas horas te envié una propuesta visual de cómo se vería una página web profesional para <strong>${safeName}</strong>. Quería ofrecerte un canal más cómodo si prefieres una respuesta rápida.</p>

<p>Si te resulta más fácil, puedes escribirme directamente por WhatsApp con un solo clic — el mensaje ya viene escrito para que solo tengas que apretar enviar:</p>

<p style="text-align: center; margin: 32px 0;">
  <a href="${WA_LINK}" style="display: inline-block; background-color: #25D366; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
    💬 Hablemos por WhatsApp
  </a>
</p>

<p style="font-size: 13px; color: #666;">Si el botón no funciona, copia este enlace en tu navegador:<br/>
<a href="${WA_LINK}" style="color: #25D366;">${WA_LINK}</a></p>

<p>O si prefieres, también puedes responder este mismo correo. Como tú quieras.</p>

<p>Un saludo,<br/>
José Sánchez<br/>
<em>Empirika Group</em></p>
</div>`;
  const text = `Hola,

Hace unas horas te envié una propuesta visual de cómo se vería una página web profesional para ${businessName}. Quería ofrecerte un canal más cómodo si prefieres una respuesta rápida.

Si te resulta más fácil, puedes escribirme directamente por WhatsApp con este enlace:

${WA_LINK}

(El mensaje viene pre-escrito; solo tienes que apretar enviar.)

O si prefieres, también puedes responder este mismo correo.

Un saludo,
José Sánchez
Empirika Group`;
  return { subject, html, text };
}

(async () => {
  // 1. Find today's batch leads with email + GHL contact
  const { data: events } = await supabase
    .from('outreach_events')
    .select('lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent')
    .gte('occurred_at', '2026-05-06T12:00:00Z')
    .not('metadata->>ghl_contact_id', 'is', null);

  const leadIds = [...new Set((events || []).map(r => r.lead_id))];
  const ghlByLead = new Map((events || []).map(r => [r.lead_id, r.metadata.ghl_contact_id]));

  // Idempotency: dedup against rows already sent by this script
  const { data: alreadySent } = await supabase
    .from('outreach_events')
    .select('lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email');
  const sentByScript = new Set(
    (alreadySent || [])
      .filter(r => r.metadata?.script === SCRIPT_TAG)
      .map(r => r.lead_id),
  );

  // Hydrate leads
  const { data: leads } = await supabase
    .from('leads')
    .select('id, business_name, email_address, qualification_score, metro_area')
    .in('id', leadIds);

  const eligible = (leads || [])
    .filter(l => l.email_address)
    .filter(l => !sentByScript.has(l.id))
    .map(l => ({ ...l, ghl_contact_id: ghlByLead.get(l.id) }))
    .filter(l => l.ghl_contact_id)
    .sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));

  let batch = eligible;
  if (TOP_N) batch = eligible.slice(0, TOP_N);

  console.log(`\n=== Email + WA CTA — 2026-05-06 ===`);
  console.log(`Mode:      ${DRY_RUN ? 'DRY' : TOP_N ? `TOP ${TOP_N}` : 'ALL'}`);
  console.log(`Eligibles: ${eligible.length}`);
  console.log(`A enviar:  ${batch.length}`);
  console.log(`WA link:   ${WA_LINK.slice(0, 100)}${WA_LINK.length > 100 ? '...' : ''}`);
  console.log();

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const l = batch[i];
    const { subject, html, text } = buildEmail(l.business_name);

    console.log(`[${i + 1}/${batch.length}] ${l.business_name} <${l.email_address}> [${l.metro_area}]`);
    console.log(`    subject: ${subject}`);

    if (DRY_RUN) {
      console.log('    [DRY] skipped');
      sent++;
      continue;
    }

    try {
      const info = await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_ADDR}>`,
        to: [l.email_address],
        subject,
        html,
        text,
      });
      console.log(`    ✓ sent — ${info.messageId}`);

      await supabase.from('outreach_events').insert({
        lead_id: l.id,
        brand_id: BRAND_ID,
        channel: 'email',
        event_type: 'sent',
        message_id: info.messageId,
        metadata: {
          from: FROM_ADDR,
          sender_name: FROM_NAME,
          script: SCRIPT_TAG,
          wa_cta: true,
          wa_link: WA_LINK,
          parent_send_today: true,
          ghl_contact_id: l.ghl_contact_id,
        },
      });
      sent++;
    } catch (err) {
      console.error(`    ✗ FAIL: ${err.message}`);
      failed++;
    }

    if (!DRY_RUN && i < batch.length - 1) {
      await new Promise(r => setTimeout(r, 60000));
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Sent:   ${sent}`);
  console.log(`Failed: ${failed}`);
})().catch(err => { console.error('FATAL:', err); process.exit(2); });
