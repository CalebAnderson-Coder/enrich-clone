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
        email_address
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

    // Guard: skip if no email address
    if (!lead?.email_address) {
      logger.warn('Lead missing email_address — SKIP', { business: lead?.business_name });
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'SKIPPED_NO_EMAIL' })
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
          const prompt = `Write a cold outreach message for a ${safeLead.industry || 'service'} business called "${safeLead.business_name || 'their business'}".
Context: Our agency (Empírika) designed a free, professional website concept for them (magnet: website_screenshot).
Mention that you found their business, thought it was great, but noticed they're missing an online presence — and tell them to check the attached website concept.
Offer to deliver the finished version 100% free.
Be assertive, professional, but very human.

Write TWO versions:
1. A cold Email (Subject line + body, 2-3 paragraphs).
2. A WhatsApp message (Short, direct, conversational, impactful).

IMPORTANT: Write EVERYTHING in ENGLISH. Return ONLY a JSON object:
{
  "email_subject": "[Subject line]",
  "email_body": "[Email body with 2-3 paragraphs]",
  "whatsapp": "[Short WhatsApp message]"
}`;
          logger.info('Asking Angela for multi-channel copy', { business: lead.business_name });
          const aiResult = await runtime.run('Angela', prompt, { maxIterations: 3 });
          
          // ── Use safeParseLLMOutput with Zod validation ──
          const parseResult = AgentRuntime.safeParseLLMOutput(aiResult.response, outreachDraftSchema);

          if (parseResult.success) {
            const parsed = parseResult.data;
            angelaSubject = parsed.email_subject;
            angelaBody = parsed.email_body;
            magnetData.whatsapp_draft = parsed.whatsapp;
            logger.info('Angela generated validated copy', { business: lead.business_name });
          } else {
            logger.warn('Angela output failed schema validation', { error: parseResult.error });
          }
        } catch (error) {
          logger.warn('Angela call failed — using fallback', { business: lead.business_name, error: error.message });
        }
      }

      // ── 3. Render HTML email (pre-render only, no send) ───
      const { subject, html, attachments } = renderMagnetEmail(magnetData, lead, { angelaSubject, angelaBody });

      logger.info('Pre-rendered email', { to: lead.email_address, business: lead.business_name, type: magnetData.magnet_type });

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

      logger.info('Draft saved — ready for approval', { business: lead.business_name });
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
