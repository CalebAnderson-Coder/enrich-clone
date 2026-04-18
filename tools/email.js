// ============================================================
// tools/email.js — Email sending tools via Gmail SMTP (José)
// Primary:  Gmail SMTP  →  Jsanchez@empirikagroup.com
// Fallback: Resend API  →  RESEND_API_KEY
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { sendEmailInputSchema, sendBatchEmailsInputSchema } from '../lib/schemas.js';
import { withRetry } from '../lib/resilience.js';
import { logger } from '../lib/logger.js';
import { logOutreachEvent, LEARNING_ENABLED } from './outreachEvents.js';
import dotenv from 'dotenv';
dotenv.config();

// ── Pixel injection (learning-loop open tracking) ───────────
// Returns html with a transparent 1x1 <img> embedded before </body>.
// Only active when LEARNING_ENABLED=true AND PIXEL_BASE_URL is set.
// Silent no-op otherwise — HTML passes through untouched.
function injectOpenPixel(html, { leadId }) {
  if (!LEARNING_ENABLED()) return html;
  const base = process.env.PIXEL_BASE_URL
            || process.env.FRONTEND_URL
            || process.env.RENDER_EXTERNAL_URL
            || '';
  if (!base || !leadId || typeof html !== 'string' || html.length === 0) return html;
  const pixel = `<img src="${base.replace(/\/$/, '')}/pixel/${leadId}.gif" width="1" height="1" alt="" style="display:block;border:0;" />`;
  return html.includes('</body>')
    ? html.replace('</body>', `${pixel}</body>`)
    : html + pixel;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ── Build shared SMTP transporter ─────────────────────────────
function buildTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth:   { user, pass: pass.trim() },
    tls:    { rejectUnauthorized: false },
  });
}

const _transporter = buildTransporter();

// ── Phone normalization — GHL requires +1 prefix on US numbers ─
// Exported for use by the dispatcher phone path + backfill script.
export function normalizeUSPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (String(raw).startsWith('+1')) return '+1' + digits.replace(/^1/, '');
  return '+1' + digits;
}

// ── GoHighLevel Sync ──────────────────────────────────────────
export async function syncToGHL(email, prospectData) {
  const ghlKey = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
  const locationId = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
  const webhookUrl = process.env.GHL_WEBHOOK_URL;

  // Formatting name and getting info from DB
  const companyName = prospectData.business_name || prospectData.nombre || 'Lead';
  const phone = normalizeUSPhone(prospectData.phone || prospectData.telefono || '');
  
  // Payload strictly aligned with the old Empirika n8n configuration
  const payload = {
    firstName: companyName,
    email: email,
    phone: phone,
    locationId: locationId,
    tags: ["lead-automatizado", "google-maps", "remodeling"],
    source: "Lead Generation System - Agentic IA",
    website: prospectData.website || '',
    address1: prospectData.address1 || prospectData.direccion || '',
    city: prospectData.metro_area || prospectData.ciudad || '',
    companyName: companyName,
    customFields: [
      { key: "score", field_value: prospectData.qualification_score || prospectData.score || '' },
      { key: "categoria", field_value: prospectData.industry || prospectData.categoria || '' },
      { key: "google_rating", field_value: prospectData.rating || prospectData.google_rating || '' },
      { key: "total_reviews", field_value: prospectData.review_count || prospectData.total_reviews || 0 },
      { key: "score_razon", field_value: prospectData.notes || prospectData.score_razon || '' }
    ]
  };

  try {
    if (webhookUrl) {
      await withRetry(
        () => fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-webhook' }
      );
      logger.info('GHL synced via webhook', { email });
    } else if (ghlKey && locationId) {
      payload.locationId = locationId;
      const res = await withRetry(
        () => fetch('https://services.leadconnectorhq.com/contacts/', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghlKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }),
        { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-api' }
      );
      if (res.ok) {
         logger.info('GHL contact created via API v2', { email });
      } else {
         logger.error('GHL API error', { email, body: await res.text() });
      }
    } else {
      logger.warn('GHL credentials missing — simulating sync', { email });
    }
    return true;
  } catch (err) {
    logger.error('GHL sync failed', { email, error: err.message });
    return false;
  }
}

