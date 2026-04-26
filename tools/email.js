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

import panelFieldsJson from '../lib/ghl_panel_fields.json' with { type: 'json' };
const PANEL_FIELDS = panelFieldsJson.fields; // { emprika__website_url: {id, dataType, name}, ... }

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
  // US/CA sin country code.
  if (digits.length === 10) return '+1' + digits;
  // US/CA con country code.
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  // Cualquier otra longitud (9, 12+, 13…) es un input ambiguo o con country
  // code extranjero mal mapeado (e.g. `+56 407-293-2642` venía produciendo
  // `+1564072932642` en el fallback viejo). Rechazamos en vez de inventar
  // un `+1` delante: mejor crear el contacto sin teléfono (visible como
  // problema) que con un teléfono basura que Meta/Twilio luego rebota.
  return '';
}

// ── Empírika Panel: build custom fields array ─────────────────
// Returns array of { id, key, field_value } for GHL contacts API.
// Empty strings and zero-equivalent numerics are skipped to keep
// the GHL panel clean (no blank fields shown to Caleb).
export function buildEmpirikaCustomFields(prospect, ced) {
  const candidates = [
    { key: 'emprika__website_url',        value: prospect?.website || '' },
    { key: 'emprika__google_maps_url',    value: prospect?.google_maps_url || '' },
    { key: 'emprika__facebook_url',       value: prospect?.facebook_url || '' },
    { key: 'emprika__instagram_url',      value: prospect?.instagram_url || '' },
    { key: 'emprika__industry',           value: prospect?.industry || '' },
    { key: 'emprika__metro_area',         value: prospect?.metro_area || '' },
    { key: 'emprika__review_count',       value: Number(prospect?.review_count) || 0 },
    { key: 'emprika__rating',             value: Number(prospect?.rating) || 0 },
    { key: 'emprika__qualification_score',value: Number(prospect?.qualification_score) || 0 },
    { key: 'emprika__lead_tier',          value: prospect?.lead_tier || '' },
    { key: 'emprika__genoma',             value: (ced?.radiography_technical || '').slice(0, 2000) },
    { key: 'emprika__attack_angle',       value: (ced?.attack_angle || '').slice(0, 2000) },
    {
      key:   'emprika__last_email_sent_at',
      value: ced?.email_sent_at ? new Date(ced.email_sent_at).toISOString() : '',
    },
    { key: 'emprika__outreach_path',      value: 'email' },
  ];

  const result = [];
  for (const { key, value } of candidates) {
    // Skip empties (string '' or numeric 0) — keeps panel clean
    if (value === '' || value === 0) continue;
    const fieldDef = PANEL_FIELDS[key];
    if (!fieldDef) continue; // field missing from JSON map — skip safely
    result.push({ id: fieldDef.id, key, field_value: value });
  }
  return result;
}

