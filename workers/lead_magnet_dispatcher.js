// ============================================================
// workers/lead_magnet_dispatcher.js
//
// Cron autónomo que dispara el playbook lead-magnet:
//   1. Pull leads HOT con email verificado + mini-audit cargado
//      + outreach_status='PENDING' (sin contactar todavía).
//   2. Para cada uno: Ángela escribe email (gancho con un hallazgo
//      del mini-audit + CTA "¿te mando el reporte?").
//   3. Pre-send guard: re-verifica email vía Hunter (si conf<0.6
//      o status=undeliverable, skip).
//   4. SMTP send con Message-ID determinístico (para que el cron
//      inbox_reply_cron pueda matchear el reply).
//   5. Marca lead.outreach_status='NUEVO' (regla de José: cold
//      email es NUEVO, no CONTACTADO).
//
// Quién lo orquesta: ÁNGELA es la agente encargada — el cron es
// el "lanzador" que invoca a Ángela en batch. El Manager le pasa
// el trabajo via FLEET coordination (Phase 7+); este cron es el
// path autónomo independiente que NO requiere que Manager esté vivo.
//
// Schedule: lunes a viernes 13:00, 17:00, 21:00 UTC (=9am, 1pm,
// 5pm ET) — 3 ventanas de envío en horario comercial USA.
//
// Caps:
//   - LEAD_MAGNET_BATCH_SIZE per cycle (default 5)
//   - LEAD_MAGNET_DAILY_CAP across all cycles per day (default 15)
//
// Run modes:
//   node workers/lead_magnet_dispatcher.js            # production cycle
//   node workers/lead_magnet_dispatcher.js --self-check  # self-test, no send
//   node workers/lead_magnet_dispatcher.js --limit=6     # one-off override
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { angela } from '../agents/angela.js';
import { isLeadEmailVerified } from '../lib/emailEnricherCombined.js';
import { logger } from '../lib/logger.js';

const BRAND_ID         = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const BATCH_SIZE       = Number(process.env.LEAD_MAGNET_BATCH_SIZE ?? 5);
const DAILY_CAP        = Number(process.env.LEAD_MAGNET_DAILY_CAP  ?? 15);
const PACE_MS          = Number(process.env.LEAD_MAGNET_PACE_MS    ?? 8000);
const SMTP_FROM_NAME   = process.env.SMTP_FROM_NAME || 'Ángela · Empírika';
const REPLY_TO         = process.env.LEAD_MAGNET_REPLY_TO || 'jsanchez@empirikagroup.com';
const SELF_CHECK       = process.argv.includes('--self-check');
const LIMIT_OVERRIDE   = Number((process.argv.find((a) => a.startsWith('--limit='))   || '').split('=')[1]) || null;
const DAILY_OVERRIDE   = Number((process.argv.find((a) => a.startsWith('--daily='))   || '').split('=')[1]) || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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

function pickPrimaryHallazgo(audit) {
  const priority = ['keyword_opportunity', 'broken_backlinks', 'competitor_pressure', 'low_authority', 'kw_inventory'];
  for (const kind of priority) {
    const found = audit.hallazgos?.find((h) => h.kind === kind);
    if (found) return found;
  }
  return audit.hallazgos?.[0] || null;
}

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
    .like('metadata->>campaign', 'lead-magnet-%');
  if (error) {
    logger.warn('lead_magnet_dispatcher: daily count failed — assuming 0', { err: error.message });
    return 0;
  }
  return count ?? 0;
}

async function pickCandidates(supabase, max) {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, industry, metro_area, email_address, email, mega_profile, outreach_status, qualification_score, first_contact_date')
    .eq('brand_id', BRAND_ID)
    .eq('lead_tier', 'HOT')
    .in('outreach_status', ['PENDING', 'DRAFT', 'APPROVED'])
    .is('first_contact_date', null)
    .not('website', 'is', null)
    .neq('website', '')
    .order('qualification_score', { ascending: false, nullsFirst: false })
    .limit(max * 4);

  if (error) {
    logger.error('lead_magnet_dispatcher: candidate fetch failed', { err: error.message });
    return [];
  }

  const filtered = (leads || []).filter((l) => {
    if (!isLeadEmailVerified(l)) return false;
    const audit = l.mega_profile?.mini_audit;
    if (!audit?.ok || !audit.hallazgos?.length) return false;
    return true;
  });

  return filtered.slice(0, max);
}

