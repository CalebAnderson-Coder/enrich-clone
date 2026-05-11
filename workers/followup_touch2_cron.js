// ============================================================
// workers/followup_touch2_cron.js — Touch 2 follow-up para el
//   playbook lead-magnet. Cron horario que detecta leads que
//   recibieron touch 1 hace 72h-7d, NO respondieron, NO bouncearon,
//   y manda un follow-up corto recordando el CTA del reporte.
//
// Quién: Ángela escribe el follow-up via AgentRuntime.
// Cuándo: cron schedule "30 14,18,22 * * 1-5" — 30 min después
//   de cada ventana lead-magnet (10:30am, 2:30pm, 6:30pm ET).
//
// Caps:
//   - FU_TOUCH2_BATCH_SIZE per cycle (default 5)
//   - FU_TOUCH2_DAILY_CAP (default 15)
//   - Solo un touch 2 por lead (idempotente por metadata.followup_touch=2)
//
// Run modes:
//   node workers/followup_touch2_cron.js
//   node workers/followup_touch2_cron.js --self-check
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { angela } from '../agents/angela.js';
import { logger } from '../lib/logger.js';

const BRAND_ID       = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const BATCH_SIZE     = Number(process.env.FU_TOUCH2_BATCH_SIZE ?? 5);
const DAILY_CAP      = Number(process.env.FU_TOUCH2_DAILY_CAP  ?? 15);
const PACE_MS        = Number(process.env.FU_TOUCH2_PACE_MS    ?? 8000);
const MIN_AGE_H      = Number(process.env.FU_TOUCH2_MIN_AGE_H  ?? 72);
const MAX_AGE_D      = Number(process.env.FU_TOUCH2_MAX_AGE_D  ?? 7);
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'Ángela · Empírika';
const REPLY_TO       = process.env.LEAD_MAGNET_REPLY_TO || 'jsanchez@empirikagroup.com';
const SELF_CHECK     = process.argv.includes('--self-check');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Supabase + SMTP builders ────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildSmtp() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS || '').trim() },
    tls: { rejectUnauthorized: false },
  });
}

// ── Daily cap guard ─────────────────────────────────────────

/**
 * Cuenta cuántos touch-2 se enviaron hoy para no superar DAILY_CAP.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<number>}
 */
async function countSentToday(supabase) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('outreach_events')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'sent')
    .eq('channel', 'email')
    .gte('occurred_at', dayStart.toISOString())
    .eq('metadata->>campaign', 'lead-magnet-followup2');
  if (error) {
    logger.warn('followup_touch2_cron: daily count failed — assuming 0', { err: error.message });
    return 0;
  }
  return count ?? 0;
}

// ── Candidate selection ─────────────────────────────────────

/**
 * Devuelve hasta `limit` leads elegibles para touch 2:
 *   - Recibieron touch 1 lead-magnet hace entre MIN_AGE_H y MAX_AGE_D días.
 *   - No respondieron, no bouncearon, no recibieron touch 2 aún,
 *     no recibieron el mini-report PDF.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} limit
 * @returns {Promise<Array<{id: string, lead_id: string, occurred_at: string, message_id: string, metadata: object, lead: object}>>}
 */
