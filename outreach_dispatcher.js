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
import { outreachDraftSchema, outreachSequenceSchema, normalizeOutreachOutput } from './lib/schemas.js';
import { sanitizeLeadData } from './lib/sanitize.js';
import { logger } from './lib/logger.js';
import { withRetry } from './lib/resilience.js';
import { pushDraftPhoneToGHL } from './tools/email.js';
import { assertSendAllowed, GuardrailBlocked } from './lib/guardrails.js';
import { recordAgentEvent } from './lib/agentEventsSink.js';
import { logOutreachEvent } from './tools/outreachEvents.js';
import { sendSMS } from './scripts/twilio.js';

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
 * Decide whether a single row is eligible for the autonomy fast-path.
 * Pure function so we can unit-test the gate without Supabase.
 */
export function shouldAutoApprove(row, { now = Date.now(), autonomyEnabled } = {}) {
  const flag = autonomyEnabled !== undefined
    ? autonomyEnabled
    : process.env.AUTONOMY_ENABLED === 'true';
  if (!flag) return false;
  if (!row) return false;
  if (row.approved === true) return true; // already approved
  if (row.held_by_human) return false;
  if (!row.auto_approve_at) return false;
  const t = new Date(row.auto_approve_at).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= now;
}

/**
 * Try to claim the per-brand autonomy lock. Returns true when the
 * caller now holds the lock, false when another worker is already
 * running a batch. held_until auto-expires after 5 minutes so a
 * crashed owner cannot deadlock the brand.
 *
 * Uses upsert with a conflict-update that only fires when the
 * existing row has expired — equivalent to
 *   INSERT ... ON CONFLICT (brand_id) DO UPDATE SET held_until=$2
 *   WHERE autonomy_locks.held_until < NOW() RETURNING brand_id
 * In PostgREST we approximate this by (1) upserting with
 * ignoreDuplicates on first claim and (2) falling back to an update
 * gated by held_until < NOW() when a stale row exists.
 */
export async function claimAutonomyLock(brandId, { ttlMs = 5 * 60 * 1000, client } = {}) {
  const db = client || supabase;
  if (!db || !brandId) return false;
  const heldUntil = new Date(Date.now() + ttlMs).toISOString();
  const nowIso    = new Date().toISOString();

  try {
    // Step 1 — fresh insert wins when no row exists yet.
    const ins = await db
      .from('autonomy_locks')
      .insert({ brand_id: brandId, held_until: heldUntil })
      .select('brand_id');
    if (!ins.error && ins.data && ins.data.length > 0) return true;

    // Step 2 — row exists; steal only if expired.
    const upd = await db
      .from('autonomy_locks')
      .update({ held_until: heldUntil, claimed_at: nowIso })
      .eq('brand_id', brandId)
      .lt('held_until', nowIso)
      .select('brand_id');
    if (!upd.error && upd.data && upd.data.length > 0) return true;

    return false;
  } catch (err) {
    logger.warn('claimAutonomyLock failed', { brandId, error: err?.message });
    return false;
  }
}

export async function releaseAutonomyLock(brandId, { client } = {}) {
  const db = client || supabase;
  if (!db || !brandId) return;
  try {
    await db.from('autonomy_locks').delete().eq('brand_id', brandId);
  } catch (err) {
    logger.warn('releaseAutonomyLock failed', { brandId, error: err?.message });
  }
}

/**
 * Scan for DRAFT rows whose auto_approve_at has passed and promote
 * them to APPROVED. Fires an AUTO_APPROVED event per row and
 * respects send guardrails (stops on breach).
 *
 * Serialized per brand via `autonomy_locks` (see migrations/013).
 * When another worker already holds the lock we skip the batch so
 * two concurrent schedulers cannot double-approve the same drafts.
 */
