// ============================================================
// outreach_dispatcher.js — Autonomous Email Outreach Dispatcher
// Primary transport: Gmail SMTP
// Fallback transport: Resend API (if RESEND_API_KEY is set)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import nodemailer     from 'nodemailer';
import dotenv         from 'dotenv';
import { renderMagnetEmail } from './lib/emailRenderer.js';
import { AgentRuntime } from './lib/AgentRuntime.js';
import { angela } from './agents/angela.js';

dotenv.config();

// ── Agentic Copilot Init ──────────────────────────────────────
const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});
runtime.registerAgent(angela);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ── Transport selection ───────────────────────────────────────
const SMTP_USER    = process.env.SMTP_USER;     // User's SMTP Email
const SMTP_PASS    = process.env.SMTP_PASS;     // app password (spaces OK for nodemailer)
const SMTP_HOST    = process.env.SMTP_HOST    || 'smtp.gmail.com';
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587', 10);
const FROM_NAME    = process.env.SMTP_FROM_NAME || 'Ángela · Agency Fleet';
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
      rejectUnauthorized: false, // Gmail app password
    },
  });
  console.log(`📧 [OutreachDispatcher] SMTP configurado: ${SMTP_USER}`);
} else {
  console.log('⚠️  [OutreachDispatcher] Sin SMTP — usando Resend o modo MOCK.');
}

// ── Main export ───────────────────────────────────────────────

/**
 * Pre-renders email drafts for all leads whose magnet is COMPLETED
 * and saves the HTML to Supabase for client approval via dashboard.
 * NO emails are sent automatically — the client must approve each one.
 * @returns {{ rendered: number, skipped: number, errors: number }}
 */
export async function dispatchPendingOutreach() {
  console.log('\n📬 [OutreachDispatcher] Buscando leads listos para pre-render de correo...');

  if (!supabase) {
    console.error('❌ [OutreachDispatcher] Supabase no está configurado (falta URL o Key).');
    return { rendered: 0, skipped: 0, errors: 1 };
  }

  // ── 1. Fetch eligible records (COMPLETED magnets, still DRAFT) ──
  const { data: records, error } = await supabase
    .from('campaign_enriched_data')
    .select(`
      id,
      prospect_id,
      lead_magnets_data,
      leads!inner (
        id,
        business_name,
        industry,
        email_address
      )
    `)
    .eq('lead_magnet_status', 'COMPLETED')
    // We filter by outreach_status in the DB instead of missing columns
    .or('outreach_status.is.null,outreach_status.eq.PENDING')
    .not('lead_magnets_data', 'is', null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('❌ [OutreachDispatcher] Error consultando Supabase:', error.message);
    return { rendered: 0, skipped: 0, errors: 1 };
  }

  if (!records || records.length === 0) {
    console.log('✅ [OutreachDispatcher] No hay leads pendientes de pre-render.');
    return { rendered: 0, skipped: 0, errors: 0 };
  }

  console.log(`📋 [OutreachDispatcher] ${records.length} lead(s) para pre-renderizar.\n`);

  const stats = { rendered: 0, skipped: 0, errors: 0 };

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
      // ── 2b. Opcional: Generar copy dinámico si es screenshot
      let angelaSubject = null;
      let angelaBody = null;

      if (magnetData.magnet_type === 'website_screenshot') {
        try {
          const prompt = `Redacta un mensaje de contacto (outreach) para un negocio de ${lead.industry || 'servicios generales'} llamado "${lead.business_name || 'tu negocio'}".
Quiero que apliques tu tono empático, "Spanglish" o español cálido.
Contexto: Nuestra agencia (Empírika) les diseñó un concepto de página web gratis y profesional (magnet: website_screenshot).
Menciona que los buscaste, te pareció un buen negocio, pero que notaste que les falta presencia en línea, y diles que miren la foto del concepto web adjunto.
Ofrece enviársela 100% terminada sin costo.
Sé asertivo, profesional pero muy humano.

Crea dos versiones:
1. Un Email en frío (Asunto y cuerpo).
2. Un mensaje de WhatsApp (Corto, directo, conversacional e impactante).

DEVUELVE ÚNICAMENTE un JSON con este formato exacto:
{
  "email_subject": "[Asunto del correo]",
  "email_body": "[Cuerpo del correo con 2 o 3 párrafos]",
  "whatsapp": "[Mensaje de WhatsApp corto e impactante]"
}`;
          console.log(`  🤖 Pidiendo a Ángela redactar multi-contacto para ${lead.business_name}...`);
          const aiResult = await runtime.run('Angela', prompt, { maxIterations: 3 });
          
          let parsed;
          try {
            let jsonStr = aiResult.response.replace(/^\`\`\`json/m, '').replace(/^\`\`\`/m, '').trim();
            parsed = JSON.parse(jsonStr);
          } catch (err) {
            console.warn(`  ⚠️ No se pudo parsear el JSON de Ángela. Dando timeout...`);
          }

          if (parsed) {
            if (parsed.email_subject) angelaSubject = parsed.email_subject;
            if (parsed.email_body) angelaBody = parsed.email_body;
            if (parsed.whatsapp) magnetData.whatsapp_draft = parsed.whatsapp;
            console.log(`  ✨ Ángela generó copy personalizado de Email y WhatsApp!`);
          }
        } catch (error) {
          console.warn(`  ⚠️ Falló la llamada a Ángela para ${lead.business_name}, usando fallback template:`, error.message);
        }
      }

      // ── 3. Render HTML email (pre-render only, no send) ───
      const { subject, html, attachments } = renderMagnetEmail(magnetData, lead, { angelaSubject, angelaBody });

      console.log(`  📝 Pre-rendered → ${lead.email_address}  (${lead.business_name}) [${magnetData.magnet_type}]`);

      // ── 4. Save draft to Supabase for client preview ──────
      const attachmentMeta = attachments.map(a => ({
        filename: a.filename,
        path: a.path,
        cid: a.cid,
      }));

      magnetData.approval_status = 'DRAFT';
      magnetData.email_draft_subject = subject;
      magnetData.email_draft_html = html;
      magnetData.email_attachments = attachmentMeta.length > 0 ? attachmentMeta : null;

      // Update the campaign table
      await supabase
        .from('campaign_enriched_data')
        .update({
          outreach_status: 'DRAFT',
          lead_magnets_data: magnetData
        })
        .eq('id', record.id);

      // Update the leads table to reflect status in the main dashboard UI
      await supabase
        .from('leads')
        .update({
          outreach_status: 'DRAFT'
        })
        .eq('id', lead.id);

      console.log(`  ✅  Draft guardado → ${lead.business_name} (listo para aprobación)`);
      stats.rendered++;

    } catch (err) {
      console.error(`  ❌  Error pre-renderizando ${lead.business_name}:`, err.message);
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'RENDER_ERROR' })
        .eq('id', record.id);
      stats.errors++;
    }
  }

  console.log(`\n📊 [OutreachDispatcher] Resumen: ${stats.rendered} pre-rendered | ${stats.skipped} saltados | ${stats.errors} errores\n`);
  return stats;
}

// ── Unified email sender ──────────────────────────────────────

async function sendEmail({ to, subject, html, attachments = [] }) {
  const from = `"${FROM_NAME}" <${FROM_ADDRESS}>`;

  // Priority 1: Gmail SMTP
  if (smtpTransporter) {
    const info = await smtpTransporter.sendMail({ from, to, subject, html, attachments });
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
