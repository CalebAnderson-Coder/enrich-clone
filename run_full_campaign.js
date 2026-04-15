import { AgentRuntime } from './lib/AgentRuntime.js';
import { manager } from './agents/manager.js';
import { scout } from './agents/scout.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { carlos } from './agents/carlos.js';
import dotenv from 'dotenv';
dotenv.config();

const runtime = new AgentRuntime({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// Register all agents
runtime.registerAgent(manager);
runtime.registerAgent(scout);
runtime.registerAgent(angela);
runtime.registerAgent(helena);
runtime.registerAgent(sam);
runtime.registerAgent(kai);
runtime.registerAgent(carlos);

import fs from 'fs';
import { saveProspect, saveCampaignData } from './supabaseUtils.js';
import { executeWithRalphLoop } from './lib/ralphLoop.js';
import { radarOutputSchema, enrichOutputSchema } from './lib/schemas.js';
import readline from 'readline';

// ─── Helper: run a specialist agent and return its text response ────────────
async function runSpecialist(agentName, prompt) {
  const result = await runtime.run(agentName, prompt, { maxIterations: 10, maxToolCalls: 15 });
  return result.response || '';
}

(async () => {
  // Parse arguments
  let args = process.argv.slice(2);
  let nicheIdParam = args[0];
  let CITY = args[1];

  if (!nicheIdParam || !CITY) {
    console.log("\n⚠️  PARÁMETROS INCOMPLETOS. INICIANDO ENTREVISTA DE PROFUNDIDAD (PLATÓNICA) ⚠️\n");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));
    const fallbackNiche = await askQuestion("🎯 Ingresa el ID del Nicho de 'niches.json' (Ej. '9' para Roofing): ");
    const fallbackCity  = await askQuestion("📍 Ingresa la Ciudad y Estado (Ej. 'Orlando, FL'): ");
    nicheIdParam = fallbackNiche || "9";
    CITY         = fallbackCity  || "Orlando, FL";
    rl.close();
  }

  // Load niches
  const nichesData = JSON.parse(fs.readFileSync('./niches.json', 'utf8'));
  const nicheRow = nichesData.find(n => n.id === parseInt(nicheIdParam));
  if (!nicheRow) {
    console.error(`❌ Nicho con ID ${nicheIdParam} no encontrado en niches.json`);
    process.exit(1);
  }

  const NICHE = nicheRow.en;
  const NICHE_ES = nicheRow.es;

  console.log(`\n🚀 [Fase 1] Iniciando EL RADAR (Prospección) para ${NICHE} (${NICHE_ES}) en ${CITY}...`);

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 1: Scout — Direct invocation (bypasses Manager for clean JSON output)
  // ══════════════════════════════════════════════════════════════════════════
  const scoutPrompt = `Find ONE real "${NICHE}" business in "${CITY}".

INSTRUCTIONS:
1. Use search_web to find a real local business in this niche and city.
2. Apply GATE filters: must be Latino-owned, 20+ reviews, 4.5+ star rating.
3. Also find: Google Maps URL, Facebook, Instagram, LinkedIn (use null if not found).
4. Do NOT call save_lead. Just research and return data.
5. At the very end of your response, output ONLY a single JSON block with this exact structure:

\`\`\`json
{
  "business_name": "Exact business name",
  "website": "https://url.com or null",
  "phone": "phone number or null",
  "rating": 4.7,
  "review_count": 135,
  "google_maps_url": "https://maps.google.com/... or null",
  "facebook_url": "https://facebook.com/... or null",
  "instagram_url": "https://instagram.com/... or null",
  "linkedin_url": "https://linkedin.com/... or null",
  "radar_summary": "brief summary of what you found about this business"
}
\`\`\``;

  try {
    const radarResult = await executeWithRalphLoop(
      runtime, 'scout', scoutPrompt, radarOutputSchema,
      { currentAgent: 'scout', maxIterations: 3 }
    );

    if (!radarResult.isValid) {
      throw new Error("Scout failed to return a valid lead structure. Cancelling.");
    }

    console.log(`\n✅ [Fase 1 Completada] Resultado del Radar:\n${JSON.stringify(radarResult.data, null, 2)}`);
    const radarData = radarResult.data;
    const businessName = radarData.business_name || "Prospect from Radar Phase";

    // ── Save prospect to Supabase ─────────────────────────────────────────
    const prospect = await saveProspect({
      niche_id:            parseInt(nicheIdParam),
      city:                CITY,
      business_name:       businessName,
      industry:            NICHE,
      metro_area:          CITY,
      website:             radarData.website  || null,
      phone:               radarData.phone    || null,
      rating:              radarData.rating   || null,
      review_count:        radarData.review_count || null,
      qualification_score: 85,
      lead_tier:           'HOT',
      raw_data: {
        radar_response: radarResult.response,
        radar_parsed: {
          google_maps_url: radarData.google_maps_url || null,
          facebook_url:    radarData.facebook_url    || null,
          instagram_url:   radarData.instagram_url   || null,
          linkedin_url:    radarData.linkedin_url    || null,
        }
      }
    });

    console.log(`\n💾 Prospecto guardado en base de datos con ID: ${prospect?.id}`);

    // ══════════════════════════════════════════════════════════════════════
    // FASE 2: El Francotirador — Direct specialist invocations (no Manager)
    // Each specialist is called directly for reliable, concrete outputs.
    // ══════════════════════════════════════════════════════════════════════
    console.log(`\n🔬 [Fase 2] Iniciando EL FRANCOTIRADOR (Enriquecimiento y Ataque)...`);

    const leadContext = JSON.stringify(radarData, null, 2);

    // Step 2a: Helena — SEO & Technical Audit
    console.log(`\n  🔍 [Helena] Realizando auditoría técnica y SEO...`);
    const helenaReport = await runSpecialist('Helena',
      `Do a technical website & SEO audit for this business:\n${leadContext}\n\nAnalyze: website quality, page speed, mobile-friendliness, SEO basics, Google Business presence. Write 2 concise paragraphs in English summarizing the technical weaknesses that represent marketing opportunities.`
    );

    // Step 2b: Sam — Paid Ads & Social Analysis  
    console.log(`\n  📣 [Sam] Analizando presencia publicitaria y redes...`);
    const samReport = await runSpecialist('Sam',
      `Analyze paid ads and social media presence for this business:\n${leadContext}\n\nCheck: Are they running Google Ads or Meta Ads? How active is their Instagram/Facebook? What advertising gaps exist? Write 1-2 short paragraphs in English highlighting the ad opportunities.`
    );

    // Step 2c: Kai — Social Media Deep-Dive
    console.log(`\n  📱 [Kai] Evaluando estrategia de contenido y redes sociales...`);
    const kaiReport = await runSpecialist('Kai',
      `Evaluate content strategy and social media for this business:\n${leadContext}\n\nFocus on: Instagram/Facebook engagement, consistency, content quality, follower count, missed opportunities. Write 1 short paragraph in English.`
    );

    // Combine technical radiography
    const radiographyTechnical = [
      `[SEO & Web — Helena]: ${helenaReport.slice(0, 800)}`,
      `[Paid Ads — Sam]: ${samReport.slice(0, 600)}`,
      `[Social Media — Kai]: ${kaiReport.slice(0, 500)}`
    ].join('\n\n');

    // Step 2d: Carlos — Attack Angle
    console.log(`\n  🎯 [Carlos] Desarrollando ángulo de ataque estratégico...`);
    const carlosAngle = await runSpecialist('Carlos Empirika',
      `You are Carlos Empirika, strategic sales analyst for Empirika Agency. Based on this lead data and technical audit, define the strategic "Attack Angle":

LEAD:
${leadContext}

TECHNICAL FINDINGS:
${radiographyTechnical.slice(0, 500)}

Write 1 direct, punchy paragraph (in English) explaining WHY this business needs Empirika's digital marketing services and WHAT specific gap we're solving for them. Be specific, not generic.`
    );

    // Step 2e: Angela — Email Outreach (IN ENGLISH — mandatory)
    console.log(`\n  ✉️  [Angela] Redactando email de outreach (EN INGLÉS)...`);
    const angelaCopy = await runSpecialist('Angela',
      `You are Angela, email marketing specialist for Empirika Agency. Write a personalized cold outreach email IN ENGLISH to this business:

BUSINESS:
${leadContext}

ATTACK ANGLE (from Carlos):
${carlosAngle.slice(0, 400)}

RULES:
- Language: ENGLISH ONLY (non-negotiable — US business market)
- Tone: Professional but warm, not salesy. Like a neighbor who noticed something.
- Subject line: Specific to their business (mention their name or niche)
- Body: Max 150 words. Mention 1 specific pain point. End with a soft CTA (reply, call, or short Zoom).
- Do NOT use generic templates. Be specific about their business.

Format your response EXACTLY as:
Subject: [subject line here]

[email body here starting from the greeting]`
    );

    // ── Combine enrichment result ─────────────────────────────────────────
    const enrichData = {
      radiography_technical: radiographyTechnical,
      attack_angle:          carlosAngle,
      outreach_copy:         angelaCopy,
    };

    // Validate with enrichOutputSchema
    const enrichParsed = enrichOutputSchema.safeParse(enrichData);
    if (!enrichParsed.success) {
      console.warn('⚠️  enrichOutputSchema validation warning (soft):', enrichParsed.error.message);
    }

    console.log(`\n✅ [Fase 2 Completada] Mega Perfil y Estrategia generados.`);
    console.log(`\n📧 Email Draft:\n${angelaCopy}`);

    // ── Save campaign data to Supabase ─────────────────────────────────────
    if (prospect?.id) {
      await saveCampaignData({
        prospect_id:           prospect.id,
        radiography_technical: enrichData.radiography_technical,
        attack_angle:          enrichData.attack_angle,
        outreach_copy:         enrichData.outreach_copy,
        status:                'PENDING'
      });
      console.log(`\n💾 Ángulo de ataque y copies guardados en Supabase para prospecto ${prospect.id}.`);
    } else {
      console.warn('⚠️  Prospect ID not available — skipping campaign data save.');
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error en la campaña:', err);
    process.exit(1);
  }
})();