// ── Empírika Panel: drop idempotent note ──────────────────────
// Stamps [empirika-genoma:v1] note on a GHL contact exactly once.
// If the note already exists the function returns { skipped: true }.
// Non-throwing: callers should catch/log any rejection.
export async function dropEmpirikaNote(contactId, prospect, ced, ghlKey) {
  const baseUrl = 'https://services.leadconnectorhq.com';
  const headers = {
    'Authorization': `Bearer ${ghlKey}`,
    'Version':       '2021-07-28',
    'Content-Type':  'application/json',
  };

  // 1. GET existing notes
  const notesRes = await fetch(`${baseUrl}/contacts/${contactId}/notes`, { headers });
  if (notesRes.ok) {
    const notesBody = await notesRes.json().catch(() => ({}));
    const notes = notesBody?.notes || notesBody?.data || [];
    if (notes.some(n => typeof n.body === 'string' && n.body.startsWith('[empirika-genoma:v1]'))) {
      return { skipped: true };
    }
  }

  // 2. Build note text (IR1: todo en español)
  const score    = prospect?.qualification_score ?? '';
  const tier     = prospect?.lead_tier || '';
  const metro    = prospect?.metro_area || '';
  const industry = prospect?.industry || '';
  const genoma   = ced?.radiography_technical
    ? (ced.radiography_technical.length > 300
        ? ced.radiography_technical.slice(0, 300) + '...'
        : ced.radiography_technical)
    : 'Sin enriquecimiento todavía.';
  const angle    = ced?.attack_angle
    ? (ced.attack_angle.length > 200
        ? ced.attack_angle.slice(0, 200) + '...'
        : ced.attack_angle)
    : 'Sin enriquecimiento todavía.';

  const website  = prospect?.website       || '—';
  const gmapsUrl = prospect?.google_maps_url || '—';
  const fbUrl    = prospect?.facebook_url   || '—';
  const igUrl    = prospect?.instagram_url  || '—';
  const generado = new Date().toISOString();

  const noteText = `[empirika-genoma:v1] · score ${score} · ${tier} · ${metro} · ${industry}
─────────────────────────────────────────────
Genoma: ${genoma}

Ángulo de ataque: ${angle}

Links:
🌐 ${website}
🗺️ ${gmapsUrl}
📘 ${fbUrl}
📷 ${igUrl}

Generado: ${generado}`;

  // 3. POST note
  const postRes = await fetch(`${baseUrl}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: noteText, userId: undefined }),
  });
  if (!postRes.ok) {
    const errBody = await postRes.text().catch(() => '');
    throw new Error(`GHL note POST ${postRes.status}: ${errBody.slice(0, 200)}`);
  }
  const postBody = await postRes.json().catch(() => ({}));
  return { created: true, noteId: postBody?.id || postBody?.note?.id || null };
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

// ── GHL Pipeline Push for EMAIL path ─────────────────────────
// Mirror of pushDraftPhoneToGHL but for the email-send path: creates
// contact + opportunity in COLD LEADS / stage NUEVO so the stage auto-
// migration (NUEVO → CONTACTADO) works for email leads too.
// Returns { contactId, opportunityId, duplicate } or { error }.
export async function pushEmailPathToGHL(prospect, ced = null) {
  const ghlKey     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
  const locationId = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_PIPELINE_COLD_LEADS_ID || 'PbSBohJh1m1L08INwMzv';
  const stageId    = process.env.GHL_STAGE_NUEVO_ID || '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';
  if (!ghlKey || !locationId) return { error: 'missing_credentials' };

  const companyName = prospect?.business_name || 'Lead';
  const phone       = normalizeUSPhone(prospect?.phone);
  const industry    = (prospect?.industry || '').toLowerCase().replace(/\s+/g, '-') || 'unknown';
  const tags        = ['lead-automatizado', 'google-maps', 'empirika-engine', 'path-b-email', industry].filter(Boolean);

  const contactPayload = {
    firstName:   companyName,
    email:       prospect?.email_address || prospect?.email || undefined,
    phone:       phone || undefined,
    locationId,
    tags,
    source:      'Empirika Engine - Agentic IA (Email Path)',
    website:     prospect?.website || '',
    city:        prospect?.metro_area || '',
    companyName,
    customFields: buildEmpirikaCustomFields(prospect, ced),
  };

  try {
    const contactRes = await withRetry(
      () => fetch('https://services.leadconnectorhq.com/contacts/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(contactPayload),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-contact-email' }
    );
    const cb = await contactRes.json().catch(() => ({}));
    let contactId = cb?.contact?.id || cb?.id;
    let isDuplicate = false;
    if (!contactRes.ok) {
      const dupId = cb?.meta?.contactId;
      if (contactRes.status === 400 && dupId) {
        contactId = dupId;
        isDuplicate = true;
      } else {
        logger.warn('GHL email-path contact create failed', { status: contactRes.status, body: cb });
        return { error: `contact_${contactRes.status}`, detail: cb };
      }
    }
    if (!contactId) return { error: 'no_contact_id' };

    // Drop Empírika genoma note (idempotent — skips if already present)
    dropEmpirikaNote(contactId, prospect, ced, ghlKey).catch(noteErr => {
      logger.warn('GHL empirika note drop failed (non-blocking)', { contactId, error: noteErr.message });
    });

    const oppPayload = {
      pipelineId,
      pipelineStageId: stageId,
      locationId,
      contactId,
      name:   `${companyName} — ${prospect?.industry || 'Lead'} (${prospect?.metro_area || 'US'})`,
      status: 'open',
      source: 'Empirika Engine — Email Path',
    };
    const oppRes = await withRetry(
      () => fetch('https://services.leadconnectorhq.com/opportunities/', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(oppPayload),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-opp-email' }
    );
    const ob = await oppRes.json().catch(() => ({}));
    if (!oppRes.ok) {
      logger.warn('GHL email-path opportunity create failed', { status: oppRes.status, body: ob });
      return { contactId, error: `opportunity_${oppRes.status}`, detail: ob };
    }
    const opportunityId = ob?.opportunity?.id || ob?.id || null;
    return { contactId, opportunityId, duplicate: isDuplicate };
  } catch (err) {
    logger.warn('GHL email-path push exception', { error: err.message });
    return { error: 'exception', detail: err.message };
  }
}

// ── Move GHL opportunity to a target stage ───────────────────
// Used after successful outbound send to migrate NUEVO → CONTACTADO.
// Idempotent at the API level: GHL allows moving to the same stage
// without error, so callers don't need to track whether it already moved.
export async function moveOpportunityToStage(opportunityId, targetStageId) {
  const ghlKey     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
  const locationId = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
  const pipelineId = process.env.GHL_PIPELINE_COLD_LEADS_ID || 'PbSBohJh1m1L08INwMzv';
  if (!ghlKey || !opportunityId || !targetStageId) return { ok: false, error: 'missing_args' };
  try {
    const res = await withRetry(
      () => fetch(`https://services.leadconnectorhq.com/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${ghlKey}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, pipelineStageId: targetStageId, locationId }),
      }),
      { maxRetries: 2, baseDelayMs: 1000, label: 'GHL-stage-move' }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `stage_${res.status}`, detail: body.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'exception', detail: err.message };
  }
}