async function pickCandidates(supabase, limit) {
  const since = new Date(Date.now() - MAX_AGE_D * 24 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() - MIN_AGE_H * 3600 * 1000).toISOString();

  // 1. Pull eventos touch-1 dentro de la ventana de tiempo
  const { data: sentEvents, error: sentErr } = await supabase
    .from('outreach_events')
    .select('id, lead_id, occurred_at, message_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'sent')
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .like('metadata->>campaign', 'lead-magnet%')
    .order('occurred_at', { ascending: true })
    .limit(limit * 4);

  if (sentErr) {
    logger.error('followup_touch2_cron: sentEvents fetch failed', { err: sentErr.message });
    return [];
  }

  if (!sentEvents || sentEvents.length === 0) {
    return [];
  }

  // 2. Excluir eventos touch-2 ya registrados (son de campaign=lead-magnet-followup2,
  //    así que el filtro .like anterior ya los filtró del sentEvents, pero hay que
  //    buscarlos en el rango completo desde `since` para el skip-set).
  const leadIds = [...new Set(sentEvents.map((e) => e.lead_id))];

  const { data: laterEvents, error: laterErr } = await supabase
    .from('outreach_events')
    .select('lead_id, event_type, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .in('lead_id', leadIds)
    .gte('occurred_at', since);

  if (laterErr) {
    logger.warn('followup_touch2_cron: later events fetch failed — skipping skip-set', { err: laterErr.message });
  }

  // 3. Construir skip-set
  const skipSet = new Set();
  for (const ev of (laterEvents || [])) {
    if (['replied', 'bounced', 'mini_report_sent'].includes(ev.event_type)) {
      skipSet.add(ev.lead_id);
    }
    if (ev.event_type === 'sent' && ev.metadata?.followup_touch === 2) {
      skipSet.add(ev.lead_id);
    }
  }

  // 4. Seleccionar candidatos únicos no skipeados (más antiguos primero)
  const seen = new Set();
  const eligible = [];
  for (const e of sentEvents) {
    if (skipSet.has(e.lead_id) || seen.has(e.lead_id)) continue;
    seen.add(e.lead_id);
    eligible.push(e);
    if (eligible.length >= limit) break;
  }

  if (eligible.length === 0) {
    return [];
  }

  // 5. Hidratar con datos del lead
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, business_name, industry, metro_area, email_address, email, mega_profile')
    .in('id', eligible.map((e) => e.lead_id));

  if (leadsErr) {
    logger.error('followup_touch2_cron: leads hydration failed', { err: leadsErr.message });
    return [];
  }

  return eligible
    .map((e) => ({
      ...e,
      lead: (leads || []).find((l) => l.id === e.lead_id),
    }))
    .filter((c) => c.lead && c.lead.email_address);
}

// ── Email generation ─────────────────────────────────────────

/**
 * Genera el follow-up via Ángela (AgentRuntime). Devuelve { subject, body }.
 *
 * @param {AgentRuntime} runtime
 * @param {object} lead
 * @param {object} originalSent  — evento outreach_events del touch 1
 * @returns {Promise<{subject: string, body: string}>}
 */
async function generateFollowupEmail(runtime, lead, originalSent) {
  const audit = lead.mega_profile?.mini_audit;
  const primaryHallazgo = audit?.hallazgos?.[0];
  const originalSubject = originalSent.metadata?.subject || 'mi mensaje anterior';
  const daysAgo = Math.round(
    (Date.now() - new Date(originalSent.occurred_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const prompt = `Eres Ángela de Empírika. Hace ${daysAgo} días le mandaste un email frío al dueño de ${lead.business_name} (${lead.industry} en ${lead.metro_area}) con asunto "${originalSubject}" — pero no respondió.

EL PRIMER EMAIL CITABA: ${primaryHallazgo?.headline ?? 'un hallazgo de SEO de su negocio'}.
DETALLE: ${primaryHallazgo?.detail ?? 'oportunidad real en Google'}.

Ahora escribí un FOLLOW-UP súper corto en español:
1. Asunto: empezar con "Re:" del original O algo MUY corto tipo "¿lo viste?" (max 30 chars).
2. Cuerpo: 40-80 palabras MÁXIMO. Reconocer que mandaste antes, NO repetir todo el dato (asumí que ya lo leyó). Hacé un re-CTA suave: "¿Te lo mando igual?" o "¿lo querés ver?".
3. Tono: humano, casual, como si fuera un texto rápido. NO formal. Tuteá ("vos").
4. NO repitas TODOS los números del primer email. UNA mención corta máximo.
5. NO insistas con presión. Es un soft bump.
6. Firmá "Ángela · Empírika".

Devolvé SOLO JSON: { "subject": "...", "body": "..." }`;

  const result = await runtime.run('Angela', prompt, { maxIterations: 2 });
  const txt = result?.response || '';
  const match = txt.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no_json');
  const parsed = JSON.parse(match[0]);
  if (!parsed.subject || !parsed.body) throw new Error('missing_subject_or_body');
  return parsed;
}

// ── processOneLead ───────────────────────────────────────────

/**
 * Para un candidato: genera el follow-up, lo envía por SMTP y registra
 * el evento en outreach_events. Idempotente por metadata.followup_touch=2.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {AgentRuntime} runtime
 * @param {object} smtp  — nodemailer transporter
 * @param {object} candidate  — { id, lead_id, occurred_at, message_id, metadata, lead }
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function processOneLead(supabase, runtime, smtp, candidate) {
  const { lead, message_id: originalMessageId, id: originalEventId, occurred_at: originalOccurredAt } = candidate;
  const to = lead.email_address;

  const draft = await generateFollowupEmail(runtime, lead, candidate);

  // Subject: si Ángela no prefijó "Re:", lo prefijamos nosotros para agrupar en thread
  const originalSubject = candidate.metadata?.subject || '';
  let subject = draft.subject;
  if (!subject.toLowerCase().startsWith('re:')) {
    subject = `Re: ${originalSubject}`.trim();
  }

  const newMessageId = `<lm-fu2-${lead.id.slice(0, 8)}-${Date.now()}@empirikagroup.com>`;

  if (SELF_CHECK) {
    return {
      ok: true,
      dryRun: true,
      business: lead.business_name,
      to,
      subject,
      originalMessageId,
      daysAgo: Math.round((Date.now() - new Date(originalOccurredAt).getTime()) / (1000 * 60 * 60 * 24)),
    };
  }

  // SMTP send con In-Reply-To + References para que Gmail agrupe en el thread original
  await smtp.sendMail({
    from: `"${SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
    replyTo: REPLY_TO,
    to,
    subject,
    text: draft.body,
    messageId: newMessageId,
    headers: {
      'In-Reply-To': originalMessageId,
      'References': originalMessageId,
      'X-Empirika-Campaign': 'lead-magnet-followup2',
    },
  });

  // Registrar evento en outreach_events
  const { error: insertErr } = await supabase.from('outreach_events').insert({
    brand_id: BRAND_ID,
    lead_id: lead.id,
    channel: 'email',
    event_type: 'sent',
    message_id: newMessageId,
    occurred_at: new Date().toISOString(),
    metadata: {
      campaign: 'lead-magnet-followup2',
      followup_touch: 2,
      original_event_id: originalEventId,
      original_message_id: originalMessageId,
      to,
      subject,
      body_preview: draft.body.slice(0, 280),
    },
  });

  if (insertErr) {
    logger.warn('followup_touch2_cron: event insert failed (email already sent)', {
      lead_id: lead.id,
      err: insertErr.message,
    });
  }

  return { ok: true, business: lead.business_name, to, subject, messageId: newMessageId };
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * Un ciclo completo: verifica cap diario → selecciona candidatos → envía.
 *
 * @returns {Promise<{sent: number, skipped: number, errors: number, reason?: string}>}
 */
async function runCycle() {
  const supabase = buildSupabase();
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(angela);

  // Cap diario
  const sentToday = await countSentToday(supabase);
  const remaining = Math.max(0, DAILY_CAP - sentToday);

  if (remaining === 0) {
    logger.info('followup_touch2_cron: daily cap reached — skip cycle', { sentToday, dailyCap: DAILY_CAP });
    return { sent: 0, skipped: 0, errors: 0, reason: 'daily_cap_reached' };
  }

  const targetThisCycle = Math.min(BATCH_SIZE, remaining);
  const candidates = await pickCandidates(supabase, targetThisCycle);

  logger.info('followup_touch2_cron: cycle start', {
    sentToday,
    dailyCap: DAILY_CAP,
    remaining,
    batchSize: targetThisCycle,
    candidates: candidates.length,
  });

  if (candidates.length === 0) {
    logger.info('followup_touch2_cron: cycle done', { sent: 0, skipped: 0, errors: 0, reason: 'no_candidates' });
    return { sent: 0, skipped: 0, errors: 0, reason: 'no_candidates' };
  }

  const smtp = buildSmtp();
  if (!SELF_CHECK) await smtp.verify();

  let sent = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      const r = await processOneLead(supabase, runtime, smtp, candidate);
      if (r.ok) {
        sent++;
        logger.info('followup_touch2_cron: sent', {
          business: r.business,
          to: r.to,
          subject: r.subject,
          dryRun: r.dryRun ?? false,
          originalMessageId: candidate.message_id,
        });
      }
    } catch (err) {
      errors++;
      logger.warn('followup_touch2_cron: lead failed', {
        lead_id: candidate.lead_id,
        business: candidate.lead?.business_name,
        err: err.message,
      });
    }
    if (PACE_MS > 0 && sent + errors < candidates.length) await sleep(PACE_MS);
  }

  logger.info('followup_touch2_cron: cycle done', { sent, errors });
  return { sent, errors, skipped: 0 };
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  logger.info('followup_touch2_cron starting', {
    selfCheck: SELF_CHECK,
    batchSize: BATCH_SIZE,
    dailyCap: DAILY_CAP,
    minAgeH: MIN_AGE_H,
    maxAgeD: MAX_AGE_D,
  });
  const result = await runCycle();
  logger.info('followup_touch2_cron: done', result);
  if (SELF_CHECK) process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('followup_touch2_cron fatal', err);
    process.exit(1);
  });
}

export { runCycle, pickCandidates, generateFollowupEmail };