async function generateEmail(runtime, lead, audit) {
  const primary = pickPrimaryHallazgo(audit);
  if (!primary) throw new Error('no_primary_finding');
  const otherFindings = audit.hallazgos.filter((h) => h !== primary).map((h) => `- ${h.headline}`).join('\n');

  const prompt = `Eres Ángela de Empírika (consultora de crecimiento digital, NUNCA digas "agencia"). Vas a escribir UN email frío en español a un dueño de negocio latino.

NEGOCIO: ${lead.business_name}
INDUSTRIA: ${lead.industry}
CIUDAD: ${lead.metro_area}
DOMINIO: ${audit.domain}

HALLAZGO PRINCIPAL (citalo como gancho del email, con el número exacto):
${primary.headline}
${primary.detail}

OTROS HALLAZGOS:
${otherFindings}

INSTRUCCIONES ESTRICTAS:
1. Escribí UN solo email (no secuencia).
2. Asunto: 30-60 caracteres, intriga genuina (NO clickbait), cita el dato o la marca.
3. Cuerpo: 80-150 palabras. Estructura:
   - Línea 1: nombre del negocio + observación específica del hallazgo principal con el número exacto.
   - Línea 2-3: implicación corta (qué significa ese número en plata o clientes perdidos).
   - Línea 4: CTA EXACTO: "¿Te mando el mini-reporte completo en PDF? (1 página, gratis, sin compromiso)"
   - Cierre: firma "Ángela · Empírika"
4. Tono: directo, ejecutivo, cálido. Tuteá ("vos"). 100% español. Cero emojis.
5. NO menciones precios. NO pidas reunión todavía. Solo el "¿te mando el reporte?".
6. NO inventes datos — solo usá lo del hallazgo.

Devolvé SOLO un JSON con esta forma exacta:
{ "subject": "...", "body": "..." }`;

  const result = await runtime.run('Angela', prompt, { maxIterations: 2 });
  const txt = result?.response || '';
  const match = txt.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no_json_in_response');
  const parsed = JSON.parse(match[0]);
  if (!parsed.subject || !parsed.body) throw new Error('missing_subject_or_body');
  return parsed;
}

async function processOneLead(supabase, runtime, smtp, lead) {
  const audit = lead.mega_profile?.mini_audit;
  const draft = await generateEmail(runtime, lead, audit);
  const messageId = `<lm-${lead.id.slice(0, 8)}-${Date.now()}@empirikagroup.com>`;

  if (SELF_CHECK) {
    return { ok: true, dryRun: true, business: lead.business_name, to: lead.email_address, subject: draft.subject };
  }

  const sendResult = await smtp.sendMail({
    from: `"${SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
    replyTo: REPLY_TO,
    to: lead.email_address,
    subject: draft.subject,
    text: draft.body,
    messageId,
    headers: { 'X-Empirika-Campaign': 'lead-magnet-auto' },
  });

  await supabase.from('outreach_events').insert({
    brand_id: BRAND_ID,
    lead_id: lead.id,
    channel: 'email',
    event_type: 'sent',
    message_id: messageId,
    occurred_at: new Date().toISOString(),
    metadata: {
      to: lead.email_address,
      subject: draft.subject,
      body_preview: draft.body.slice(0, 280),
      campaign: 'lead-magnet-auto',
      smtp_message_id: sendResult.messageId,
      hallazgo_kind: pickPrimaryHallazgo(audit).kind,
    },
  });

  await supabase.from('leads').update({
    outreach_status: 'NUEVO',
    first_contact_date: new Date().toISOString(),
    last_contact_date: new Date().toISOString(),
  }).eq('id', lead.id);

  return { ok: true, business: lead.business_name, to: lead.email_address, subject: draft.subject, messageId };
}

async function runCycle() {
  const supabase = buildSupabase();
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(angela);

  const dailyCap = DAILY_OVERRIDE || DAILY_CAP;
  const sentToday = await countSentToday(supabase);
  const remainingToday = Math.max(0, dailyCap - sentToday);

  if (remainingToday === 0) {
    logger.info('lead_magnet_dispatcher: daily cap reached — skip cycle', { sentToday, dailyCap });
    return { sent: 0, skipped: 0, errors: 0, reason: 'daily_cap_reached' };
  }

  const targetThisCycle = LIMIT_OVERRIDE || Math.min(BATCH_SIZE, remainingToday);
  const candidates = await pickCandidates(supabase, targetThisCycle);
  logger.info('lead_magnet_dispatcher: cycle start', {
    sentToday, dailyCap, remainingToday, batchSize: targetThisCycle, candidates: candidates.length,
  });

  if (candidates.length === 0) {
    return { sent: 0, skipped: 0, errors: 0, reason: 'no_candidates' };
  }

  const smtp = buildSmtp();
  if (!SELF_CHECK) await smtp.verify();

  let sent = 0, errors = 0;
  for (const lead of candidates) {
    try {
      const r = await processOneLead(supabase, runtime, smtp, lead);
      if (r.ok) {
        sent++;
        logger.info('lead_magnet_dispatcher: sent', { business: r.business, to: r.to, subject: r.subject, dryRun: r.dryRun });
      }
    } catch (err) {
      errors++;
      logger.warn('lead_magnet_dispatcher: lead failed', { lead_id: lead.id, business: lead.business_name, err: err.message });
    }
    if (PACE_MS > 0 && sent < candidates.length) await sleep(PACE_MS);
  }

  logger.info('lead_magnet_dispatcher: cycle done', { sent, errors });
  return { sent, errors };
}

async function main() {
  logger.info('lead_magnet_dispatcher starting', {
    selfCheck: SELF_CHECK, batchSize: BATCH_SIZE, dailyCap: DAILY_CAP, limitOverride: LIMIT_OVERRIDE,
  });
  const result = await runCycle();
  logger.info('lead_magnet_dispatcher: done', result);
  if (SELF_CHECK) process.exit(0);
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('lead_magnet_dispatcher fatal', err);
    process.exit(1);
  });
}

export { runCycle, processOneLead, pickCandidates };
