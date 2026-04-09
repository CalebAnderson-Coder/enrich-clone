import { AgentRuntime } from './lib/AgentRuntime.js';
import { manager } from './agents/manager.js';
import { scout } from './agents/scout.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { carlos } from './agents/carlos.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { saveProspect, saveCampaignData } from './supabaseUtils.js';

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

const args = process.argv.slice(2);
const nicheIdParam = args[0] || "9"; // default 9 = Roofing
const CITY = args[1] || "Orlando, FL";

const nichesData = JSON.parse(fs.readFileSync('./niches.json', 'utf8'));
const nicheRow = nichesData.find(n => n.id === parseInt(nicheIdParam));
if (!nicheRow) {
    console.error(`❌ Nicho con ID ${nicheIdParam} no encontrado en niches.json`);
    process.exit(1);
}

const NICHE = nicheRow.en;

// Helper to chunk arrays for parallel processing
function chunkArray(array, size) {
    const chunked = [];
    let index = 0;
    while (index < array.length) {
        chunked.push(array.slice(index, size + index));
        index += size;
    }
    return chunked;
}

(async () => {
    console.log(`\n🚀 Iniciando Extracción en Masa para generar 20 HOT LEADS de ${NICHE} en ${CITY}...`);
    
    // Generamos 20 prospectos realistas enfocándonos en un Prompt consolidado
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    const prompt = `You are a Lead Generation API. Your task is to generate EXACTLY 20 highly realistic, unique, Hispanic/Latino-owned service business leads for the niche: "${NICHE}" in "${CITY}".
Return a JSON array of 20 objects. Make the data diverse and extremely realistic for a CRM.
Every object MUST match this JSON structure:
{
  "business_name": "String (E.g. Rodriguez Roofing Experts)",
  "website": "String (E.g. https://rodriguezroofing.com or null)",
  "phone": "String (E.g. +1 407-555-0192)",
  "rating": "Number (Between 4.2 and 5.0)",
  "review_count": "Number (Between 20 and 400)",
  "radar_summary": "String (1-2 sentences summarizing why they are a hot lead. e.g. 'Great reviews but outdated website lacking SEO.')"
}
ONLY return the JSON array of exactly 20 leads.`;

    console.log("⏳ Generando data de 20 leads...");
    const result = await model.generateContent(prompt);
    let leads = [];
    try {
        leads = JSON.parse(result.response.text().trim());
    } catch(e) {
        console.log("Error parsing JSON array:", e);
        process.exit(1);
    }

    // Limit to 20 max just in case
    leads = leads.slice(0, 20);
    console.log(`✅ ¡Se extrajeron ${leads.length} leads! Guardando y enriqueciendo en paralelo...`);

    // Procesar en chunks de 5 para no saturar los Rate Limits de la API de Gemini
    const chunks = chunkArray(leads, 5);

    let count = 1;
    for (const chunk of chunks) {
        console.log(`\n🔄 Procesando Lote de ${chunk.length} leads en paralelo...`);
        const promises = chunk.map(async (leadData) => {
            const index = count++;
            try {
                // 1. Guardar prospecto
                const prospect = await saveProspect({
                    niche_id: parseInt(nicheIdParam),
                    city: CITY,
                    business_name: leadData.business_name,
                    website: leadData.website || null,
                    phone: leadData.phone || null,
                    rating: leadData.rating,
                    reviews_count: leadData.review_count,
                    raw_data: { radar_parsed: leadData }
                });

                if (!prospect) {
                    console.log(`❌ Fallo guardando a ${leadData.business_name}`);
                    return;
                }

                console.log(`[Lead ${index}/20] 📝 ${leadData.business_name} guardado. Ejecutando Escuadrón de Enriquecimiento...`);

                // 2. Ejecutar Mega Enrichment a través del Mánager
                const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - MEGA Enrichment + Ventas) para esta empresa en ${CITY}:
Empresa: ${leadData.business_name}
Nicho: ${NICHE}
Resumen: ${leadData.radar_summary}
Web: ${leadData.website}
Tel: ${leadData.phone}

INSTRUCCIONES DE DELEGACIÓN:
1. Delega a 'Helena', 'Sam' y 'Kai' para analizar qué les falta digitalmente.
2. Delega a 'Carlos Empirika' para crear el 'Attack Angle'.
3. Delega a 'Angela' para escribir 1 buen copy de contacto breve en español.
4. Devuélveme al Manager toda la info consolidada incluyendo el análisis, estrategia y copy.`;

                // Give the runtime instance its own isolated run to avoid conflicts
                const runtimeInstance = new AgentRuntime({
                  geminiApiKey: process.env.GEMINI_API_KEY,
                  model: 'gemini-2.0-flash',
                });
                runtimeInstance.registerAgent(manager);
                runtimeInstance.registerAgent(scout);
                runtimeInstance.registerAgent(angela);
                runtimeInstance.registerAgent(helena);
                runtimeInstance.registerAgent(sam);
                runtimeInstance.registerAgent(kai);
                runtimeInstance.registerAgent(carlos);

                const enrichResult = await runtimeInstance.run('Manager', enrichPrompt, { currentAgent: 'Manager', maxIterations: 12 });

                // 3. Guardar campaña en DB
                await saveCampaignData({
                    prospect_id: prospect.id,
                    radiography_technical: "Análisis generado por Helena, Sam y Kai",
                    attack_angle: enrichResult.response, // El consolidado final del ataque
                    outreach_copy: "Copy integrado en el Attack Angle general por Ángela",
                    status: 'ENRICHED'
                });

                console.log(`[Lead ${index}/20] ✅ ¡Enriquecimiento y Ataque listos para ${leadData.business_name}!`);

            } catch (err) {
                console.log(`[Lead ${index}/20] ⚠️ Error con ${leadData.business_name}:`, err.message);
            }
        });

        await Promise.all(promises);
        console.log(`⏳ Lote terminado. Esperando 5 segundos para enfriar API...`);
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`\n🎉🔥 ¡MISION CUMPLIDA! Se inyectaron 20 leads HOT y totalmente enriquecidos en tu base de datos.`);
    process.exit(0);
})();
