// ============================================================
// scripts/send_pending_subset_2026-05-05.js
//
// One-off sender for the 4–7 leads pending email outreach as of
// 2026-05-05, while the autonomous Helena→Manager loop is blocked
// on Gemini 429 / zod_errors.
//
// Uses the same niche-template + image-attachment renderer the
// dispatcher uses (lib/emailRenderer.js), the same SMTP transport
// (Gmail / jsanchez@empirikagroup.com), and writes to
// outreach_events + leads exactly like handlePostSendActions does.
//
// Defaults: only the 4 Apify-sourced HVAC Orlando leads (real E.164
// phones, scraped contacts). Pass --include-roofing to also send to
// the 3 Scrapling-bench Miami roofing leads — those have suspicious
// phone patterns (555-/111-/987-) so they are gated behind the flag.
//
// Usage:
//   node scripts/send_pending_subset_2026-05-05.js              # 4 HVAC
//   node scripts/send_pending_subset_2026-05-05.js --include-roofing  # 7
//   node scripts/send_pending_subset_2026-05-05.js --dry-run    # preview only
// ============================================================

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderMagnetEmail } from '../lib/emailRenderer.js';
import { logOutreachEvent } from '../tools/outreachEvents.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const INCLUDE_ROOFING = args.has('--include-roofing');

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8'; // Empírika

// ── Lead manifest ────────────────────────────────────────────
// Each entry locks: lead_id (immutable), industry, niche_folder
// (must match a key in lib/emailRenderer.js NICHE_TEMPLATES), and
// the screenshot file living under assets/landing_niches/<niche>/.
const HVAC_LEADS = [
  {
    id: '2f4dec2a-c30f-481b-92be-4400c67f7dd2',
    business_name: 'Advanced Air Conditioning',
    metro_area: 'Orlando, FL',
    email: 'info@advancedacnow.com',
    industry: 'HVAC',
    niche_folder: '10. Aire acondicionado (HVAC)',
    image_file: 'screencapture-st-ourhtmldemo-new-Aircare-2026-03-30-17_38_21.png',
  },
  {
    id: 'd5e63f01-4824-4ee0-b7b2-67010a434ca5',
    business_name: 'Clear Comfort Air Conditioning & Heating Orlando',
    metro_area: 'Orlando, FL',
    email: 'service@clearcomfortair.com',
    industry: 'HVAC',
    niche_folder: '10. Aire acondicionado (HVAC)',
    image_file: 'screencapture-hadiman-vercel-app-home4-html-2026-03-30-17_41_58.png',
  },
  {
    id: 'cb67068a-bf03-413f-a4bf-a5d7106110b3',
    business_name: 'Mechanical One of Orlando',
    metro_area: 'Orlando, FL',
    email: 'info@mechanicalone.com',
    industry: 'HVAC',
    niche_folder: '10. Aire acondicionado (HVAC)',
    image_file: 'screencapture-airsupply-html-themerex-net-2026-03-30-17_37_29.png',
  },
  {
    id: 'a6a67f8f-8cda-4671-aaf6-cc1913989e6e',
    business_name: 'Pure Air and Heating',
    metro_area: 'Orlando, FL',
    email: 'info@pureairandheating.com',
    industry: 'HVAC',
    niche_folder: '10. Aire acondicionado (HVAC)',
    image_file: 'screencapture-html-storebuild-shop-airvice-prv-airvice-index-html-2026-03-30-17_38_57.png',
  },
];

const ROOFING_LEADS = [
  {
    id: '234a321d-0a3e-4857-8048-245b4bbb6427',
    business_name: 'Del Sol Roofing Services',
    metro_area: 'Miami FL',
    email: 'luis@delsolroofing.com',
    industry: 'Roofing',
    niche_folder: '3. Techado (roofing)',
    image_file: 'screencapture-scriptfusions-mnsithub-html-reroof-main-html-index-one-page-html-2026-03-30-15_03_19.png',
  },
  {
    id: '68fb7f19-fbe5-4662-a254-2de6bd747a6a',
    business_name: 'Amador Roofing',
    metro_area: 'Miami FL',
    email: 'carlos@amadorroofing.com',
    industry: 'Roofing',
    niche_folder: '3. Techado (roofing)',
    image_file: 'screencapture-gramentheme-html-gramen-2026-03-30-15_23_50.png',
  },
  {
    id: '1775061b-2ee9-4593-8bbf-2c82c77698dd',
    business_name: 'ARC Roofing Corporation',
    metro_area: 'Miami FL',
    email: 'raul@arcroofingcorp.com',
    industry: 'Roofing',
    niche_folder: '3. Techado (roofing)',
    image_file: 'screencapture-html-rrdevs-net-ribuild-2026-03-30-15_24_46.png',
  },
];