export async function handlePostSendActions(to, { client } = {}) {
  const db = client || supabase;
  if (!db) return;
  try {
    // 1. Find lead info (case-insensitive + trimmed — callers pass raw "to")
    const toNorm = String(to || '').trim();
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .ilike('email_address', toNorm)
      .limit(1)
      .maybeSingle();

    if (!lead) {
      logger.warn('Lead not found in Supabase — doing basic GHL sync', { email: to });
      await syncToGHL(to, { business_name: 'Lead Desconocido' });
      return;
    }

    // 2a. Log the email 'sent' event (learning-loop fuel). This is the
    // authoritative signal — fires even when GHL sync fails, so the
    // nightly consolidator sees real volume.
    logOutreachEvent({
      leadId:   lead.id,
      brandId:  lead.brand_id,
      channel:  'email',
      eventType: 'sent',
      metadata: { to: toNorm },
    }).catch(() => {});

    // 2b. Sync to GHL (contact-level, webhook/API)
    const ghlOk = await syncToGHL(to, lead);
    if (ghlOk) {
      logOutreachEvent({
        leadId:   lead.id,
        brandId:  lead.brand_id,
        channel:  'ghl',
        eventType: 'sent',
        metadata: { to: toNorm },
      }).catch(() => {});
    }

    // 2b. Ensure GHL opportunity exists + move NUEVO→CONTACTADO.
    // Non-blocking: any failure here is logged but does not prevent
    // the SENT status update below.
    try {
      const { data: camp } = await db
        .from('campaign_enriched_data')
        .select('id, lead_magnets_data')
        .eq('prospect_id', lead.id)
        .limit(1)
        .maybeSingle();

      if (camp) {
        const magnetData = camp.lead_magnets_data || {};
        let opportunityId = magnetData.ghl_opportunity_id;

        if (!opportunityId) {
          const push = await pushEmailPathToGHL(lead, camp);
          if (push.opportunityId) {
            opportunityId                    = push.opportunityId;
            magnetData.ghl_contact_id        = push.contactId;
            magnetData.ghl_opportunity_id    = push.opportunityId;
            magnetData.ghl_synced_at         = new Date().toISOString();
            if (push.duplicate) magnetData.ghl_linked_to_existing = true;
          } else if (push.error) {
            magnetData.ghl_sync_error = push.error;
          }
        }

        if (opportunityId && !magnetData.ghl_moved_to_contactado_at) {
          const stageContactado = process.env.GHL_STAGE_CONTACTADO_ID || 'c1d2e758-5235-4469-b0b5-95d4fb06cdc4';
          const mv = await moveOpportunityToStage(opportunityId, stageContactado);
          if (mv.ok) {
            magnetData.ghl_stage                   = 'CONTACTADO';
            magnetData.ghl_moved_to_contactado_at  = new Date().toISOString();
            logger.info('GHL stage NUEVO→CONTACTADO', { opportunityId, business: lead.business_name });
          } else {
            magnetData.ghl_stage_move_error = mv.error;
            logger.warn('GHL stage move failed', { opportunityId, error: mv.error });
          }
        }

        await db
          .from('campaign_enriched_data')
          .update({ lead_magnets_data: magnetData })
          .eq('id', camp.id);
      }
    } catch (ghlErr) {
      logger.warn('GHL opportunity auto-advance failed (non-blocking)', { email: to, error: ghlErr.message });
    }

    // 3. Update campaign_enriched_data and mark as SENT
    const sentAt = new Date().toISOString();
    await db
      .from('campaign_enriched_data')
      .update({ ghl_tag: 'lead-automatizado', outreach_status: 'SENT' })
      .eq('prospect_id', lead.id);

    // 4. Mapear status en Leads Dashboard
    await db
      .from('leads')
      .update({ outreach_status: 'SENT' })
      .eq('id', lead.id);

    // 5. Sync first_contact_date on first successful send (idempotent: only when NULL)
    await db
      .from('leads')
      .update({ first_contact_date: sentAt })
      .eq('id', lead.id)
      .is('first_contact_date', null);
    console.log('[dispatcher] synced first_contact_date', lead.id);
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
      const toNorm = String(to || '').trim();
      const { data: leadRow } = await supabase
        .from('leads')
        .select('id, brand_id')
        .ilike('email_address', toNorm)
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
