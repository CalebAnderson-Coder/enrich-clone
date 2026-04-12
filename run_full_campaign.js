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
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
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
      const fallbackCity = await askQuestion("📍 Ingresa la Ciudad y Estado (Ej. 'Orlando, FL'): ");
      nicheIdParam = fallbackNiche || "9";
      CITY = fallbackCity || "Orlando, FL";
      rl.close();
  }

  // Load niches
  const nichesData = JSON.parse(fs.readFileSync('./niches.json', 'utf8'));
  const nicheRow = nichesData.find(n => n.id === parseInt(nicheIdParam));
  if (!nicheRow) {
      console.error(`❌ Nicho con ID ${nicheIdParam} no encontrado en niches.json`);
      process.exit(1);
  }

  const NICHE = nicheRow.en; // We use English for mapping/scraping effectiveness


  console.log(`\n🚀 [Fase 1] Iniciando EL RADAR (Prospección) para ${NICHE} (${nicheRow.es}) en ${CITY}...`);
  
  const radarPrompt = `Ejecuta el Macro-Flujo de prospectación (El Radar) para el Nicho: "${NICHE}" en la Ciudad: "${CITY}".
INSTRUCCIONES PARA MANAGER:
1. Delega a 'scout' que busque EXACTAMENTE 1 negocio TOTALMENTE REAL para este nicho en la ciudad indicada, usando sus capacidades nativas de Búsqueda en Google (Google Search Grounding).
2. Scout debe usar búsquedas reales para extraer y confirmar el nombre exacto de la empresa, su sitio web real, su teléfono de contacto auténtico, rating y cantidad de reviews. NADA DE DATOS FICTICIOS.
3. ADEMÁS: Busca y extrae el link exacto de Google Maps de la empresa, su URL de Facebook, su URL de Instagram y su URL de LinkedIn (si las tiene, de lo contrario devuelve null).
4. Devuelve la respuesta en formato JSON estrictamente (dentro de un bloque de código \`\`\`json y \`\`\`).
El formato debe ser EXACTAMENTE este:
{
  "business_name": "Nombre de la empresa",
  "website": "https://url.com",
  "phone": "telefono",
  "rating": 4.5,
  "review_count": 100,
  "google_maps_url": "https://maps.google.com/...",
  "facebook_url": "https://facebook.com/...",
  "instagram_url": "https://instagram.com/...",
  "linkedin_url": "https://linkedin.com/...",
  "radar_summary": "Resumen general"
}`;

  try {
    const radarResult = await executeWithRalphLoop(runtime, 'Manager', radarPrompt, radarOutputSchema, { currentAgent: 'Manager', maxIterations: 3 });
    
    if (!radarResult.isValid) {
        throw new Error("El agente falló repetidamente en devolver la estructura correcta para el Radar. Cancelando.");
    }

    console.log(`\n✅ [Fase 1 Completada] Resultado del Radar:\n${JSON.stringify(radarResult.data, null, 2)}`);
    const radarData = radarResult.data;

    const businessName = radarData.business_name || "Prospect from Radar Phase";

    // Parse radar results to save in DB 
    const prospect = await saveProspect({
        niche_id: parseInt(nicheIdParam),
        city: CITY,
        business_name: businessName,
        industry: NICHE,
        metro_area: CITY,
        website: radarData.website || null,
        phone: radarData.phone || null,
        qualification_score: 85,
        lead_tier: 'HOT',
        raw_data: { radar_response: radarResult.response, radar_parsed: radarData }
    });

    console.log(`\n💾 Prospecto guardado en base de datos con ID: ${prospect?.id}`);
    
    console.log(`\n🔬 [Fase 2] Iniciando EL FRANCOTIRADOR (Enriquecimiento y Ataque)...`);
    
    // We force the execution using the results of Phase 1 regardless of UUID matching
    const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - MEGA Enrichment + Ventas) para el negocio que encontramos en la Fase 1:
"${JSON.stringify(radarResult.data, null, 2).slice(0, 300)}... (Resumen del radar)"

INSTRUCCIONES DE DELEGACIÓN ESTRICTA EN ORDEN:
1. Usa tus herramientas de búsqueda web (o delega a scout) para buscar la presencia real exhaustiva online de esta empresa.
2. Delega a 'Helena', 'Sam' y 'Kai' para hacer una radiografía técnica de este lead basada en los resultados de la web.
3. Con los hallazgos, delega a 'Carlos Empirika' para armar el 'Attack Angle' estratégico enfocado en el mercado hispano.
4. Con el Angle de Carlos listo, delega a 'Angela' para crear el copy de multi-contacto.
5. Devuelve todo consolidado estrictamente en formato JSON usando este esquema (usando un bloque de código \`\`\`json y \`\`\`):
{
  "radiography_technical": "1-2 Párrafos reales de la evaluación técnica web, redes, y presencia local",
  "attack_angle": "El ángulo de ventas de Carlos en 1 párrafo directo",
  "outreach_copy": "El asunto y cuerpo original creado por Angela"
}`;

    const enrichResult = await executeWithRalphLoop(runtime, 'Manager', enrichPrompt, enrichOutputSchema, { currentAgent: 'Manager', maxIterations: 3 });
    
    if (!enrichResult.isValid) {
        throw new Error("El agente falló repetidamente en devolver la estructura correcta para el Francotirador. Cancelando.");
    }

    console.log(`\n✅ [Fase 2 Completada] Mega Perfil y Estrategia:\n${JSON.stringify(enrichResult.data, null, 2)}`);
    const enrichData = enrichResult.data;

    // Guardar los datos del atacante
    if (prospect) {
        await saveCampaignData({
            prospect_id: prospect.id,
            radiography_technical: enrichData.radiography_technical || "Sin Radiografía.",
            attack_angle: enrichData.attack_angle || "Sin Ángulo.",
            outreach_copy: enrichData.outreach_copy || "Sin Copy.",
            status: 'PENDING'
        });
        console.log(`\n💾 Ángulo de ataque y copies asociados al prospecto en Supabase almacenados limpiamente.`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error en la campaña:', err);
    process.exit(1);
  }
})();
