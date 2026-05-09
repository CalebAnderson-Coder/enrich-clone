// ============================================================
// scripts/send_first_batch_lead_magnet.js
//
// Envío puntual del primer batch con el playbook de lead magnet
// (mini-audit DataForSEO como gancho + CTA "¿te mando el reporte?").
//
// NO usa el flow completo del dispatcher (campaign_enriched_data +
// magnet) — ese es para campañas con visual mockup. Acá vamos
// directo: gancho personalizado del mini-audit + 1 email + log.
//
// Cuando los leads respondan, los crons inbox_reply + reply_to_report
// que ya están en producción cierran el loop automáticamente.
//
// Run: node scripts/send_first_batch_lead_magnet.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { angela } from '../agents/angela.js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'Ángela · Empírika';
const REPLY_TO = 'jsanchez@empirikagroup.com';
const TARGET_LEAD_IDS = [
  '234a321d-0a3e-4857-8048-245b4bbb6427', // Del Sol Roofing
  'ad72129e-cd6f-436a-97b8-679c3f910a9b', // Pillar Plumbing
  '8921f5b8-c0d5-41d9-a60a-d85695cd9253', // Tony's Plumbing
  'd8894976-7f90-4557-8a36-d7ee5420c5b8', // Remart Construction
];

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
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
  // Priorizar keyword_opportunity (más accionable + cita un número)
  const priority = ['keyword_opportunity', 'broken_backlinks', 'competitor_pressure', 'low_authority', 'kw_inventory'];
  for (const kind of priority) {
    const found = audit.hallazgos?.find((h) => h.kind === kind);
    if (found) return found;
  }
  return audit.hallazgos?.[0] || null;
}

async function generateEmail(runtime, lead, audit) {
  const primary = pickPrimaryHallazgo(audit);
  if (!primary) throw new Error('no_primary_finding');

  const otherFindings = audit.hallazgos
    .filter((h) => h !== primary)
    .map((h) => `- ${h.headline}`)
    .join('\n');

  const prompt = `Eres Ángela de Empírika (consultora de crecimiento digital, NUNCA digas "agencia"). Vas a escribir UN email frío en español a un dueño de negocio latino.

NEGOCIO: ${lead.business_name}
INDUSTRIA: ${lead.industry}
CIUDAD: ${lead.metro_area}
DOMINIO: ${audit.domain}

HALLAZGO PRINCIPAL (citalo como gancho del email, con el número exacto):
${primary.headline}
${primary.detail}

OTROS HALLAZGOS (para contexto, podés mencionar 1 más si suma):
${otherFindings}

INSTRUCCIONES ESTRICTAS:
1. Escribí UN solo email (no secuencia).
2. Asunto: 30-60 caracteres, intriga genuina (NO clickbait), cita el dato o la marca del negocio.
3. Cuerpo: 80-150 palabras. Estructura:
   - Línea 1: nombre del negocio + observación específica del hallazgo principal con el número exacto.
   - Línea 2-3: implicación corta (qué significa ese número en plata o en clientes perdidos).
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

async function processOneLead(supabase, runtime, smtp, leadId) {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, business_name, industry, metro_area, email_address, email, mega_profile, outreach_status')
    .eq('id', leadId)
    .single();

  if (leadErr || !lead) return { ok: false, leadId, reason: 'lead_not_found' };
  if (!lead.email_address) return { ok: false, leadId, reason: 'no_email' };

  const audit = lead.mega_profile?.mini_audit;
  if (!audit?.ok || !audit.hallazgos?.length) return { ok: false, leadId, reason: 'no_audit' };

  const draft = await generateEmail(runtime, lead, audit);

  // Build deterministic Message-ID so the inbox_reply_cron can match the
  // reply later. Domain part = our SMTP_USER's domain.
  const messageId = `<lm-${leadId.slice(0, 8)}-${Date.now()}@empirikagroup.com>`;

  const sendResult = await smtp.sendMail({
    from: `"${SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
    replyTo: REPLY_TO,
    to: lead.email_address,
    subject: draft.subject,
    text: draft.body,
    messageId,
    headers: { 'X-Empirika-Campaign': 'lead-magnet-batch-1' },
  });

  // Log outreach_event so reply matching works
  const sentEvent = {
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
      campaign: 'lead-magnet-batch-1',
      smtp_message_id: sendResult.messageId,
      hallazgo_kind: pickPrimaryHallazgo(audit).kind,
    },
  };
  await supabase.from('outreach_events').insert(sentEvent);

  // Stage the lead — cold email → NUEVO (no CONTACTADO, José rule)
  await supabase.from('leads')
    .update({
      outreach_status: 'NUEVO',
      first_contact_date: lead.first_contact_date || new Date().toISOString(),
      last_contact_date: new Date().toISOString(),
    })
    .eq('id', lead.id);

  return {
    ok: true, leadId, business: lead.business_name, to: lead.email_address,
    subject: draft.subject, body: draft.body, messageId,
  };
}

async function main() {
  logger.info('First batch — lead magnet outreach starting', { count: TARGET_LEAD_IDS.length });

  const supabase = buildSupabase();
  const smtp = buildSmtp();
  const runtime = new AgentRuntime({
    apiKey: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-3.1-70b-instruct',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  runtime.registerAgent(angela);

  await smtp.verify();
  console.log('SMTP verified ✓');
  console.log('');

  const results = [];
  for (const leadId of TARGET_LEAD_IDS) {
    try {
      const r = await processOneLead(supabase, runtime, smtp, leadId);
      results.push(r);
      if (r.ok) {
        console.log(`✓ ${r.business}`);
        console.log(`  → ${r.to}`);
        console.log(`  asunto: ${r.subject}`);
        console.log(`  cuerpo (${r.body.length} chars): ${r.body.slice(0, 200)}...`);
        console.log('');
      } else {
        console.log(`✗ ${r.leadId} — ${r.reason}`);
        console.log('');
      }
    } catch (err) {
      results.push({ ok: false, leadId, reason: err.message });
      console.log(`✗ ${leadId} — error: ${err.message}`);
      console.log('');
    }
  }

  const sent = results.filter((r) => r.ok).length;
  console.log('=== TOTALES ===');
  console.log(`Enviados: ${sent}/${TARGET_LEAD_IDS.length}`);
  console.log(`Fallidos: ${TARGET_LEAD_IDS.length - sent}`);
}

main().catch((err) => {
  logger.error('first batch fatal', err);
  process.exit(1);
});
