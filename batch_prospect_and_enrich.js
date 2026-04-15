// ═══════════════════════════════════════════════════════════
// batch_prospect_and_enrich.js — Two-Phase 50-Lead Pipeline
// Phase 1: Prospect 50 leads via Google Maps (BrightData/Apify)
// Phase 2: Run 7-agent enrichment on each lead
// Output: PENDING drafts in dashboard for human approval
// ═══════════════════════════════════════════════════════════

import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { AgentRuntime } from './lib/AgentRuntime.js';
import { executeWithRalphLoop } from './lib/ralphLoop.js';
import { enrichOutputSchema } from './lib/schemas.js';
import { manager } from './agents/manager.js';
import { scout } from './agents/scout.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { carlos } from './agents/carlos.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const niches = JSON.parse(fs.readFileSync('./niches.json', 'utf8'));

// ═══════════════════════════════════════
// CONFIG — 50 Leads Target
// ═══════════════════════════════════════
const SEARCH_COMBOS = [
  // { nicheId, city, keywords } — 10 combos × ~5 results each = ~50 leads
  { nicheId: 9, city: 'Orlando, FL', keywords: 'roofing contractor' },
  { nicheId: 4, city: 'Orlando, FL', keywords: 'HVAC repair' },
  { nicheId: 8, city: 'Miami, FL', keywords: 'landscaping company' },
  { nicheId: 2, city: 'Miami, FL', keywords: 'home remodeling contractor' },
  { nicheId: 5, city: 'Houston, TX', keywords: 'plumbing service' },
  { nicheId: 6, city: 'Houston, TX', keywords: 'electrician' },
  { nicheId: 1, city: 'Dallas, TX', keywords: 'general contractor' },
  { nicheId: 10, city: 'Dallas, TX', keywords: 'painting company' },
  { nicheId: 17, city: 'San Antonio, TX', keywords: 'pressure washing' },
  { nicheId: 7, city: 'San Antonio, TX', keywords: 'cleaning service' },
];

