// send_and_sync.cjs — REAL email send via SMTP + GHL sync
// This script:
// 1. Sends actual emails via Gmail SMTP (Jsanchez@empirikagroup.com)
// 2. Creates contact + opportunity in GHL for each sent lead
// 3. Updates Supabase with real send status
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const GHL_KEY = 'pit-5914c096-4b40-48ae-82b5-018862f5ee8f';
const GHL_LOCATION = 'uQPxZOmT4zVlMHfOGRw2';
// Pipeline: "COLD LEADS | GOOGLE MY BUSINESS"
const GHL_PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';
// Stage: "NUEVO" (first stage)
const GHL_STAGE_NUEVO = '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';

// ── SMTP Setup ──
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS.trim()
  },
  tls: { rejectUnauthorized: false }
});

const FROM = `"${process.env.SMTP_FROM_NAME || 'Julio Sanchez · Empirika'}" <${process.env.SMTP_USER}>`;

// ── GHL API helpers ──
async function ghlPost(endpoint, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Phone normalization: GHL requires +1 prefix for US numbers ──
function normalizeUSPhone(raw) {
  if (!raw) return '';
  // Strip everything non-digit
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // If already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  // Standard 10-digit US number
  if (digits.length === 10) return '+1' + digits;
  // If someone already passed +1... just return cleaned
  if (raw.startsWith('+1')) return '+1' + digits.replace(/^1/, '');
  // Fallback: return with +1 prefix
  return '+1' + digits;
}

async function createGHLContact(prospect, email) {
  return ghlPost('/contacts/', {
    firstName: prospect.business_name,
    email: email,
    phone: normalizeUSPhone(prospect.phone),
    locationId: GHL_LOCATION,
    tags: ['lead-automatizado', 'google-maps', 'empirika-engine'],
    source: 'Empirika Engine - Agentic IA',
    website: prospect.website || '',
    companyName: prospect.business_name,
    city: prospect.metro_area || ''
  });
}

async function createGHLOpportunity(contactId, prospect) {
  return ghlPost('/opportunities/', {
    pipelineId: GHL_PIPELINE_ID,
    pipelineStageId: GHL_STAGE_NUEVO,
    locationId: GHL_LOCATION,
    contactId: contactId,
    name: `${prospect.business_name} — Website Request`,
    status: 'open',
    source: 'Empirika Engine'
  });
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──
(async () => {
  console.log('🚀 REAL EMAIL SEND + GHL SYNC\n');
  console.log(`SMTP User: ${process.env.SMTP_USER}`);

  // Verify SMTP
  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified\n');
  } catch (err) {
    console.error('❌ SMTP FAILED:', err.message);
    console.error('\n⛔ CANNOT PROCEED — SMTP is not working. Fix credentials first.');
    process.exit(1);
  }

  // Get prospects + campaign data
  const { data: prospects } = await sb.from('prospects').select('*');
  const { data: campaigns } = await sb.from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data, outreach_status');

  console.log(`Prospects: ${prospects.length}`);
  console.log(`Campaign records: ${campaigns.length}\n`);

  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    const email = p.raw_data?.extracted_email;
    const campaign = campaigns.find(c => c.prospect_id === p.id);

    console.log(`\n[${i+1}/${prospects.length}] ${p.business_name}`);

    if (!email) {
      console.log('  ❌ No email — SKIP');
      skipped++;
      continue;
    }

    if (!campaign) {
      console.log('  ❌ No campaign record — SKIP');
      skipped++;
      continue;
    }

    // Get Angela's email copy
    const angelaSubject = campaign.lead_magnets_data?.angela_email_subject;
    const angelaBody = campaign.lead_magnets_data?.angela_email_body;

    if (!angelaSubject || !angelaBody) {
      console.log('  ❌ No Angela copy — SKIP');
      skipped++;
      continue;
    }

    // Build HTML body
    const htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${angelaBody.split('\n').map(line => `<p style="margin: 8px 0; line-height: 1.6; color: #333;">${line}</p>`).join('')}
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #999;">Empirika Group — Digital Marketing Agency</p>
    </div>`;

    console.log(`  📧 To: ${email}`);
    console.log(`  📋 Subject: ${angelaSubject.substring(0, 60)}...`);

    // SEND THE EMAIL
    try {
      const info = await transporter.sendMail({
        from: FROM,
        to: email,
        subject: angelaSubject,
        html: htmlBody
      });

      console.log(`  ✅ SENT! MessageId: ${info.messageId}`);

      // Update Supabase with REAL send data
      const magnetData = { ...campaign.lead_magnets_data };
      magnetData.real_send_message_id = info.messageId;
      magnetData.real_send_to = email;
      magnetData.real_send_at = new Date().toISOString();

      await sb.from('campaign_enriched_data').update({
        outreach_status: 'SENT',
        email_sent_at: new Date().toISOString(),
        email_resend_id: info.messageId,
        lead_magnets_data: magnetData
      }).eq('id', campaign.id);

      // CREATE IN GHL
      try {
        const contactRes = await createGHLContact(p, email);
        const contactId = contactRes?.contact?.id;
        console.log(`  📌 GHL Contact: ${contactId}`);

        if (contactId) {
          const oppRes = await createGHLOpportunity(contactId, p);
          console.log(`  📌 GHL Opportunity: ${oppRes?.opportunity?.id || 'created'}`);
        }
      } catch (ghlErr) {
        console.error(`  ⚠️ GHL sync error: ${ghlErr.message.substring(0, 100)}`);
      }

      sent++;
    } catch (sendErr) {
      console.error(`  ❌ SEND FAILED: ${sendErr.message}`);
      failed++;
    }

    // Throttle: 2s between emails to be safe with Gmail
    await delay(2000);
  }

  console.log('\n========================================');
  console.log('📊 FINAL RESULTS');
  console.log('========================================');
  console.log(`✅ Sent:    ${sent}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📊 Total:   ${prospects.length}`);
  console.log('========================================\n');
})();
