// ============================================================
// outreach_dispatcher.js — Autonomous Email Outreach Dispatcher
// Primary transport: Gmail SMTP (Jsanchez@empirikagroup.com)
// Fallback transport: Resend API (if RESEND_API_KEY is set)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import nodemailer     from 'nodemailer';
import dotenv         from 'dotenv';
import { renderMagnetEmail } from './lib/emailRenderer.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ── Transport selection ───────────────────────────────────────
const SMTP_USER    = process.env.SMTP_USER;     // Jsanchez@empirikagroup.com
const SMTP_PASS    = process.env.SMTP_PASS;     // app password (spaces OK for nodemailer)
const SMTP_HOST    = process.env.SMTP_HOST    || 'smtp.gmail.com';
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587', 10);
const FROM_NAME    = process.env.SMTP_FROM_NAME || 'Ángela · Empírika Digital';
const FROM_ADDRESS = SMTP_USER || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const BATCH_LIMIT     = parseInt(process.env.OUTREACH_BATCH_LIMIT || '10', 10);

// ── Build Nodemailer transporter (Gmail SMTP) ─────────────────
let smtpTransporter = null;
if (SMTP_USER && SMTP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,          // STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS.trim(),
    },
    tls: {
      rejectUnauthorized: false, // EMPIRIKA Gmail app password
    },
  });
  console.log(`📧 [OutreachDispatcher] SMTP configurado: ${SMTP_USER}`);
} else {
  console.log('⚠️  [OutreachDispatcher] Sin SMTP — usando Resend o modo MOCK.');
}

// ── Main export ───────────────────────────────────────────────

/**
 * Dispatches personalized emails to all leads whose magnet is
 * COMPLETED but outreach is still PENDING.
 * @returns {{ sent: number, skipped: number, errors: number }}
 */
export async function dispatchPendingOutreach() {
  console.log('\n📬 [OutreachDispatcher] Buscando leads listos para outreach...');

  // ── 1. Fetch eligible records ─────────────────────────────
  const { data: records, error } = await supabase
    .from('campaign_enriched_data')
    .select(`
      id,
      prospect_id,
      lead_magnets_data,
      leads!inner (
        business_name,
        email_address
      )
    `)
    .eq('lead_magnet_status', 'COMPLETED')
    .eq('outreach_status', 'PENDING')
    .not('lead_magnets_data', 'is', null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('❌ [OutreachDispatcher] Error consultando Supabase:', error.message);
    return { sent: 0, skipped: 0, errors: 1 };
  }

  if (!records || records.length === 0) {
    console.log('✅ [OutreachDispatcher] No hay leads pendientes de outreach.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  console.log(`📋 [OutreachDispatcher] ${records.length} lead(s) en cola.\n`);

  const stats = { sent: 0, skipped: 0, errors: 0 };

  // ── 2. Process each lead ─────────────────────────────────
  for (const record of records) {
    const lead       = record.leads;
    const magnetData = record.lead_magnets_data;

    // Guard: skip if no email address
    if (!lead?.email_address) {
      console.warn(`  ⚠️  Sin email_address: ${lead?.business_name} → SKIP`);
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'SKIPPED_NO_EMAIL' })
        .eq('id', record.id);
      stats.skipped++;
      continue;
    }

    // Guard: skip if no magnet data
    if (!magnetData?.magnet_type) {
      console.warn(`  ⚠️  magnet_data inválido: ${lead.business_name} → SKIP`);
      stats.skipped++;
      continue;
    }

    try {
      // ── 3. Render HTML email ──────────────────────────────
      const { subject, html } = renderMagnetEmail(magnetData, lead);

      console.log(`  ✉️  → ${lead.email_address}  (${lead.business_name}) [${magnetData.magnet_type}]`);

      // ── 4. Send ───────────────────────────────────────────
      const emailId = await sendEmail({ to: lead.email_address, subject, html });

      // ── 5. Mark as SENT ───────────────────────────────────
      await supabase
        .from('campaign_enriched_data')
        .update({
          outreach_status: 'SENT',
          email_sent_at:   new Date().toISOString(),
          email_resend_id: emailId || null,
        })
        .eq('id', record.id);

      console.log(`  ✅  Enviado! ID: ${emailId} → ${lead.business_name}`);
      stats.sent++;

    } catch (err) {
      console.error(`  ❌  Error enviando a ${lead.business_name}:`, err.message);
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'ERROR' })
        .eq('id', record.id);
      stats.errors++;
    }
  }

  console.log(`\n📊 [OutreachDispatcher] Resumen: ${stats.sent} enviados | ${stats.skipped} saltados | ${stats.errors} errores\n`);
  return stats;
}

// ── Unified email sender ──────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const from = `"${FROM_NAME}" <${FROM_ADDRESS}>`;

  // Priority 1: Gmail SMTP (José Sánchez)
  if (smtpTransporter) {
    const info = await smtpTransporter.sendMail({ from, to, subject, html });
    return info.messageId;
  }

  // Priority 2: Resend API
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data)}`);
    return data.id;
  }

  // Priority 3: Mock (development)
  console.log(`    📧 [MOCK] Would send to ${to}: "${subject}"`);
  return `mock-${Date.now()}`;
}

// ── Verify SMTP connection on startup ─────────────────────────
export async function verifySmtpConnection() {
  if (!smtpTransporter) {
    return { ok: false, reason: 'No SMTP configured' };
  }
  try {
    await smtpTransporter.verify();
    console.log('✅ [SMTP] Conexión Gmail verificada — listo para enviar.');
    return { ok: true };
  } catch (err) {
    console.error('❌ [SMTP] Error de conexión:', err.message);
    return { ok: false, reason: err.message };
  }
}

// ── CLI runner ───────────────────────────────────────────────
// node outreach_dispatcher.js

if (process.argv[1].includes('outreach_dispatcher')) {
  (async () => {
    const verify = await verifySmtpConnection();
    if (!verify.ok && SMTP_USER) {
      console.error('SMTP verify failed:', verify.reason);
    }
    const stats = await dispatchPendingOutreach();
    process.exit(stats.errors > 0 ? 1 : 0);
  })().catch(err => {
    console.error('💥 Fatal:', err);
    process.exit(1);
  });
}
