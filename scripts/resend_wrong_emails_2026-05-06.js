// ============================================================
// scripts/resend_wrong_emails_2026-05-06.js
//
// Re-sends the HVAC pitch to the 5 leads where the verifier proved
// info@<domain> was wrong and surfaced a real published address.
// Updates leads.email_address to the correct value, sends, logs
// a new outreach_events row (event_type='sent', email_verified=true,
// resend_correction=true) and drops a [empirika-correction:v1] note
// on the GHL contact.
// ============================================================

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { renderMagnetEmail } from '../lib/emailRenderer.js';
import { logOutreachEvent } from '../tools/outreachEvents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const NICHE_FOLDER = '10. Aire acondicionado (HVAC)';
const SCREENSHOTS = [
  'screencapture-st-ourhtmldemo-new-Aircare-2026-03-30-17_38_21.png',
  'screencapture-hadiman-vercel-app-home4-html-2026-03-30-17_41_58.png',
  'screencapture-airsupply-html-themerex-net-2026-03-30-17_37_29.png',
  'screencapture-html-storebuild-shop-airvice-prv-airvice-index-html-2026-03-30-17_38_57.png',
];

// Manifest from re-verify run 2026-05-06: leadId → correctEmail
const CORRECTIONS = [
  { leadId: '4473f6d6-2a89-4994-9166-517371c6c482', correctEmail: 'jrodriguez@master-cooling.com', ghlContactId: 'p1ddZ3dw7fTKbON8PHD4' },
  { leadId: 'f48d0abe-d3f0-4c12-8d95-ec6191c8f8ee', correctEmail: 'arian@allfloridaairandheat.com',  ghlContactId: 'Xo34Nd3yp99UXSsFGyxf' },
  { leadId: '1178a947-2c2e-48dd-ad7d-0a329cf3af7b', correctEmail: 'usa@thehunterair.com',            ghlContactId: 'oOKzcPxaQUszJ9tTvNdl' },
  { leadId: '146adfd7-be4a-479a-82ea-d018428f79f5', correctEmail: 'office@vista-mechanical.com',     ghlContactId: 'cAX9vBt9yeGzTOatr1w7' },
  { leadId: 'bf0b6a38-e71a-4d06-8b5b-942cd8cbda3a', correctEmail: 'admin@hirechillybilly.com',       ghlContactId: 'Ts4yTT7oJLmpxl9WS93b' },
];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const FROM_NAME = process.env.SMTP_FROM_NAME || 'José Sánchez';
const FROM_ADDR = process.env.SMTP_USER || 'jsanchez@empirikagroup.com';
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS || '').trim() },
  tls: { rejectUnauthorized: false },
});

const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const GHL_HEADERS = GHL_TOKEN ? {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
  Accept: 'application/json',
} : null;

async function ghlAddNote(contactId, body) {
  if (!GHL_HEADERS || !contactId) return;
  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ body }),
  }).catch(() => {});
}

(async () => {
  console.log(`\n=== Resend a 5 WRONG sends (correo correcto) — 2026-05-06 ===\n`);

  for (let i = 0; i < CORRECTIONS.length; i++) {
    const c = CORRECTIONS[i];
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', c.leadId)
      .single();
    if (!lead) {
      console.error(`  ✗ ${c.leadId} no encontrado en DB`);
      continue;
    }

    const screenshot = SCREENSHOTS[i % SCREENSHOTS.length];
    const imagePath = path.join(REPO_ROOT, 'assets', 'landing_niches', NICHE_FOLDER, screenshot);

    const { subject, html, attachments } = renderMagnetEmail(
      {
        magnet_type: 'website_screenshot',
        niche_folder: NICHE_FOLDER,
        image_path: imagePath,
        image_file: screenshot,
      },
      {
        business_name: lead.business_name,
        industry: 'HVAC',
        email_address: c.correctEmail,
        metro_area: lead.metro_area,
        id: lead.id,
      },
    );

    console.log(`[${i + 1}] ${lead.business_name}`);
    console.log(`    de: ${lead.email_address} → a: ${c.correctEmail}`);

    try {
      const info = await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_ADDR}>`,
        to: [c.correctEmail],
        subject,
        html,
        attachments,
      });
      console.log(`    ✓ sent — ${info.messageId}`);

      // Update lead.email_address to the correct one
      await supabase.from('leads').update({
        email_address: c.correctEmail,
        last_contact_date: new Date().toISOString(),
      }).eq('id', lead.id);

      // Log new outreach_event with email_verified + resend_correction flags
      await logOutreachEvent({
        leadId: lead.id,
        brandId: BRAND_ID,
        channel: 'email',
        eventType: 'sent',
        metadata: {
          from: FROM_ADDR,
          sender_name: FROM_NAME,
          niche_folder: NICHE_FOLDER,
          image_file: screenshot,
          has_attachment: true,
          manual_send: true,
          script: 'resend_wrong_emails_2026-05-06',
          email_verified: true,
          resend_correction: true,
          previous_email: lead.email_address,
          ghl_contact_id: c.ghlContactId,
        },
        messageId: info.messageId,
      });

      // GHL note
      await ghlAddNote(c.ghlContactId, `[empirika-correction:v1] Re-envío a email correcto.
El primer envío fue a ${lead.email_address} (probable bounce).
Este envío va a ${c.correctEmail} (extraído del sitio web del prospect).
Asunto: "${subject}"
Message-ID: ${info.messageId}
Fecha: ${new Date().toISOString()}`);

    } catch (err) {
      console.error(`    ✗ FAILED: ${err.message}`);
      await supabase.from('outreach_events').insert({
        lead_id: lead.id,
        brand_id: BRAND_ID,
        channel: 'email',
        event_type: 'failed',
        metadata: { to: c.correctEmail, error: err.message, script: 'resend_wrong_emails_2026-05-06', resend_correction: true },
      });
    }

    // Throttle
    if (i < CORRECTIONS.length - 1) await new Promise(r => setTimeout(r, 30000));
  }

  console.log(`\n=== Resumen resend ===`);
  console.log(`Enviados: ${CORRECTIONS.length}`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
