// ============================================================
// send_drafts_e2e.js — E2E Test: Send DRAFT emails + Sync to GHL
// Usage: node send_drafts_e2e.js [limit]  (default: 10)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { logger } from './lib/logger.js';

dotenv.config();

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── GHL Config ──
const GHL_KEY = 'pit-5914c096-4b40-48ae-82b5-018862f5ee8f';
const GHL_LOCATION = 'uQPxZOmT4zVlMHfOGRw2';
const GHL_PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';
const GHL_STAGE_NUEVO = '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';

// ── SMTP Setup ──
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS.trim(),
  },
  tls: { rejectUnauthorized: false },
});
const FROM = `"${process.env.SMTP_FROM_NAME || 'Julio Sanchez · Empirika'}" <${process.env.SMTP_USER}>`;

// ── GHL API helpers ──
async function ghlPost(endpoint, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GHL_KEY}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function normalizeUSPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  return '+1' + digits;
}

async function createGHLContact(lead, email) {
  return ghlPost('/contacts/', {
    firstName: lead.business_name,
    email: email,
    phone: normalizeUSPhone(lead.phone),
    locationId: GHL_LOCATION,
    tags: ['lead-automatizado', 'google-maps', 'empirika-engine', 'hunter-enriched'],
    source: 'Empirika Engine - Agentic IA',
    website: lead.website || '',
    companyName: lead.business_name,
    city: lead.metro_area || '',
  });
}

async function createGHLOpportunity(contactId, lead) {
  return ghlPost('/opportunities/', {
    pipelineId: GHL_PIPELINE_ID,
    pipelineStageId: GHL_STAGE_NUEVO,
    locationId: GHL_LOCATION,
    contactId: contactId,
    name: `${lead.business_name} — Website Request`,
    status: 'open',
    source: 'Empirika Engine',
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Main ──
(async () => {
  const LIMIT = parseInt(process.argv[2] || '10', 10);

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🚀 E2E TEST: Send Drafts + GHL Sync            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`SMTP User: ${process.env.SMTP_USER}`);
  console.log(`Batch limit: ${LIMIT}\n`);

  // Verify SMTP
  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified\n');
  } catch (err) {
    console.error('❌ SMTP FAILED:', err.message);
    process.exit(1);
  }

  // Fetch DRAFT records with lead data
  const { data: records, error } = await sb
    .from('campaign_enriched_data')
    .select(
      `id, prospect_id, lead_magnets_data,
       leads!inner (id, business_name, email_address, phone, website, industry, metro_area)`
    )
    .eq('outreach_status', 'DRAFT')
    .not('lead_magnets_data', 'is', null)
    .limit(LIMIT);

  if (error) {
    console.error('❌ Supabase error:', error.message);
    process.exit(1);
  }

  // Filter to only those with email AND email_draft_subject
  const sendable = records.filter(
    (r) =>
      r.leads?.email_address &&
      r.lead_magnets_data?.email_draft_subject
  );

  console.log(`📬 Total DRAFTs found: ${records.length}`);
  console.log(`📧 Sendable (have email + draft): ${sendable.length}\n`);

  if (sendable.length === 0) {
    console.log('⚠️  Nothing to send — all drafts may be missing email_draft_subject');
    process.exit(0);
  }

  let sent = 0,
    failed = 0,
    ghlOk = 0,
    ghlFail = 0;

  for (let i = 0; i < sendable.length; i++) {
    const record = sendable[i];
    const lead = record.leads;
    const magnetData = record.lead_magnets_data;
    const email = lead.email_address;
    const subject = magnetData.email_draft_subject;
    const html = magnetData.email_draft_html;

    console.log(`\n── [${i + 1}/${sendable.length}] ${lead.business_name} ──`);
    console.log(`  📧 To: ${email}`);
    console.log(`  📋 Subject: ${subject.substring(0, 70)}...`);

    // ── 1. SEND EMAIL ──
    try {
      const info = await transporter.sendMail({
        from: FROM,
        to: email,
        subject: subject,
        html: html,
      });

      console.log(`  ✅ EMAIL SENT! MessageId: ${info.messageId}`);

      // Update Supabase
      magnetData.real_send_message_id = info.messageId;
      magnetData.real_send_to = email;
      magnetData.real_send_at = new Date().toISOString();
      magnetData.approval_status = 'APPROVED';

      await sb
        .from('campaign_enriched_data')
        .update({
          outreach_status: 'SENT',
          email_sent_at: new Date().toISOString(),
          email_resend_id: info.messageId,
          lead_magnets_data: magnetData,
        })
        .eq('id', record.id);

      // Also update leads table
      await sb
        .from('leads')
        .update({ outreach_status: 'SENT' })
        .eq('id', lead.id);

      sent++;

      // ── 2. GHL SYNC ──
      try {
        const contactRes = await createGHLContact(lead, email);
        const contactId = contactRes?.contact?.id;
        console.log(`  📌 GHL Contact created: ${contactId}`);

        if (contactId) {
          const oppRes = await createGHLOpportunity(contactId, lead);
          console.log(
            `  📌 GHL Opportunity: ${oppRes?.opportunity?.id || 'created'}`
          );
          ghlOk++;
        }
      } catch (ghlErr) {
        console.error(
          `  ⚠️ GHL sync error: ${ghlErr.message.substring(0, 120)}`
        );
        ghlFail++;
      }
    } catch (sendErr) {
      console.error(`  ❌ SEND FAILED: ${sendErr.message}`);
      failed++;
    }

    // Throttle: 2s between emails for Gmail safety
    if (i < sendable.length - 1) await delay(2000);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  📊 E2E RESULTS                                  ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ✅ Emails sent:       ${String(sent).padStart(3)}                       ║`);
  console.log(`║  ❌ Emails failed:     ${String(failed).padStart(3)}                       ║`);
  console.log(`║  📌 GHL synced:        ${String(ghlOk).padStart(3)}                       ║`);
  console.log(`║  ⚠️  GHL failed:        ${String(ghlFail).padStart(3)}                       ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  process.exit(failed > 0 ? 1 : 0);
})();
