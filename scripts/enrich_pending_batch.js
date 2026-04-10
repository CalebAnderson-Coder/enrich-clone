// scripts/enrich_pending_batch.js — Enrich all Orlando leads missing campaign_enriched_data
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { manager } from '../agents/manager.js';
import { scout } from '../agents/scout.js';
import { angela } from '../agents/angela.js';
import { helena } from '../agents/helena.js';
import { sam } from '../agents/sam.js';
import { kai } from '../agents/kai.js';
import { carlos } from '../agents/carlos.js';
import { supabase, saveCampaignData } from '../supabaseUtils.js';
import dotenv from 'dotenv';
dotenv.config();

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

runtime.registerAgent(manager);
runtime.registerAgent(scout);
runtime.registerAgent(angela);
runtime.registerAgent(helena);
runtime.registerAgent(sam);
runtime.registerAgent(kai);
runtime.registerAgent(carlos);

async function getUnenrichedLeads() {
  // Get all Orlando leads
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('metro_area', 'Orlando, FL')
    .order('created_at', { ascending: false });

  // Get all existing enrichment records
  const { data: enriched } = await supabase
    .from('campaign_enriched_data')
    .select('prospect_id');

  const enrichedIds = new Set((enriched || []).map(e => e.prospect_id));
  return (leads || []).filter(l => !enrichedIds.has(l.id));
}

async function enrichLead(lead, index, total) {
  const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - Enriquecimiento y Ventas) para este negocio REAL:

DATOS DEL LEAD:
- Nombre: ${lead.business_name}
- Ciudad: ${lead.metro_area || 'Orlando, FL'}
- Industria: ${lead.industry || 'Remodeling/Roofing'}
- Website: ${lead.website || 'No disponible'}
- Teléfono: ${lead.phone || 'No disponible'}
- Rating: ${lead.rating || 'N/A'}
- Reviews: ${lead.review_count || 0}

INSTRUCCIONES:
1. Usa tus herramientas de búsqueda web para investigar la presencia online REAL de esta empresa.
2. Haz una radiografía técnica de su presencia digital (website, SEO, social, publicidad).
3. Define el ángulo de ataque ("attack angle") para el mercado hispano.
4. Genera el email copy (subject + body) en Spanglish auténtico que Angela usaría.
5. Devuelve todo en JSON (bloque \`\`\`json):
{
  "radiography_technical": "Evaluación técnica en 1-2 párrafos",
  "attack_angle": "Ángulo de ventas en 1 párrafo",
  "outreach_copy": "Subject: ... | Body: ..."
}`;

  console.log(`\n[${index}/${total}] 🔬 Enriqueciendo: ${lead.business_name}...`);
  
  try {
    const result = await runtime.run('Manager', enrichPrompt, { currentAgent: 'Manager', maxIterations: 20 });

    let enrichData = {
      radiography_technical: "Análisis generado por el agente.",
      attack_angle: result.response.slice(0, 500),
      outreach_copy: "Pendiente de revisión."
    };

    try {
      const jsonMatch = result.response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        enrichData = JSON.parse(jsonMatch[1]);
      } else {
        const fallbackMatch = result.response.match(/\{[\s\S]*?\}/);
        if (fallbackMatch) enrichData = JSON.parse(fallbackMatch[0]);
      }
    } catch (e) {
      console.log(`  ⚠️ JSON parse fallback for ${lead.business_name}`);
    }

    // Save to campaign_enriched_data (FK now works!)
    const saved = await saveCampaignData({
      prospect_id: lead.id,
      radiography_technical: enrichData.radiography_technical || "Sin Radiografía.",
      attack_angle: enrichData.attack_angle || "Sin Ángulo.",
      outreach_copy: enrichData.outreach_copy || "Sin Copy.",
      status: 'ENRICHED'
    });

    if (saved) {
      // Mark lead magnet as COMPLETED so outreach dispatcher can pick it up
      await supabase.from('campaign_enriched_data')
        .update({ lead_magnet_status: 'COMPLETED' })
        .eq('id', saved.id);
      
      console.log(`  ✅ ${lead.business_name} → Enriched & Saved (${saved.id})`);
    } else {
      console.log(`  ⚠️ ${lead.business_name} → Enriched but save failed`);
    }

    return true;
  } catch (err) {
    console.error(`  ❌ Error enriching ${lead.business_name}:`, err.message);
    return false;
  }
}

async function main() {
  const unenriched = await getUnenrichedLeads();
  console.log(`\n🎯 Found ${unenriched.length} leads without enrichment in Orlando, FL.`);
  
  if (unenriched.length === 0) {
    console.log('✅ Todos los leads ya están enriquecidos!');
    return;
  }

  // Process in batches of 5 for safety
  const BATCH_SIZE = parseInt(process.argv[2] || '10');
  const batch = unenriched.slice(0, BATCH_SIZE);
  console.log(`📦 Processing batch of ${batch.length} leads (of ${unenriched.length} total)\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const ok = await enrichLead(batch[i], i + 1, batch.length);
    if (ok) success++;
    else failed++;
    
    // Small delay between leads to not hit rate limits
    if (i < batch.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n📊 Batch complete: ${success} enriched, ${failed} failed`);
  console.log(`📦 Remaining unenriched: ${unenriched.length - batch.length}`);
  
  // Show outreach readiness
  const { count } = await supabase
    .from('campaign_enriched_data')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ENRICHED')
    .eq('lead_magnet_status', 'COMPLETED')
    .is('outreach_status', null);
  
  console.log(`\n📬 Total leads ready for outreach dispatch: ${count}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
