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
import { verifier } from './agents/verifier.js';
import { verifyAndRewrite } from './lib/verifierGate.js';
import { outreachDraftSchema } from './lib/schemas.js';
import { sanitizeLeadData } from './lib/sanitize.js';
import { logger } from './lib/logger.js';
import { withRetry } from './lib/resilience.js';

dotenv.config();

// ── Agentic Copilot Init ──────────────────────────────────────
const runtime = new AgentRuntime({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});
runtime.registerAgent(angela);
runtime.registerAgent(verifier);

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
  logger.info('SMTP configured', { user: SMTP_USER });
} else {
  logger.warn('No SMTP configured — using Resend or MOCK mode');
}

// ── Main export ───────────────────────────────────────────────

/**
 * Pre-renders email drafts for all leads whose magnet is COMPLETED
 * and saves the HTML to Supabase for client approval via dashboard.
 * NO emails are sent automatically — the client must approve each one.
 * @returns {{ rendered: number, skipped: number, errors: number }}
 */
export async function dispatchPendingOutreach() {
  logger.info('Searching for leads ready for email pre-render');

  if (!supabase) {
    logger.error('Supabase not configured (missing URL or Key)');
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
        metro_area,
        email_address,
        phone,
        instagram_url,
        facebook_url
      )
    `)
    .eq('lead_magnet_status', 'COMPLETED')
    // We filter by outreach_status in the DB instead of missing columns
    .or('outreach_status.is.null,outreach_status.eq.PENDING')
    .not('lead_magnets_data', 'is', null)
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error('Supabase query error', { error: error.message });
    return { rendered: 0, skipped: 0, errors: 1 };
  }

  if (!records || records.length === 0) {
    logger.info('No leads pending pre-render');
    return { rendered: 0, skipped: 0, errors: 0 };
  }

  logger.info('Leads queued for pre-render', { count: records.length });

  const stats = { rendered: 0, skipped: 0, errors: 0 };

  // ── 2. Process each lead ─────────────────────────────────
  for (const record of records) {
    const lead       = record.leads;
    const magnetData = record.lead_magnets_data;

    // Identify available outreach channels (email + alt channels: phone/IG/FB)
    const hasEmail = Boolean(lead?.email_address);
    const hasPhone = Boolean(lead?.phone);
    const hasIG    = Boolean(lead?.instagram_url);
    const hasFB    = Boolean(lead?.facebook_url);
    const hasAltChannel = hasPhone || hasIG || hasFB;

    // Skip only if the lead has NO reachable channel at all
    if (!hasEmail && !hasAltChannel) {
      logger.warn('Lead has no contact channel — SKIP', { business: lead?.business_name });
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'SKIPPED_NO_CONTACT' })
        .eq('id', record.id);
      stats.skipped++;
      continue;
    }

    // Guard: skip if no magnet data
    if (!magnetData?.magnet_type) {
      logger.warn('Invalid magnet_data — SKIP', { business: lead.business_name });
      stats.skipped++;
      continue;
    }

    try {
      // ── 2b. Opcional: Generar copy dinámico si es screenshot
      let angelaSubject = null;
      let angelaBody = null;

      if (magnetData.magnet_type === 'website_screenshot') {
        try {
          // ── Sanitize lead data BEFORE prompt injection ──
          const safeLead = sanitizeLeadData(lead);
          const prompt = `Escribe un mensaje de outreach frío para un negocio de ${safeLead.industry || 'servicios'} llamado "${safeLead.business_name || 'su negocio'}".
Contexto: Nuestra agencia (Empírika) diseñó un concepto de página web profesional gratuito para ellos (magnet: website_screenshot).
Menciona que encontraste su negocio, que te pareció genial, pero notaste que les falta presencia online — y diles que revisen el concepto de página web adjunto.
Ofrece entregarles la versión terminada 100% gratis.
Sé asertivo, profesional, pero muy humano. Usa "tú" (informal pero respetuoso).

Escribe DOS versiones:
1. Un Email frío (Línea de asunto + cuerpo, 2-3 párrafos).
2. Un mensaje de WhatsApp (Corto, directo, conversacional, impactante).

IMPORTANTE: Escribe TODO en ESPAÑOL. Devuelve SOLO un objeto JSON:
{
  "email_subject": "[Línea de asunto en español]",
  "email_body": "[Cuerpo del email con 2-3 párrafos en español]",
  "whatsapp": "[Mensaje corto de WhatsApp en español]"
}`;
          logger.info('Asking Angela for multi-channel copy', { business: lead.business_name });
          const aiResult = await runtime.run('Angela', prompt, { maxIterations: 3 });
          
          // ── Use safeParseLLMOutput with Zod validation ──
          const parseResult = AgentRuntime.safeParseLLMOutput(aiResult.response, outreachDraftSchema);

          if (parseResult.success) {
            const parsed = parseResult.data;

            // ── Verifier Gate ──────────────────────────────
            const draftPayload = {
              subject:   parsed.email_subject,
              body:      parsed.email_body,
              whatsapp:  parsed.whatsapp,
              instagram: '',
            };
            const leadContext = {
              businessName: lead.business_name,
              industry:     lead.industry || '',
              metro:        lead.metro_area || '',
              tier:         '',
            };
            const gateResult = await verifyAndRewrite(draftPayload, leadContext, runtime);

            if (gateResult.blocked) {
              console.warn(`  ⚠️  [Verifier] Blocked draft for ${lead.business_name} — low quality after retries.`);
              await supabase
                .from('campaign_enriched_data')
                .update({
                  outreach_status: 'BLOCKED_LOW_QUALITY',
                  verifier_report: gateResult.verifier_history,
                })
                .eq('id', record.id);
              stats.skipped++;
              continue;
            }

            // Use (possibly rewritten) draft
            const finalDraft = gateResult.draft;
            angelaSubject = finalDraft.subject;
            angelaBody    = finalDraft.body;
            magnetData.whatsapp_draft  = finalDraft.whatsapp;
            magnetData.verifier_report = gateResult.verifier_history;
            logger.info('Angela generated validated copy', { business: lead.business_name });
          } else {
            logger.warn('Angela output failed schema validation', { error: parseResult.error });
          }
        } catch (error) {
          logger.warn('Angela call failed — using fallback', { business: lead.business_name, error: error.message });
        }
      }

      // ── 3. Render output: email path OR phone/social path ─
      if (hasEmail) {
        // Email path — pre-render HTML, save as DRAFT
        const { subject, html, attachments } = renderMagnetEmail(magnetData, lead, { angelaSubject, angelaBody });
        logger.info('Pre-rendered email', { to: lead.email_address, business: lead.business_name, type: magnetData.magnet_type });

        const attachmentMeta = attachments.map(a => ({
          filename: a.filename,
          path: a.path,
          cid: a.cid,
        }));

        magnetData.approval_status = 'DRAFT';
        magnetData.email_draft_subject = subject;
        magnetData.email_draft_html = html;
        magnetData.email_attachments = attachmentMeta.length > 0 ? attachmentMeta : null;

        await supabase
          .from('campaign_enriched_data')
          .update({ outreach_status: 'DRAFT', lead_magnets_data: magnetData })
          .eq('id', record.id);
        await supabase
          .from('leads')
          .update({ outreach_status: 'DRAFT' })
          .eq('id', lead.id);

        logger.info('Draft saved — ready for approval', { business: lead.business_name });
      } else {
        // Phone/social path — no email to render, queue for manual outreach
        magnetData.approval_status = 'DRAFT_PHONE';
        magnetData.outreach_channels = {
          phone:     lead.phone || null,
          instagram: lead.instagram_url || null,
          facebook:  lead.facebook_url || null,
        };
        // Carry Angela's whatsapp copy (set earlier when magnet_type=website_screenshot)
        // If absent, the human team calls with their own script using magnetData context.

        await supabase
          .from('campaign_enriched_data')
          .update({ outreach_status: 'DRAFT_PHONE', lead_magnets_data: magnetData })
          .eq('id', record.id);
        await supabase
          .from('leads')
          .update({ outreach_status: 'DRAFT_PHONE' })
          .eq('id', lead.id);

        logger.info('Phone/social draft saved — call-sheet ready', { business: lead.business_name, phone: lead.phone });
      }
      stats.rendered++;

    } catch (err) {
      logger.error('Pre-render error', { business: lead.business_name, error: err.message });
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'RENDER_ERROR' })
        .eq('id', record.id);
      stats.errors++;
    }
  }

  logger.info('Dispatch summary', { rendered: stats.rendered, skipped: stats.skipped, errors: stats.errors });
  return stats;
}

// ── Unified email sender ──────────────────────────────────────

async function sendEmail({ to, subject, html, attachments = [] }) {
  const from = `"${FROM_NAME}" <${FROM_ADDRESS}>`;

  // Priority 1: Gmail SMTP — with retry
  if (smtpTransporter) {
    const info = await withRetry(
      () => smtpTransporter.sendMail({ from, to, subject, html, attachments }),
      { maxRetries: 3, baseDelayMs: 1000, label: 'SMTP-dispatch' }
    );
    return info.messageId;
  }

  // Priority 2: Resend API
  if (RESEND_API_KEY) {
    const res = await withRetry(
      () => fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'Resend-dispatch' }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data)}`);
    return data.id;
  }

  // Priority 3: Mock (development)
  logger.info('MOCK send', { to, subject });
  return `mock-${Date.now()}`;
}

// ── Verify SMTP connection on startup ─────────────────────────
export async function verifySmtpConnection() {
  if (!smtpTransporter) {
    return { ok: false, reason: 'No SMTP configured' };
  }
  try {
    await smtpTransporter.verify();
    logger.info('SMTP connection verified — ready to send');
    return { ok: true };
  } catch (err) {
    logger.error('SMTP connection error', { error: err.message });
    return { ok: false, reason: err.message };
  }
}

// ── CLI runner ───────────────────────────────────────────────
// node outreach_dispatcher.js

if (process.argv[1]?.includes('outreach_dispatcher')) {
  (async () => {
    const verify = await verifySmtpConnection();
    if (!verify.ok && SMTP_USER) {
      logger.error('SMTP verify failed', { reason: verify.reason });
    }
    const stats = await dispatchPendingOutreach();
    process.exit(stats.errors > 0 ? 1 : 0);
  })().catch(err => {
    logger.error('Fatal dispatcher error', { error: err.message });
    process.exit(1);
  });
}
