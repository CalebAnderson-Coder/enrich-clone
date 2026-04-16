import dotenv from 'dotenv';
dotenv.config();

import { AgentRuntime } from './lib/AgentRuntime.js';
import { supabase } from './lib/supabase.js';
import { carlos } from './agents/carlos.js';
import { fetchPage } from './tools/webResearch.js';

async function main() {
  const runtime = new AgentRuntime({
    geminiApiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  });
  runtime.registerAgent(carlos);

  const { data: leads, error } = await supabase.from('leads').select('*');
  if (error) {
    console.error("Error fetching leads", error);
    return;
  }

  console.log(`Fetched ${leads.length} leads. Starting Firecrawl + Carlos analysis...`);

  for (const lead of leads) {
    let mega_profile = {};
    if (lead.mega_profile) {
      if (typeof lead.mega_profile === 'string') {
        try {
          mega_profile = JSON.parse(lead.mega_profile);
        } catch (e) {}
      } else {
        mega_profile = lead.mega_profile;
      }
    }

    console.log(`Analyzing: ${lead.business_name} ...`);

    let websiteContent = "No hay sitio web proporcionado.";
    if (lead.website) {
       console.log(`  -> Extrañendo web de ${lead.website} con Firecrawl...`);
       websiteContent = await fetchPage.fn({ url: lead.website });
    }

    const context = `
      Nombre: ${lead.business_name || lead.empresa || 'Empresa local'}
      Industria: ${lead.industry || lead.nicho || 'General'}
      Web/Maps: ${lead.website || lead.google_maps_url || 'No disponible'}
      Ubicación: ${lead.metro_area || lead.ciudad || 'No disponible'}
      
      === CONTENIDO DEL SITIO WEB REPORTADO POR FIRECRAWL (MARKDOWN) ===
      ${websiteContent}
      ==================================================================
    `;

    const prompt = `Contexto del lead: ${context}
Por favor haz tu análisis. IMPORTANTE: Tu respuesta final DEBE ser ÚNICAMENTE un objeto JSON válido con las claves "radiography_technical" y "attack_angle", sin explicaciones previas ni posteriores.`;

    try {
      const result = await runtime.run('Carlos Empirika', prompt, { currentAgent: 'Carlos Empirika' });
      
      let parsed = {};
      try {
        let jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON object found in response");
        }
      } catch (e) {
        console.error("Failed to parse Carlos response", e);
        parsed = {
          attack_angle: "Respuesta no-JSON generada",
          technical_observation: "Fallback generado"
        };
      }

      mega_profile.radiography_technical = parsed.technical_observation || parsed.radiography_technical || 'Análisis técnico completado.';
      mega_profile.attack_angle = parsed.attack_angle || 'Ofrecer digitalización.';
      
      await supabase.from('leads').update({ mega_profile }).eq('id', lead.id);
      console.log(`✅ Updated ${lead.business_name}`);
    } catch(err) {
      console.error(`❌ Failed for ${lead.business_name}`, err.message);
    }
    
    // Minimal delay to prevent API flooding
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log("Batch complete!");
  process.exit(0);
}

main();
