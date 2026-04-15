/**
 * regenerate_spanish_drafts.js (ESM)
 * ───────────────────────────────────
 * Regenerates outreach drafts in SPANISH for all leads that have
 * English drafts, no drafts, or empty copy.
 *
 * Usage: node regenerate_spanish_drafts.js
 */

import 'dotenv/config';
import { createClient }      from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const sb    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ── Config ──────────────────────────────────────────────────────────────────
const BATCH_SIZE = 4;
const DELAY_MS   = 2500;
const MAX_LEADS  = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function detectSpanish(text) {
  if (!text || text.length < 20) return false;
  const spanishSignals = [
    /\bHola\b/i, /\bEstimad[oa]\b/i, /\bGracias\b/i, /\bSaludos\b/i,
    /\bNegocio\b/i, /\bServicios\b/i, /\bAtentamente\b/i,
    /\bCordialmente\b/i, /\bPresencia\b/i,
    /\bCrecer\b/i, /\bpágina\b/i, /\bnegocio\b/i, /\bclientes\b/i,
    /\bdiseñ[éo]\b/i, /\bgratis\b/i, /\bprofesional\b/i,
  ];
  const hits = spanishSignals.filter(r => r.test(text)).length;
  return hits >= 2;
}

const ANGELA_SYSTEM = `Eres Ángela Rodríguez, Estratega de Crecimiento en Empírika Digital.
Escribes correos de outreach frío a dueños de negocios de servicios latinos en Florida y Texas.

REGLA DE HIERRO — CERO EXCEPCIONES: Cada palabra debe estar en ESPAÑOL.
Nada de inglés. Nada de Spanglish. Nada de mezcla bilingüe.
Los dueños de negocios latinos responden mucho mejor al outreach en español.

Escribe como una persona real que genuinamente notó algo valioso sobre su negocio.
Usa "tú" (informal pero respetuoso). Tono cálido, profesional, cercano.`;