// ── GHL Pipeline Push for DRAFT_PHONE (Path A) ────────────────
// Creates Contact + Opportunity in COLD LEADS | GOOGLE MY BUSINESS pipeline
// so the human rep sees each DRAFT_PHONE lead in GHL with the SPIN call
// script visible before picking up the phone. Returns { contactId, opportunityId }
// or { error } — never throws, callers can fire-and-forget.
export async function pushDraftPhoneToGHL(prospect, { callScript = null, whatsapp = null } = {}) {
  const ghlKey     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
  const locationId = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_PIPELINE_COLD_LEADS_ID || 'PbSBohJh1m1L08INwMzv';
  const stageId    = process.env.GHL_STAGE_NUEVO_ID || '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';

  if (!ghlKey || !locationId) {
    logger.warn('GHL phone-push: credentials missing — skipping', { business: prospect?.business_name });
    return { error: 'missing_credentials' };
  }

  const phone       = normalizeUSPhone(prospect?.phone);
  const companyName = prospect?.business_name || 'Lead';
  const industry    = (prospect?.industry || '').toLowerCase().replace(/\s+/g, '-') || 'unknown';
  const tags        = ['lead-automatizado', 'google-maps', 'empirika-engine', 'path-a-phone', industry].filter(Boolean);

  // Notes: human-readable SPIN concat so the rep sees context even without custom-field support.
  let notes = `[Path A — Phone outreach]\nNegocio: ${companyName}\nIndustria: ${prospect?.industry || 'N/A'}\nMetro: ${prospect?.metro_area || 'N/A'}`;
  if (callScript) {
    notes += `\n\n── SPIN Call Script ──`;
    if (callScript.opening)       notes += `\nOpening: ${callScript.opening}`;
    if (callScript.situation)     notes += `\nSituation: ${callScript.situation}`;
    if (callScript.problem)       notes += `\nProblem: ${callScript.problem}`;
    if (callScript.implication)   notes += `\nImplication: ${callScript.implication}`;
    if (callScript.need_payoff)   notes += `\nNeed-payoff: ${callScript.need_payoff}`;
    if (callScript.next_step)     notes += `\nNext step: ${callScript.next_step}`;
    if (Array.isArray(callScript.objection_handlers)) {
      notes += `\n\nObjection handlers:`;
      for (const oh of callScript.objection_handlers) {
        if (oh?.objection && oh?.response) notes += `\n- "${oh.objection}" → ${oh.response}`;
      }
    }
  }
  if (whatsapp) notes += `\n\n── WhatsApp draft ──\n${whatsapp}`;

  const customFields = [
    { key: 'score',          field_value: prospect?.qualification_score ?? '' },
    { key: 'categoria',      field_value: prospect?.industry || '' },
    { key: 'google_rating',  field_value: prospect?.rating || prospect?.google_rating || '' },
    { key: 'total_reviews',  field_value: prospect?.review_count || prospect?.total_reviews || 0 },
    { key: 'outreach_path',  field_value: 'phone' },
  ];
  if (callScript) {
    customFields.push({ key: 'call_script_spin', field_value: JSON.stringify(callScript) });
  }

  const contactPayload = {
    firstName:   companyName,
    phone:       phone || undefined,
    locationId,
    tags,
    source:      'Empirika Engine - Agentic IA (Phone Path)',
    website:     prospect?.website || '',
    address1:    prospect?.address1 || prospect?.direccion || '',
    city:        prospect?.metro_area || '',
    companyName,
    customFields,
  };
  if (prospect?.email_address) contactPayload.email = prospect.email_address;

  try {
    // 1. Create/upsert contact
    const contactRes = await withRetry(
      () => fetch('https://services.leadconnectorhq.com/contacts/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghlKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contactPayload),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-contact' }
    );
    const contactBody = await contactRes.json().catch(() => ({}));
    let contactId = contactBody?.contact?.id || contactBody?.id;
    let isDuplicate = false;

    if (!contactRes.ok) {
      // GHL returns 400 with meta.contactId when the phone (or email) already
      // exists under another contact. Treat this as "link to existing" rather
      // than a hard failure — still attach note + create opportunity so the
      // rep sees the lead in GHL.
      const dupContactId = contactBody?.meta?.contactId;
      if (contactRes.status === 400 && dupContactId) {
        contactId = dupContactId;
        isDuplicate = true;
        logger.info('GHL contact dup — linking to existing', {
          business: companyName,
          existingContactId: dupContactId,
          matchingField: contactBody?.meta?.matchingField || 'unknown',
        });
      } else {
        logger.error('GHL contact create failed', { business: companyName, status: contactRes.status, body: contactBody });
        return { error: `contact_${contactRes.status}`, detail: contactBody };
      }
    }

    if (!contactId) {
      logger.error('GHL contact: no id returned', { business: companyName, body: contactBody });
      return { error: 'no_contact_id' };
    }
    if (!isDuplicate) logger.info('GHL contact created', { business: companyName, contactId });

    // 2. Attach note with SPIN script
    try {
      await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghlKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: notes, userId: null }),
      });
    } catch (noteErr) {
      logger.warn('GHL note attach failed (non-blocking)', { contactId, error: noteErr.message });
    }

    // 3. Create opportunity in COLD LEADS pipeline stage NUEVO
    const oppPayload = {
      pipelineId,
      pipelineStageId: stageId,
      locationId,
      contactId,
      name:   `${companyName} — ${prospect?.industry || 'Lead'} (${prospect?.metro_area || 'US'})`,
      status: 'open',
      source: 'Empirika Engine — Phone Path',
    };
    const oppRes = await withRetry(
      () => fetch('https://services.leadconnectorhq.com/opportunities/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghlKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(oppPayload),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-opportunity' }
    );
    const oppBody = await oppRes.json().catch(() => ({}));
    if (!oppRes.ok) {
      logger.error('GHL opportunity failed', { business: companyName, contactId, status: oppRes.status, body: oppBody });
      return { contactId, error: `opportunity_${oppRes.status}`, detail: oppBody };
    }
    const opportunityId = oppBody?.opportunity?.id || oppBody?.id || null;
    logger.info('GHL opportunity created', { business: companyName, contactId, opportunityId, linkedToExisting: isDuplicate });

    return { contactId, opportunityId, duplicate: isDuplicate };
  } catch (err) {
    logger.error('GHL phone-push unexpected error', { business: companyName, error: err.message });
    return { error: 'exception', detail: err.message };
  }
}