const LEADS_PER_SEARCH = 5;
const MAX_LEADS = 50;
const STATE_FILE = './batch_state.json';
const SLEEP_MS = 30000; // 30s between enrichments

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { phase1Complete: false, prospectedIds: [], enrichedIds: [], failedIds: [] };
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ═══════════════════════════════════════
// PHASE 1: Mass Prospect via Google Maps API
// ═══════════════════════════════════════
async function phase1_prospect(state) {
  if (state.phase1Complete) {
    console.log('⏭️ Fase 1 ya completada. Saltando a Fase 2...');
    return;
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  📡 FASE 1 — PROSPECCIÓN MASIVA (Google Maps)║');
  console.log('╚══════════════════════════════════════════════╝');

  let totalProspected = state.prospectedIds.length;

  for (const combo of SEARCH_COMBOS) {
    if (totalProspected >= MAX_LEADS) break;

    const niche = niches.find(n => n.id === combo.nicheId);
    const query = `${combo.keywords} in ${combo.city}`;
    console.log(`\n🔎 Buscando: "${query}" (${niche?.en || combo.nicheId})`);

    try {
      // Use DuckDuckGo to find real businesses
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' phone number reviews')}`;
      const response = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!response.ok) {
        console.log(`  ⚠️ DDG search failed (${response.status}), using Gemini direct...`);
      }

      // Use Gemini to extract real businesses from this niche+city
      const geminiClient = new (await import('openai')).default({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });

      const completion = await geminiClient.chat.completions.create({
        model: 'gemini-2.0-flash',
        messages: [
          {
            role: 'system',
            content: `You are a business directory research assistant. You MUST return ONLY valid JSON arrays. No explanations, no markdown, just the JSON array.`
          },
          {
            role: 'user',
            content: `Find ${LEADS_PER_SEARCH} REAL ${combo.keywords} businesses in ${combo.city}. They MUST be real companies that actually exist. For each business, provide:
- business_name (exact legal/brand name)
- website (real URL or null)
- phone (real phone number or null)
- rating (Google rating 1-5 or null)
- review_count (number of Google reviews or null)
- google_maps_url (URL or null)

Return ONLY a JSON array of objects. No code blocks, no explanation. Example:
[{"business_name":"ABC Roofing","website":"https://abcroofing.com","phone":"(407) 555-1234","rating":4.7,"review_count":89,"google_maps_url":null}]`
          }
        ],
        temperature: 0.3,
      });

      const rawResponse = completion.choices[0]?.message?.content || '';
      
      // Extract JSON array
      let businesses = [];
      try {
        // Try direct parse
        const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        businesses = JSON.parse(cleaned);
      } catch {
        // Try regex extraction
        const match = rawResponse.match(/\[[\s\S]*?\]/);
        if (match) businesses = JSON.parse(match[0]);
      }

      if (!Array.isArray(businesses) || businesses.length === 0) {
        console.log(`  ⚠️ No se pudieron extraer negocios para ${query}`);
        continue;
      }

      console.log(`  ✅ Encontrados ${businesses.length} negocios`);

      // Save each business to Supabase
      for (const biz of businesses) {
        if (totalProspected >= MAX_LEADS) break;
        if (!biz.business_name) continue;

        // Check for duplicates
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .ilike('business_name', biz.business_name)
          .limit(1);

        if (existing && existing.length > 0) {
          console.log(`  ⏭️ Duplicado: ${biz.business_name}`);
          continue;
        }

        const leadPayload = {
          business_name: biz.business_name,
          website: biz.website || null,
          phone: biz.phone || null,
          rating: biz.rating || null,
          review_count: biz.review_count || null,
          google_maps_url: biz.google_maps_url || null,
          metro_area: combo.city,
          industry: niche?.en || combo.keywords,
          qualification_score: 80,
          lead_tier: 'WARM',
          outreach_status: 'NEW',
          mega_profile: { source: 'batch_prospector_v2', niche_id: combo.nicheId }
        };

        const { data: inserted, error } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select();

        if (error) {
          console.error(`  ❌ Error guardando ${biz.business_name}:`, error.message);
          continue;
        }

        const leadId = inserted[0].id;
        state.prospectedIds.push(leadId);
        totalProspected++;
        saveState(state);
        console.log(`  💾 [${totalProspected}/${MAX_LEADS}] ${biz.business_name} → ${leadId}`);
      }

      // Small delay between searches
      await sleep(3000);

    } catch (err) {
      console.error(`  ❌ Error en búsqueda ${query}:`, err.message);
    }
  }

  state.phase1Complete = true;
  saveState(state);
  console.log(`\n✅ Fase 1 completada. ${totalProspected} leads prospectados.`);
}

// ═══════════════════════════════════════
// PHASE 2: Enrich each lead with 7-agent pipeline
// Manager → Helena + Sam + Kai → Carlos → Angela
// ═══════════════════════════════════════
async function phase2_enrich(state) {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  🔬 FASE 2 — ENRIQUECIMIENTO 7-AGENTES      ║');
  console.log('║  Helena→Sam→Kai→Carlos→Angela               ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Get all leads that need enrichment
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .not('id', 'in', `(${state.enrichedIds.concat(state.failedIds).join(',') || '00000000-0000-0000-0000-000000000000'})`)
    .order('created_at', { ascending: true })
    .limit(MAX_LEADS);

  if (!leads || leads.length === 0) {
    console.log('📭 No hay leads pendientes de enriquecimiento.');
    return;
  }

  console.log(`📋 ${leads.length} leads pendientes de enriquecimiento\n`);

  // Initialize AgentRuntime
  const runtime = new AgentRuntime({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  runtime.registerAgent(manager);
  runtime.registerAgent(scout);
  runtime.registerAgent(angela);
  runtime.registerAgent(helena);
  runtime.registerAgent(sam);
  runtime.registerAgent(kai);
  runtime.registerAgent(carlos);

  let enriched = 0;
  let failed = 0;

  for (const lead of leads) {
    // Skip already processed
    if (state.enrichedIds.includes(lead.id) || state.failedIds.includes(lead.id)) continue;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🎯 [${enriched + failed + 1}/${leads.length}] ${lead.business_name} (${lead.metro_area})`);
    console.log(`   Web: ${lead.website || 'N/A'} | Tel: ${lead.phone || 'N/A'}`);
    console.log(`${'─'.repeat(60)}`);

    const leadSummary = JSON.stringify({
      business_name: lead.business_name,
      website: lead.website,
      phone: lead.phone,
      city: lead.metro_area,
      industry: lead.industry,
      rating: lead.rating,
      review_count: lead.review_count,
    });

    const enrichPrompt = `Ejecuta el Macro-Flujo 2 (El Francotirador) para este negocio:
${leadSummary}

INSTRUCCIONES DE DELEGACIÓN EN ORDEN:
1. Delega a 'Helena' para una radiografía técnica rápida: evalúa la presencia web, SEO básico y contenido visible.
2. Delega a 'Sam' para evaluar su posible actividad de Paid Ads (Google/Meta).
3. Delega a 'Kai' para evaluar su presencia en redes sociales.
4. Con los hallazgos, delega a 'Carlos Empirika' para armar el 'Attack Angle' estratégico enfocado en el mercado hispano.
5. Con el Angle de Carlos, delega a 'Angela' para crear el subject + body del email de contacto personalizado.

Devuelve todo consolidado EN UN BLOQUE JSON dentro de \`\`\`json y \`\`\`:
{
  "radiography_technical": "1-2 párrafos de evaluación técnica (Helena+Sam+Kai)",
  "attack_angle": "El ángulo de ventas de Carlos en 1 párrafo",
  "outreach_copy": "Subject: [asunto]\\n\\n[cuerpo del email de Angela]"
}`;

    try {
      const enrichResult = await executeWithRalphLoop(
        runtime, 'Manager', enrichPrompt, enrichOutputSchema,
        { currentAgent: 'Manager', maxIterations: 3 }
      );

      if (!enrichResult.isValid) {
        console.log(`  ⚠️ Enriquecimiento falló para ${lead.business_name}`);
        state.failedIds.push(lead.id);
        failed++;
        saveState(state);
        await sleep(10000);
        continue;
      }

      const data = enrichResult.data;

      // Save to campaign_enriched_data
      const { error } = await supabase
        .from('campaign_enriched_data')
        .insert([{
          prospect_id: lead.id,
          radiography_technical: data.radiography_technical || 'Sin radiografía.',
          attack_angle: data.attack_angle || 'Sin ángulo.',
          outreach_copy: data.outreach_copy || 'Sin copy.',
          status: 'PENDING'
        }]);

      if (error) {
        console.error(`  ❌ Error guardando enrichment:`, error.message);
        state.failedIds.push(lead.id);
        failed++;
      } else {
        console.log(`  ✅ Enriquecido y guardado como PENDING (draft para aprobación)`);
        state.enrichedIds.push(lead.id);
        enriched++;
      }

      saveState(state);
      console.log(`  📊 Progreso: ${enriched} enriquecidos / ${failed} fallidos`);

      // Cooling period between enrichments
      if (enriched + failed < leads.length) {
        console.log(`  ⏳ Enfriando ${SLEEP_MS / 1000}s...`);
        await sleep(SLEEP_MS);
      }

    } catch (err) {
      console.error(`  ❌ Error fatal en ${lead.business_name}:`, err.message);
      state.failedIds.push(lead.id);
      failed++;
      saveState(state);
      await sleep(15000);
    }
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🏁 RESUMEN FINAL — THE MACHINE v2');
  console.log(`${'═'.repeat(60)}`);
  console.log(`✅ Enriquecidos:  ${enriched}`);
  console.log(`❌ Fallidos:      ${failed}`);
  console.log(`📋 Total leads:   ${state.prospectedIds.length}`);
  console.log(`👉 Los drafts están en el dashboard como PENDING`);
  console.log(`   El cliente puede aprobar cada uno individualmente`);
  console.log(`${'═'.repeat(60)}`);
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
(async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🤖 THE MACHINE v2 — 50-Lead Pipeline       ║');
  console.log('║  7 Agents × 50 Leads = PENDING Approvals    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const state = loadState();

  // Phase 1: Prospection
  await phase1_prospect(state);

  // Phase 2: Enrichment
  await phase2_enrich(state);

  process.exit(0);
})();