const TARGETS = INCLUDE_ROOFING ? [...HVAC_LEADS, ...ROOFING_LEADS] : HVAC_LEADS;

// ── Supabase + SMTP setup ────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('FATAL: SUPABASE_URL and a Supabase key required in .env');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

function buildTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user, pass: pass.trim() },
    tls: { rejectUnauthorized: false },
  });
}

const transporter = buildTransporter();
const fromName = process.env.SMTP_FROM_NAME || 'José Sánchez';
const fromAddr = process.env.SMTP_USER || 'jsanchez@empirikagroup.com';
const fromField = `"${fromName}" <${fromAddr}>`;

// ── Send loop ────────────────────────────────────────────────
async function sendOne(target) {
  const imagePath = path.join(REPO_ROOT, 'assets', 'landing_niches', target.niche_folder, target.image_file);

  const magnetData = {
    magnet_type: 'website_screenshot',
    niche_folder: target.niche_folder,
    image_path: imagePath,
    image_file: target.image_file,
  };

  const lead = {
    id: target.id,
    business_name: target.business_name,
    industry: target.industry,
    email_address: target.email,
    metro_area: target.metro_area,
  };

  const { subject, html, attachments } = renderMagnetEmail(magnetData, lead);

  console.log(`\n→ ${target.business_name} <${target.email}>`);
  console.log(`  subject: ${subject}`);
  console.log(`  attachments: ${attachments.length} (${attachments[0]?.filename || 'NONE'})`);

  if (DRY_RUN) {
    console.log(`  [DRY] skipped send`);
    return { id: target.id, status: 'dry_run' };
  }
  if (!transporter) {
    console.log(`  [WARN] no SMTP transport — set SMTP_USER + SMTP_PASS in .env`);
    return { id: target.id, status: 'no_transport' };
  }

  try {
    const info = await transporter.sendMail({
      from: fromField,
      to: [target.email],
      subject,
      html,
      attachments,
    });
    console.log(`  ✓ sent — messageId=${info.messageId}`);

    // Log to outreach_events (channel: email)
    await logOutreachEvent({
      leadId: target.id,
      brandId: BRAND_ID,
      channel: 'email',
      eventType: 'sent',
      metadata: {
        from: fromAddr,
        sender_name: fromName,
        followup: false,
        niche_folder: target.niche_folder,
        image_file: target.image_file,
        has_attachment: true,
        manual_send: true,
        script: 'send_pending_subset_2026-05-05',
      },
      messageId: info.messageId,
    });

    // Mark lead as SENT
    const sentAt = new Date().toISOString();
    await supabase
      .from('leads')
      .update({ outreach_status: 'SENT', last_contact_date: sentAt })
      .eq('id', target.id);
    await supabase
      .from('leads')
      .update({ first_contact_date: sentAt })
      .eq('id', target.id)
      .is('first_contact_date', null);

    return { id: target.id, status: 'sent', messageId: info.messageId };
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    await logOutreachEvent({
      leadId: target.id,
      brandId: BRAND_ID,
      channel: 'email',
      eventType: 'failed',
      metadata: { to: target.email, error: err.message, script: 'send_pending_subset_2026-05-05' },
    }).catch(() => {});
    return { id: target.id, status: 'error', error: err.message };
  }
}

(async () => {
  console.log(`\n=== Empírika one-off send (2026-05-05) ===`);
  console.log(`Targets: ${TARGETS.length} (HVAC: ${HVAC_LEADS.length}${INCLUDE_ROOFING ? `, Roofing: ${ROOFING_LEADS.length}` : ''})`);
  console.log(`Mode:    ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`From:    ${fromField}`);
  console.log(`SMTP:    ${transporter ? 'configured' : 'NOT CONFIGURED — will skip sends'}\n`);

  const results = [];
  for (const target of TARGETS) {
    results.push(await sendOne(target));
    await new Promise(r => setTimeout(r, 800)); // throttle
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'dry_run' || r.status === 'no_transport').length;

  console.log(`\n=== Summary ===`);
  console.log(`Sent:    ${sent}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Skipped: ${skipped}`);
  process.exit(errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