async function handlePostSendActions(to) {
  if (!supabase) return;
  try {
    // 1. Find lead info
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('email_address', to)
      .limit(1)
      .single();

    if (lead) {
      // 2. Sync to GHL
      const ghlOk = await syncToGHL(to, lead);

      // Learning loop: channel=ghl, event=sent on successful sync.
      if (ghlOk) {
        logOutreachEvent({
          leadId:   lead.id,
          brandId:  lead.brand_id,
          channel:  'ghl',
          eventType: 'sent',
          metadata: { to },
        }).catch(() => {});
      }

      // 3. Update campaign_enriched_data and mark as SENT
      await supabase
        .from('campaign_enriched_data')
        .update({ ghl_tag: 'lead-automatizado', outreach_status: 'SENT' })
        .eq('prospect_id', lead.id);

      // 4. Mapear status en Leads Dashboard
      await supabase
        .from('leads')
        .update({ outreach_status: 'SENT' })
        .eq('id', lead.id);
    } else {
      logger.warn('Lead not found in Supabase — doing basic GHL sync', { email: to });
      await syncToGHL(to, { business_name: 'Lead Desconocido' });
    }
  } catch (e) {
    logger.error('Post-send actions failed', { error: e.message });
  }
}

// ── Core sendMail helper ──────────────────────────────────────
async function sendMail({ to, subject, html_body, from_name, lead_id, brand_id }) {
  const smtpUser   = process.env.SMTP_USER;
  const fromAddr   = smtpUser || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const senderName = from_name
    || process.env.SMTP_FROM_NAME
    || 'Ángela · Empírika Digital';
  const fromField  = `"${senderName}" <${fromAddr}>`;

  // Resolve lead + brand context so we can (a) inject the open pixel
  // and (b) log outreach events when LEARNING_ENABLED=true. Best-effort
  // lookup — if the lead can't be resolved we still send the email.
  let resolvedLeadId  = lead_id || null;
  let resolvedBrandId = brand_id || null;
  if (LEARNING_ENABLED() && supabase && (!resolvedLeadId || !resolvedBrandId)) {
    try {
      const { data: leadRow } = await supabase
        .from('leads')
        .select('id, brand_id')
        .eq('email_address', to)
        .limit(1)
        .maybeSingle();
      if (leadRow) {
        resolvedLeadId  = resolvedLeadId  || leadRow.id;
        resolvedBrandId = resolvedBrandId || leadRow.brand_id;
      }
    } catch { /* swallow — pixel injection just skips */ }
  }

  const finalHtml = injectOpenPixel(html_body || '', { leadId: resolvedLeadId });

  let finalResult = null;
  let sendError   = null;

  try {
    // Priority 1: Gmail SMTP — with retry for transient failures
    if (_transporter) {
      const info = await withRetry(
        () => _transporter.sendMail({
          from:    fromField,
          to:      [to],
          subject,
          html:    finalHtml,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: 'SMTP-send' }
      );
      finalResult = { status: 'sent', email_id: info.messageId, to, subject, transport: 'smtp' };
    }
    // Priority 2: Resend API — with retry
    else if (process.env.RESEND_API_KEY) {
      const apiKey = process.env.RESEND_API_KEY;
      const res  = await withRetry(
        () => fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ from: fromField, to: [to], subject, html: finalHtml }),
        }),
        { maxRetries: 2, baseDelayMs: 1000, label: 'Resend-send' }
      );
      const data = await res.json();
      if (data.id) {
        finalResult = { status: 'sent', email_id: data.id, to, subject, transport: 'resend' };
      } else {
        sendError = data;
      }
    }
    // Priority 3: MOCK
    else {
      logger.info('MOCK email', { to, subject });
      finalResult = {
        status: 'mock_sent',
        note:   'No email transport configured. Email logged but not sent.',
        to, subject,
      };
    }
  } catch (err) {
    sendError = err;
  }

  // ── Learning loop event logging (silent-fail) ─────────────
  if (finalResult && (finalResult.status === 'sent' || finalResult.status === 'mock_sent')) {
    if (resolvedBrandId) {
      logOutreachEvent({
        leadId:    resolvedLeadId,
        brandId:   resolvedBrandId,
        channel:   'email',
        eventType: 'sent',
        metadata:  { to, subject, transport: finalResult.transport || 'mock' },
        messageId: finalResult.email_id || null,
      }).catch(() => {});
    }
  } else if (sendError) {
    if (resolvedBrandId) {
      const errMsg = sendError?.message || (typeof sendError === 'object' ? JSON.stringify(sendError).slice(0, 400) : String(sendError));
      logOutreachEvent({
        leadId:    resolvedLeadId,
        brandId:   resolvedBrandId,
        channel:   'email',
        eventType: 'failed',
        metadata:  { to, subject, error: errMsg },
      }).catch(() => {});
    }
    // 5xx / bounce-like error → stamp BOUNCED so the legacy bounce-rate
    // fallback in lib/guardrails.js still trips the breaker when
    // outreach_events has no data yet.
    if (isBounceLikeError(sendError) && supabase && resolvedLeadId) {
      try {
        await supabase
          .from('campaign_enriched_data')
          .update({ outreach_status: 'BOUNCED' })
          .eq('prospect_id', resolvedLeadId);
      } catch { /* best-effort */ }
    }
    return { status: 'error', error: sendError?.message || sendError };
  }

  // Once mail is sent successfully or mocked => trigger GHL logic
  if (finalResult && (finalResult.status === 'sent' || finalResult.status === 'mock_sent')) {
    await handlePostSendActions(to);
  }

  return finalResult;
}