export async function autoApprovePastDueDrafts({ brandId, now = new Date(), client } = {}) {
  const db = client || supabase;
  if (!db) return 0;

  // Concurrency guard — only brand-scoped batches can be locked.
  // If no brandId is provided (legacy single-tenant path) we fall
  // through to the unlocked flow; that path is intentionally never
  // triggered from the autonomy cron, only from admin scripts.
  const lockKey = brandId || null;
  if (lockKey) {
    const claimed = await claimAutonomyLock(lockKey, { client: db });
    if (!claimed) {
      logger.info('auto-approve skip: another batch in flight', { brandId: lockKey });
      return 0;
    }
  }

  try {
    return await _autoApproveBody({ brandId, now, db });
  } finally {
    if (lockKey) {
      await releaseAutonomyLock(lockKey, { client: db });
    }
  }
}

async function _autoApproveBody({ brandId, now, db }) {
  const nowIso = now.toISOString();

  let query = db
    .from('campaign_enriched_data')
    .select('id, brand_id, prospect_id, auto_approve_at, lead_magnets_data, outreach_status')
    .in('outreach_status', ['DRAFT', 'DRAFT_PHONE'])
    .not('auto_approve_at', 'is', null)
    .lte('auto_approve_at', nowIso)
    .limit(BATCH_LIMIT);
  if (brandId) query = query.eq('brand_id', brandId);

  const { data: rows, error } = await query;
  if (error) {
    logger.warn('auto-approve query error', { error: error.message });
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  let approved = 0;
  for (const row of rows) {
    const held = row.lead_magnets_data?.held_by_human === true;
    if (held) continue;

    // Per-brand guardrails: stop the batch on first breach so the
    // remaining drafts roll over to the next cycle.
    try {
      await assertSendAllowed({ brandId: row.brand_id });
    } catch (err) {
      if (err instanceof GuardrailBlocked) {
        logger.warn('Guardrail breached — halting auto-approval batch', {
          reason: err.reason, remaining: rows.length - approved,
        });
        break;
      }
      throw err;
    }

    const { error: upErr } = await db
      .from('campaign_enriched_data')
      .update({ outreach_status: 'APPROVED' })
      .eq('id', row.id);

    if (upErr) {
      logger.warn('auto-approve update error', { id: row.id, error: upErr.message });
      continue;
    }

    recordAgentEvent({
      trace_id: `auto-approve-${row.id}`,
      brand_id: row.brand_id || null,
      agent:    'dispatcher',
      event_type: 'AUTO_APPROVED',
      status:   'ok',
      metadata: {
        record_id:      row.id,
        prospect_id:    row.prospect_id,
        auto_approve_at: row.auto_approve_at,
        via:            'timeout',
      },
    });

    approved++;
  }
  return approved;
}

/**
 * Pre-renders email drafts for all leads whose magnet is COMPLETED
 * and saves the HTML to Supabase for client approval via dashboard.
 * NO emails are sent automatically — the client must approve each one.
 * @returns {{ rendered: number, skipped: number, errors: number }}
 */
export async function dispatchPendingOutreach(opts = {}) {
  logger.info('Searching for leads ready for email pre-render');

  if (!supabase) {
    logger.error('Supabase not configured (missing URL or Key)');
    return { rendered: 0, skipped: 0, errors: 1 };
  }

  // ── Autonomy gate (Sprint 1) ────────────────────────────────
  // When AUTONOMY_ENABLED=true, scan DRAFT rows whose auto_approve_at
  // has passed (and not held by human) and promote them to APPROVED.
  // When AUTONOMY_ENABLED!=true, this block is a no-op → legacy flow
  // (manual approval via dashboard) is preserved untouched.
  if (process.env.AUTONOMY_ENABLED === 'true') {
    try {
      const autoApproved = await autoApprovePastDueDrafts(opts);
      if (autoApproved > 0) logger.info('Auto-approved drafts', { count: autoApproved });
    } catch (err) {
      if (err instanceof GuardrailBlocked) {
        logger.warn('Guardrail blocked auto-approval', { reason: err.reason, details: err.details });
      } else {
        logger.warn('Auto-approve pass failed', { error: err?.message });
      }
    }
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
          const prompt = `Escribe una SECUENCIA DE 3 TOQUES de outreach frío para un negocio de ${safeLead.industry || 'servicios'} llamado "${safeLead.business_name || 'su negocio'}" en ${safeLead.metro_area || 'USA'}.
Contexto: Nuestra agencia (Empírika) diseñó un concepto de página web profesional gratuito para ellos (magnet: website_screenshot).
Marco narrativo obligatorio — Observation → Proof → Ask:
- Touch 1 (días 0, angle=observation): notaste algo específico del negocio (review, foto, ausencia online). NUNCA CTA directo. Cerrar con pregunta abierta o comentario cálido.
- Touch 2 (días 3, angle=proof): mini caso de éxito con un negocio similar (misma industria + metro si podés) con métrica concreta. CTA soft tipo "¿te cuento cómo?".
- Touch 3 (días 4, angle=ask): cierre directo con fecha y hora específica en el CTA (ej: "jueves 24 a las 10am hora de ${safeLead.metro_area || 'Houston'}").

Además escribí un mensaje de WhatsApp corto, conversacional, impactante.

Sé asertivo, profesional, muy humano. Usá "tú" (informal pero respetuoso). TODO en ESPAÑOL — cero inglés.

Además, escribí un CALL SCRIPT SPIN para que un humano de Empírika llame por teléfono al dueño. SPIN = Situation → Problem → Implication → Need-payoff, adaptado a un contratista latino de ${safeLead.industry || 'servicios'} en ${safeLead.metro_area || 'USA'}. Incluí:
- opening: primera línea al atender (nombre de Ángela + motivo en 1 frase).
- situation: 1 pregunta que descubra contexto operativo (ej: cuántos trabajos cierran al mes, cómo les llegan clientes hoy).
- problem: 1 pregunta que saque a la luz el dolor actual (ej: qué le gustaría cambiar del flujo de leads).
- implication: 1 pregunta que cuantifique el costo del dolor (ej: cuánto le cuesta al mes perder esos leads o no tener sistema).
- need_payoff: 1 pregunta que haga al dueño expresar el valor de resolverlo (ej: qué pasaría si duplicara las citas agendadas).
- objection_handlers: 2-3 objeciones frecuentes con su respuesta corta (ej: "no tengo tiempo", "ya trabajo con alguien", "ya probé agencias").
- next_step: CTA específico — agendar una reunión de 15 min esta semana con fecha/hora sugerida.
- language: "es"

Devolvé SOLO un objeto JSON con esta forma exacta (validado con Zod, orden estricto):
{
  "email_sequence": [
    { "touch": 1, "days_after_previous": 0, "angle": "observation", "subject": "...", "body": "...", "preview_text": "..." },
    { "touch": 2, "days_after_previous": 3, "angle": "proof",       "subject": "...", "body": "...", "preview_text": "..." },
    { "touch": 3, "days_after_previous": 4, "angle": "ask",         "subject": "...", "body": "...", "preview_text": "..." }
  ],
  "whatsapp": "[Mensaje corto de WhatsApp en español]",
  "call_script": {
    "opening": "...",
    "situation": "...",
    "problem": "...",
    "implication": "...",
    "need_payoff": "...",
    "objection_handlers": [
      { "objection": "...", "response": "..." },
      { "objection": "...", "response": "..." }
    ],
    "next_step": "...",
    "language": "es"
  }
}
Reglas: subject 30-60 chars, preview_text 40-90 chars, body min 80 chars, todo en español. En el call_script cada campo SPIN entre 30 y 400 chars, objection_handlers con 2-3 items.`;
          logger.info('Asking Angela for multi-channel 3-touch sequence', { business: lead.business_name });
          const aiResult = await runtime.run('Angela', prompt, { maxIterations: 3 });

          // ── Parse with new sequence schema, fall back to legacy ──
          let parseResult = AgentRuntime.safeParseLLMOutput(aiResult.response, outreachSequenceSchema);
          if (!parseResult.success) {
            logger.warn('Angela output did not match sequence schema — trying legacy', { business: lead.business_name });
            parseResult = AgentRuntime.safeParseLLMOutput(aiResult.response, outreachDraftSchema);
          }

          if (parseResult.success) {
            // Normalize both shapes to a unified {touches[], whatsapp, call_script, legacy}
            const normalized = normalizeOutreachOutput(parseResult.data);
            const touch1 = normalized.touches[0];
            const touch2 = normalized.touches[1]; // may be null when legacy
            const touch3 = normalized.touches[2]; // may be null when legacy

            if (normalized.legacy) {
              logger.warn('Angela returned legacy single-email format — touches 2/3 will be empty', { business: lead.business_name });
            }

            // Persist SPIN call script (if present) regardless of email/phone path.
            // Drives the call-sheet in the dashboard so the human rep doesn't improvise.
            if (normalized.call_script) {
              magnetData.call_script = normalized.call_script;
            }

            // ── Verifier Gate — only for email drafts ──
            // Leads without email skip the gate: the Verifier rubric scores
            // email-send quality, blocking a non-existent email would trap
            // the lead on BLOCKED_LOW_QUALITY and starve the phone/social path.
            if (hasEmail) {
              const draftPayload = {
                subject:   touch1.subject,
                body:      touch1.body,
                whatsapp:  normalized.whatsapp,
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

              // Use (possibly rewritten) draft — this is Touch 1 (the email to send NOW)
              const finalDraft = gateResult.draft;
              angelaSubject = finalDraft.subject;
              angelaBody    = finalDraft.body;
              magnetData.whatsapp_draft  = finalDraft.whatsapp;
              magnetData.verifier_report = gateResult.verifier_history;
            } else {
              // No email → use Angela's Touch 1 directly for the phone/social path.
              // Still carry subject/body so CRM/dashboard can surface the narrative.
              angelaSubject = touch1.subject;
              angelaBody    = touch1.body;
              magnetData.whatsapp_draft = normalized.whatsapp;
            }

            // Persist touches 2 & 3 for the future follow-up worker (Phase 2).
            // Only present when Angela returned the new sequence schema; legacy
            // payloads yield null touches and therefore an empty array here.
            const followUps = [touch2, touch3]
              .filter(Boolean)
              .map((t) => ({
                touch: t.touch,
                angle: t.angle,
                days_after_previous: t.days_after_previous,
                subject: t.subject,
                body: t.body,
                preview_text: t.preview_text,
              }));
            magnetData.follow_up_sequence = followUps.length > 0 ? followUps : null;

            logger.info('Angela generated validated copy', {
              business: lead.business_name,
              follow_ups: followUps.length,
              legacy: normalized.legacy,
            });
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

        // Stamp auto_approve_at so the autonomy gate can pick this up
        // after the timeout window. Only relevant when AUTONOMY_ENABLED
        // is true; with the flag off the column is harmless.
        const timeoutMs = Number(process.env.AUTO_APPROVE_TIMEOUT_MS || 7200000);
        const autoAt = new Date(Date.now() + timeoutMs).toISOString();

        await supabase
          .from('campaign_enriched_data')
          .update({
            outreach_status: 'DRAFT',
            lead_magnets_data: magnetData,
            auto_approve_at: autoAt,
          })
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

        // ── Push to GHL pipeline (COLD LEADS / stage NUEVO) ─────
        // Idempotent: skip if we already synced this lead to GHL before.
        if (!magnetData.ghl_contact_id) {
          const ghlResult = await pushDraftPhoneToGHL(lead, {
            callScript: magnetData.call_script || null,
            whatsapp:   magnetData.whatsapp_draft || null,
          });
          if (ghlResult.contactId) {
            magnetData.ghl_contact_id     = ghlResult.contactId;
            magnetData.ghl_opportunity_id = ghlResult.opportunityId || null;
            magnetData.ghl_synced_at      = new Date().toISOString();
            if (ghlResult.duplicate) magnetData.ghl_linked_to_existing = true;
          } else {
            magnetData.ghl_sync_error = ghlResult.error || 'unknown';
          }
        }

        const timeoutMsPhone = Number(process.env.AUTO_APPROVE_TIMEOUT_MS || 7200000);
        const autoAtPhone = new Date(Date.now() + timeoutMsPhone).toISOString();

        await supabase
          .from('campaign_enriched_data')
          .update({
            outreach_status: 'DRAFT_PHONE',
            lead_magnets_data: magnetData,
            auto_approve_at: autoAtPhone,
          })
          .eq('id', record.id);
        await supabase
          .from('leads')
          .update({ outreach_status: 'DRAFT_PHONE' })
          .eq('id', lead.id);

        logger.info('Phone/social draft saved — call-sheet ready', {
          business: lead.business_name,
          phone:    lead.phone,
          ghl_contact: magnetData.ghl_contact_id || null,
        });
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

// ═════════════════════════════════════════════════════════════
// Multichannel dispatcher (Sprint 5)
//
// Processes APPROVED rows whose source was DRAFT_PHONE (i.e. no
// email on file) via WhatsApp → SMS → CALL_SCHEDULED ladder.
// Fully gated behind MULTICHANNEL_ENABLED — with the flag off
// this function is a short-circuit no-op and the legacy email-
// only path is preserved untouched.
//
// Injection points (for tests):
//   deps.baileys   — { checkWhatsApp, sendText, canSendToday }
//   deps.smsSender — async ({ to, body }) => { messageSid, status }
//   deps.client    — Supabase client
//   deps.verifyFn  — async (draft, ctx) => { blocked, draft }
//
// Production imports resolve the real implementations lazily.
// ═════════════════════════════════════════════════════════════

export async function dispatchApprovedMultichannel(opts = {}) {
  if (process.env.MULTICHANNEL_ENABLED !== 'true') {
    return { skipped: 'disabled', processed: 0 };
  }

  const db = opts.client || supabase;
  if (!db) return { skipped: 'no_supabase', processed: 0 };

  const brandId = opts.brandId || process.env.BRAND_ID || null;

  // Pull APPROVED rows that came from DRAFT_PHONE (hint in lead_magnets_data).
  let query = db
    .from('campaign_enriched_data')
    .select(`
      id, brand_id, prospect_id, outreach_status, lead_magnets_data,
      leads!inner (id, business_name, phone, email_address, industry, metro_area)
    `)
    .eq('outreach_status', 'APPROVED')
    .limit(BATCH_LIMIT);
  if (brandId) query = query.eq('brand_id', brandId);

  const { data: rows, error } = await query;
  if (error) {
    logger.warn('multichannel query error', { error: error.message });
    return { error: error.message, processed: 0 };
  }
  if (!rows?.length) return { processed: 0 };

  // Filter to DRAFT_PHONE-origin rows (no email, has phone).
  const eligible = rows.filter((r) => !r.leads?.email_address && r.leads?.phone);
  const stats = { processed: 0, whatsapp: 0, sms: 0, call: 0, errors: 0 };

  // Lazy-load Baileys (keeps the dep optional when the flag is off).
  let baileys = opts.baileys || null;
  if (!baileys) {
    try {
      baileys = await import('./tools/baileysWhatsApp.js');
    } catch (err) {
      logger.warn('baileys import failed — SMS-only path', { error: err?.message });
    }
  }
  const smsSender = opts.smsSender || sendSMS;

  for (const row of eligible) {
    const lead = row.leads;
    const rowBrandId = row.brand_id;

    // Guardrails: halt batch on breach so caps hold across channels.
    try {
      await assertSendAllowed({ brandId: rowBrandId });
    } catch (err) {
      if (err instanceof GuardrailBlocked) {
        logger.warn('Guardrail breached — halting multichannel batch', { reason: err.reason });
        break;
      }
      throw err;
    }

    const magnetData = row.lead_magnets_data || {};
    const waBody  = magnetData.whatsapp_draft || null;
    const smsBody = magnetData.sms_draft     || waBody;

    // ── Spanish-only gate (IRON RULE #1) ─────────────────────
    // Reuse the Baileys guard so SMS obeys the same rule.
    if (baileys?.assertSpanishOnly && waBody) {
      try { baileys.assertSpanishOnly(waBody); }
      catch (err) {
        logger.warn('WA draft failed spanish-only guard — skipping', {
          lead: lead.business_name, error: err.message,
        });
        await db.from('campaign_enriched_data')
          .update({ outreach_status: 'BLOCKED_LOW_QUALITY' })
          .eq('id', row.id);
        stats.errors++;
        continue;
      }
    }

    let dispatched = false;

    // ── 1) WhatsApp path ────────────────────────────────────
    if (baileys?.checkWhatsApp && baileys?.sendText && waBody) {
      try {
        const allowed = await baileys.canSendToday(rowBrandId, { client: db });
        if (allowed) {
          const probe = await baileys.checkWhatsApp(lead.phone, { brandId: rowBrandId });
          if (probe?.exists) {
            await db.from('campaign_enriched_data')
              .update({ outreach_status: 'WHATSAPP_QUEUED' }).eq('id', row.id);
            const send = await baileys.sendText({
              brandId: rowBrandId, to: lead.phone, body: waBody, client: db,
            });
            await db.from('campaign_enriched_data')
              .update({ outreach_status: 'WHATSAPP_SENT' }).eq('id', row.id);
            await logOutreachEvent({
              leadId: lead.id, brandId: rowBrandId, channel: 'whatsapp',
              eventType: 'sent', messageId: send.messageId,
              metadata: { jid: send.jid },
            });
            stats.whatsapp++;
            dispatched = true;
          }
        }
      } catch (err) {
        logger.warn('WhatsApp send failed — falling through to SMS', {
          lead: lead.business_name, error: err.message,
        });
        await logOutreachEvent({
          leadId: lead.id, brandId: rowBrandId, channel: 'whatsapp',
          eventType: 'failed', metadata: { error: err.message },
        });
      }
    }

    // ── 2) SMS fallback ─────────────────────────────────────
    if (!dispatched && smsBody) {
      try {
        const smsResult = await smsSender({ to: lead.phone, body: smsBody });
        if (smsResult?.messageSid) {
          await db.from('campaign_enriched_data')
            .update({ outreach_status: 'SMS_SENT' }).eq('id', row.id);
          await logOutreachEvent({
            leadId: lead.id, brandId: rowBrandId, channel: 'sms',
            eventType: 'sent', messageId: smsResult.messageSid,
          });
          stats.sms++;
          dispatched = true;
        } else {
          logger.warn('SMS send failed', {
            lead: lead.business_name, error: smsResult?.error,
          });
          await logOutreachEvent({
            leadId: lead.id, brandId: rowBrandId, channel: 'sms',
            eventType: 'failed', metadata: { error: smsResult?.error || 'unknown' },
          });
        }
      } catch (err) {
        logger.warn('SMS send threw', { error: err.message });
      }
    }

    // ── 3) Human call fallback ──────────────────────────────
    if (!dispatched) {
      await db.from('campaign_enriched_data')
        .update({ outreach_status: 'CALL_SCHEDULED' }).eq('id', row.id);
      await logOutreachEvent({
        leadId: lead.id, brandId: rowBrandId, channel: 'phone',
        eventType: 'stage_change',
        metadata: { reason: 'no_digital_channel_available' },
      });
      stats.call++;
    }

    stats.processed++;
  }

  logger.info('Multichannel dispatch summary', stats);
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