async function generateSpanishDraft(lead) {
  const mega       = lead.mega_profile || {};
  const painPoints = mega.pain_points || 'su presencia online podría traerles más clientes';
  const situation  = mega.situational_summary || '';
  const biz        = lead.business_name;
  const city       = lead.metro_area || lead.city || 'Florida';
  const industry   = lead.industry   || 'servicios para el hogar';
  const rating     = lead.rating     ? `${lead.rating}⭐` : '';
  const reviews    = lead.review_count ? `(${lead.review_count} reseñas)` : '';
  const website    = lead.website    || null;

  const userPrompt = `Escribe un correo de outreach frío para este prospecto. TODAS LAS PALABRAS EN ESPAÑOL:

Negocio: ${biz}
Ciudad: ${city}
Industria: ${industry}
${website  ? `Sitio web: ${website}` : 'Sitio web: no tiene — este es un hook fuerte'}
${rating   ? `Calificación Google: ${rating} ${reviews}` : ''}
${situation ? `Contexto: ${situation}` : ''}
${painPoints ? `Punto de dolor: ${painPoints}` : ''}

Requisitos:
- Línea de asunto: máximo 50 caracteres, curiosidad + beneficio
- 3-4 párrafos, ~150 palabras en total
- Menciona algo específico: su ciudad, nicho, calificación en Google, o falta de sitio web
- Propuesta de valor: Empírika Digital ayuda a negocios de servicios latinos en EE.UU. a crecer online y conseguir más clientes
- Un CTA claro: agendar una llamada de descubrimiento gratuita de 15 min
- Cierre profesional + línea PS con urgencia

Escribe SOLO el correo. Formato:

Asunto: [asunto aquí]

[Cuerpo del email]

Un abrazo,
Ángela Rodríguez
Estratega de Crecimiento | Empírika Digital
angela@empirika.digital

P.D. [línea PS]`;

  const chat = model.startChat({
    history: [
      { role: 'user',  parts: [{ text: ANGELA_SYSTEM }] },
      { role: 'model', parts: [{ text: 'Entendido completamente. Voy a escribir cada correo 100% en español, como Ángela Rodríguez de Empírika Digital.' }] },
    ],
  });

  const result = await chat.sendMessage(userPrompt);
  return result.response.text().trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  SPANISH DRAFT REGENERATION ENGINE  — Empírika Digital   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // 1. Fetch leads
  const { data: allLeads, error: leadsErr } = await sb
    .from('leads')
    .select('id, business_name, metro_area, city, industry, website, phone, email, rating, review_count, mega_profile')
    .order('created_at', { ascending: false })
    .limit(MAX_LEADS + 20);

  if (leadsErr) { console.error('❌ Error fetching leads:', leadsErr.message); process.exit(1); }
  console.log(`📋 Total leads: ${allLeads.length}`);

  // 2. Fetch existing campaigns
  const { data: allCamps } = await sb
    .from('campaign_enriched_data')
    .select('prospect_id, outreach_copy, status, id')
    .in('prospect_id', allLeads.map(l => l.id));

  const campMap = {};
  (allCamps || []).forEach(c => { campMap[c.prospect_id] = c; });

  // 3. Classify leads that need Spanish regeneration
  const targets = [];
  for (const lead of allLeads) {
    const camp = campMap[lead.id];
    if (!camp)                                    targets.push({ lead, reason: 'SIN_CAMPAÑA' });
    else if (!camp.outreach_copy)                 targets.push({ lead, reason: 'SIN_COPY' });
    else if (!detectSpanish(camp.outreach_copy))  targets.push({ lead, reason: 'DRAFT_EN_INGLÉS' });
    if (targets.length >= MAX_LEADS) break;
  }

  const counts = targets.reduce((a, { reason }) => ({ ...a, [reason]: (a[reason]||0)+1 }), {});
  console.log(`\n🎯 Leads que necesitan drafts en español: ${targets.length}`);
  Object.entries(counts).forEach(([k, v]) => console.log(`   • ${k}: ${v}`));

  if (targets.length === 0) {
    console.log('\n✅ ¡Todos los leads ya tienen drafts en español! Dashboard listo.\n');
    return;
  }
  console.log();

  // 4. Process in batches
  let succeeded = 0, failed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch      = targets.slice(i, i + BATCH_SIZE);
    const batchNum   = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatch = Math.ceil(targets.length / BATCH_SIZE);
    console.log(`⚡ Lote ${batchNum}/${totalBatch} — ${batch.length} leads`);

    const results = await Promise.allSettled(
      batch.map(async ({ lead, reason }) => {
        try {
          const draft = await generateSpanishDraft(lead);
          if (!draft || draft.length < 80) throw new Error('Draft muy corto');
          if (!detectSpanish(draft))       throw new Error('Verificación de idioma FALLÓ — no es español');

          const camp = campMap[lead.id];
          let dbErr;

          if (camp) {
            const { error } = await sb
              .from('campaign_enriched_data')
              .update({ outreach_copy: draft, status: 'DRAFT' })
              .eq('prospect_id', lead.id);
            dbErr = error;
          } else {
            const { error } = await sb
              .from('campaign_enriched_data')
              .insert({
                prospect_id:   lead.id,
                outreach_copy: draft,
                status:        'DRAFT',
                attack_angle:  lead.mega_profile?.pain_points || 'Presencia digital y generación de clientes online',
              });
            dbErr = error;
          }

          if (dbErr) throw new Error(`DB: ${dbErr.message}`);

          const preview = draft.split('\n')[0].slice(0, 55);
          console.log(`  ✅ ${lead.business_name.padEnd(38)} "${preview}..."`);
          return { ok: true };
        } catch (err) {
          console.error(`  ❌ ${lead.business_name.padEnd(38)} → ${err.message.slice(0, 65)}`);
          return { ok: false };
        }
      })
    );

    results.forEach(r => r.status === 'fulfilled' && r.value.ok ? succeeded++ : failed++);

    if (i + BATCH_SIZE < targets.length) {
      process.stdout.write(`  ⏳ Pausa de rate limit ${DELAY_MS}ms...\n`);
      await sleep(DELAY_MS);
    }
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  ✅ ${succeeded}/${targets.length} drafts en español generados y guardados          `);
  if (failed > 0)
  console.log(`║  ❌ ${failed} fallaron (revisa los logs arriba)                          `);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });
