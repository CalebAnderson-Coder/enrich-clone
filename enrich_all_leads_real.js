import { AgentRuntime, Agent } from './lib/AgentRuntime.js';
import { searchWeb, fetchPage } from './tools/webResearch.js';
import { supabase } from './supabaseUtils.js';
import dotenv from 'dotenv';
dotenv.config();

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

const trueResearcher = new Agent({
  name: 'TrueResearcher',
  systemPrompt: `You are an expert OSINT researcher. Your goal is to find the ACTUAL, REAL social media URLs (Facebook, Instagram, LinkedIn) and the real Google Maps URL for local service businesses in the US.
You MUST use your search_web tool to query DuckDuckGo for the business name + city to locate their genuine social profiles.
DO NOT GUESS OR MOCK URLs. If you search for "Ruppert Landscape facebook" and find their real page, use that exact URL. If a social network profile truly does not exist, return null.
Proporciona tus textos descriptivos ESTRICTAMENTE EN ESPAÑOL NATIVO.
Produce a strict JSON response containing:
{
  "facebook_url": "URL or null",
  "instagram_url": "URL or null",
  "linkedin_url": "URL or null",
  "google_maps_url": "URL or null",
  "technical_observation": "A 1-2 sentence real, factual observation based on looking at their search presence (e.g. 'Presencia muy robusta en búsqueda con miles de reseñas, pero no hay pixel activo instalado.'). MUST BE IN SPANISH.",
  "attack_angle": "A 1-2 sentence recommendation for our sales team on how to pitch them based on their real footprint. MUST BE IN SPANISH."
}`,
  tools: [searchWeb, fetchPage]
});

runtime.registerAgent(trueResearcher);

async function enrichAllLeadsReal() {
  const { data: leads, error } = await supabase.from('leads').select('*').order('id', { ascending: false });
  if (error || !leads) {
    console.error('Error fetching leads:', error);
    return;
  }

  console.log(`\n🕵️ Iniciando enriquecimiento REAL para ${leads.length} leads. Esto tomará varios minutos ya que los agentes buscarán en la web de verdad...\n`);

  let count = 1;
  for (const lead of leads) {
    const city = lead.metro_area || lead.city || 'US';
    console.log(`[${count}/${leads.length}] Investigando a: ${lead.business_name} en ${city}...`);
    
    const prompt = `Busca y extrae la presencia online real de la empresa: "${lead.business_name}" ubicada cerca de "${city}". 
Usa la herramienta search_web las veces que sea necesario (ej: "${lead.business_name} ${city} facebook", "${lead.business_name} ${city} google maps").
Devuelve la data extraída ÚNICAMENTE en JSON usando las siguientes llaves: facebook_url, instagram_url, linkedin_url, google_maps_url, technical_observation, attack_angle.`;

    try {
      const result = await runtime.run('TrueResearcher', prompt, { maxIterations: 5 });
      
      let parsed = {};
      const jsonMatch = result.response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
      } else {
          const fallbackMatch = result.response.match(/\{[\s\S]*?\}/);
          if (fallbackMatch) parsed = JSON.parse(fallbackMatch[0]);
      }

      console.log(`  -> Resultados extraídos:
     FB: ${parsed.facebook_url}
     IG: ${parsed.instagram_url}
     IN: ${parsed.linkedin_url}
     MAPS: ${parsed.google_maps_url}
      `);

      // Update basic lead table for URLs
      await supabase.from('leads').update({
        facebook_url: parsed.facebook_url || null,
        instagram_url: parsed.instagram_url || null,
        linkedin_url: parsed.linkedin_url || null,
        google_maps_url: parsed.google_maps_url || null
      }).eq('id', lead.id);

      // Update technical observation and attack angle
      await supabase.from('campaign_enriched_data').update({
        radiography_technical: parsed.technical_observation || 'Análisis técnico en curso.',
        attack_angle: parsed.attack_angle || 'Ofertar auditoría gratuita.'
      }).eq('prospect_id', lead.id);

    } catch (err) {
      console.log(`  ⚠️ Error al investigar ${lead.business_name}:`, err.message);
    }
    
    count++;
  }
  console.log('✅ Búsqueda web y enriquecimiento finalizado para todos los leads.');
}

enrichAllLeadsReal();