// Heuristic for 5xx / hard-bounce style failures. We do not want
// transient SMTP 4xx to poison the breaker.
function isBounceLikeError(err) {
  if (!err) return false;
  const code = err?.responseCode || err?.statusCode || err?.status;
  if (Number.isFinite(code) && code >= 500 && code < 600) return true;
  const msg = String(err?.message || err?.error || '').toLowerCase();
  return /bounce|undeliverable|mailbox\s+unavailable|5\.\d\.\d|no\s+such\s+user|recipient\s+rejected/.test(msg);
}

// ── Tool: send_email ──────────────────────────────────────────

export const sendEmail = new Tool({
  name: 'send_email',
  inputSchema: sendEmailInputSchema,
  description: 'Send a single personalized email using the agency Gmail SMTP (José Sánchez / Empírika). Use after content has been approved.',
  parameters: {
    type: 'object',
    properties: {
      to:        { type: 'string', description: 'Recipient email address' },
      subject:   { type: 'string', description: 'Email subject line' },
      html_body: { type: 'string', description: 'HTML body of the email' },
      from_name: { type: 'string', description: 'Sender display name (optional, defaults to Ángela · Empírika Digital)' },
    },
    required: ['to', 'subject', 'html_body'],
  },
  fn: async (args) => {
    try {
      const result = await sendMail(args);
      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ status: 'error', error: err.message });
    }
  },
});

// ── Tool: send_batch_emails ───────────────────────────────────

export const sendBatchEmails = new Tool({
  name: 'send_batch_emails',
  inputSchema: sendBatchEmailsInputSchema,
  description: 'Send multiple personalized emails via Gmail SMTP. Each email in the batch goes to a different recipient.',
  parameters: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        description: 'Array of email objects with to, subject, html_body fields',
        items: {
          type: 'object',
          properties: {
            to:        { type: 'string' },
            subject:   { type: 'string' },
            html_body: { type: 'string' },
          },
        },
      },
    },
    required: ['emails'],
  },
  fn: async (args) => {
    const { emails } = args;
    const results = [];

    for (const email of emails) {
      try {
        const result = await sendMail(email);
        results.push(result);
        // Throttle: 300ms between sends to avoid Gmail rate limits
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        results.push({ status: 'error', to: email.to, error: err.message });
      }
    }

    const sent   = results.filter(r => r.status === 'sent' || r.status === 'mock_sent').length;
    const errors = results.filter(r => r.status === 'error').length;
    return JSON.stringify({ status: 'batch_done', sent, errors, results });
  },
});
