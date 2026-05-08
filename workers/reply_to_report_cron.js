// ============================================================
// workers/reply_to_report_cron.js — Cierra el loop "lead responde
//   sí mandamelo" → genera PDF + envía email + log evento.
//
// Flujo:
//   1. Lee outreach_events nuevos con event_type='replied' que NO
//      tengan metadata.report_decision (sin procesar todavía).
//   2. Para cada uno: lee el body, clasifica intent (rules + LLM
//      fallback). Persiste decision en metadata.report_decision.
//   3. Si intent='send_report' Y el lead tiene mini_audit cacheado:
//      genera PDF, lo envía por nodemailer al email del lead, y
//      registra evento outreach_events event_type='mini_report_sent'.
//   4. Si intent='schedule_call' / 'not_interested' / 'other':
//      sólo loggea — el operator humano decide.
//
// Cron sugerido: cada 15 min en Render.
// Run modes:
//   node workers/reply_to_report_cron.js            # production cycle
//   node workers/reply_to_report_cron.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { detectReplyIntent } from '../lib/replyIntentDetector.js';
import { generateMiniReportPDF } from '../lib/miniReportGenerator.js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SCAN_WINDOW_HOURS = Number(process.env.REPLY_TO_REPORT_WINDOW_H ?? 72);
const SELF_CHECK = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildSmtp() {
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

async function logEvent(supabase, leadId, type, metadata = {}) {
  try {
    await supabase.from('outreach_events').insert({
      brand_id: BRAND_ID,
      lead_id: leadId,
      event_type: type,
      channel: 'email',
      metadata,
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn('reply_to_report: failed to log event', { type, err: err.message });
  }
}

async function processOneReply(supabase, runtime, smtp, replyEvent) {
  const log = logger.child({ event_id: replyEvent.id, lead_id: replyEvent.lead_id });

  // Pull lead context (business name, email, mini_audit)
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, business_name, industry, metro_area, email, email_address, mega_profile')
    .eq('id', replyEvent.lead_id)
    .maybeSingle();

  if (leadErr || !lead) {
    log.warn('reply_to_report: lead not found', { err: leadErr?.message });
    await markDecision(supabase, replyEvent, { intent: 'other', reason: 'lead_not_found' });
    return { processed: false, reason: 'lead_not_found' };
  }

  const replyBody =
    replyEvent.metadata?.body
    || replyEvent.metadata?.preview
    || replyEvent.metadata?.snippet
    || replyEvent.metadata?.text
    || '';

  if (!replyBody) {
    log.warn('reply_to_report: empty reply body — skip');
    await markDecision(supabase, replyEvent, { intent: 'other', reason: 'empty_body' });
    return { processed: false, reason: 'empty_body' };
  }

  // Classify
  const verdict = await detectReplyIntent(replyBody, runtime);
  log.info('reply_to_report: classified', {
    intent: verdict.intent, confidence: verdict.confidence, source: verdict.source,
  });

  await markDecision(supabase, replyEvent, verdict);

  if (verdict.intent !== 'send_report') {
    return { processed: false, intent: verdict.intent, action: 'no_action' };
  }

  // Need mini_audit — required for the PDF
  const audit = lead.mega_profile?.mini_audit;
  if (!audit?.ok || !audit.hallazgos?.length) {
    log.info('reply_to_report: skip — no mini_audit findings cached for this lead');
    return { processed: false, intent: 'send_report', action: 'no_audit_data' };
  }

  // Need email
  const toEmail = lead.email || lead.email_address;
  if (!toEmail) {
    log.info('reply_to_report: skip — no email on lead');
    return { processed: false, intent: 'send_report', action: 'no_email' };
  }

  if (!smtp) {
    log.warn('reply_to_report: skip — SMTP not configured');
    return { processed: false, intent: 'send_report', action: 'smtp_not_configured' };
  }

  // Build PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generateMiniReportPDF(lead, audit);
  } catch (err) {
    log.error('reply_to_report: PDF generation failed', { err: err.message });
    return { processed: false, intent: 'send_report', action: 'pdf_failed', error: err.message };
  }

  // Send
  const safeName = (lead.business_name || 'tu-negocio').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const subject = `Tu mini-reporte SEO — ${lead.business_name || 'preparado'}`;
  const greeting = lead.business_name ? `Hola, equipo de ${lead.business_name}.` : 'Hola.';
  const body = [
    greeting,
    '',
    'Como pediste, te paso adjunto el mini-reporte. Es 1 página con los 3 hallazgos más relevantes que encontramos en tu sitio y un plan de acción priorizado.',
    '',
    'Si querés que te explique cómo Empírika ejecuta cada acción y qué resultados típicamente vemos en 90 días, respondeme con la fecha y hora que te queda y agendamos 15 minutos.',
    '',
    'Saludos,',
    'Equipo Empírika',
  ].join('\n');

  try {
    const result = await smtp.sendMail({
      from: `"Empírika" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject,
      text: body,
      attachments: [
        { filename: `mini-reporte-${safeName}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
      ],
    });
    log.info('reply_to_report: sent', { messageId: result.messageId, to: toEmail, bytes: pdfBuffer.length });
    await logEvent(supabase, lead.id, 'mini_report_sent', {
      to: toEmail,
      bytes: pdfBuffer.length,
      message_id: result.messageId,
      hallazgos_count: audit.hallazgos.length,
      reply_event_id: replyEvent.id,
    });
    return { processed: true, intent: 'send_report', action: 'sent', to: toEmail };
  } catch (err) {
    log.error('reply_to_report: send failed', { err: err.message });
    return { processed: false, intent: 'send_report', action: 'send_failed', error: err.message };
  }
}

async function markDecision(supabase, replyEvent, decision) {
  try {
    const newMeta = {
      ...(replyEvent.metadata || {}),
      report_decision: {
        intent: decision.intent,
        confidence: decision.confidence,
        source: decision.source,
        reason: decision.reason,
        decided_at: new Date().toISOString(),
      },
    };
    await supabase.from('outreach_events').update({ metadata: newMeta }).eq('id', replyEvent.id);
  } catch (err) {
    logger.warn('reply_to_report: failed to mark decision', { id: replyEvent.id, err: err.message });
  }
}

async function runCycle(supabase, runtime, smtp) {
  const since = new Date(Date.now() - SCAN_WINDOW_HOURS * 3600 * 1000).toISOString();

  // Pull replied events without report_decision yet
  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, occurred_at, metadata, channel')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(50);

  if (error) {
    logger.error('reply_to_report: failed to fetch events', { err: error.message });
    return { fetched: 0, processed: 0 };
  }

  const pending = (events || []).filter((e) => !e.metadata?.report_decision);
  logger.info('reply_to_report: cycle start', {
    window_hours: SCAN_WINDOW_HOURS, total_replied: events?.length ?? 0, pending: pending.length,
  });

  let sent = 0, classified = 0, errors = 0;
  for (const ev of pending) {
    try {
      const result = await processOneReply(supabase, runtime, smtp, ev);
      classified++;
      if (result.action === 'sent') sent++;
    } catch (err) {
      errors++;
      logger.error('reply_to_report: handler threw', { id: ev.id, err: err.message });
    }
  }

  logger.info('reply_to_report: cycle done', { classified, sent, errors });
  return { fetched: events?.length ?? 0, classified, sent, errors };
}

async function main() {
  logger.info('reply_to_report worker starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  const smtp = buildSmtp();

  await runCycle(supabase, runtime, smtp);

  if (SELF_CHECK) {
    logger.info('reply_to_report: self-check OK, exiting');
    process.exit(0);
  }
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('reply_to_report fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneReply };
