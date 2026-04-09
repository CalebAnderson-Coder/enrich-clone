import { AgentRuntime } from './lib/AgentRuntime.js';
import { angela } from './agents/angela.js';
import { carlos } from './agents/carlos.js';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

runtime.registerAgent(angela);
runtime.registerAgent(carlos);

(async () => {
    console.log("Fetching existing leads...");
    const { data: campaigns, error } = await supabase
        .from('campaign_enriched_data')
        .select(`
            id,
            prospect_id,
            prospects ( business_name, city, raw_data )
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching", error);
        process.exit(1);
    }

    console.log(`Found ${campaigns.length} campaigns to update.`);

    let index = 1;
    for (const campaign of campaigns) {
        if (!campaign.prospects) continue;
        const businessName = campaign.prospects.business_name;
        const city = campaign.prospects.city || 'la ciudad';
        const radarSummary = campaign.prospects.raw_data?.radar_parsed?.radar_summary || 'Local service business.';

        console.log(`\n[${index}/${campaigns.length}] Updating: ${businessName}...`);
        

        try {
            // Generar nuevo Ángulo de Ataque con Carlos
            const carlosPrompt = `Genera un 'Attack Angle' estratégico y contundente para ${businessName} en ${city}. 
Resumen del prospecto: ${radarSummary}. 
Tu objetivo es sugerir qué servicio de Empírika (Citas por WhatsApp, Modernización Web, o Embudos) deberíamos venderle y por qué. Se directo y breve (2 oraciones máximo). El 'Attack Angle' es de uso INTERNO para el equipo de ventas. Actúa como humano.`;
            
            const carlosResult = await runtime.run('Carlos Empirika', carlosPrompt, { currentAgent: 'Carlos Empirika', maxIterations: 1 });
            const attackAngle = carlosResult.response;

            // Generar nuevo Email Copy con Angela
            const angelaPrompt = `Escribe un email de Outreach (contacto en frío) para ${businessName} en ${city}.
Contexto del prospecto: ${radarSummary}.
Ángulo de venta INTERNO sugerido: ${attackAngle}.

REGLAS ESTRICTAS PARA EL EMAIL COPY:
1. Actúa 100% como una humana experta en marketing. NO menciones ser IA.
2. Somos "Empírika", una agencia de automatización y sitios web. No usamos la palabra "IA" para describirnos a nosotros mismos frente a los clientes hoy. Di que ofrecemos "sistemas automáticos" o "embudos digitales".
3. El email debe ser amigable pero al grano. Cero saludos formales robotizados. Identifica el problema y ofrece una demo corta.
4. Incluye siempre 'Asunto:' antes del título.
No incluyas texto extra, devuélveme SOLO el Asunto y el Cuerpo del correo.`;

            const angelaResult = await runtime.run('Angela', angelaPrompt, { currentAgent: 'Angela', maxIterations: 1 });
            const outreachCopy = angelaResult.response;

            // Actualizar DB
            const { error: updateError } = await supabase
                .from('campaign_enriched_data')
                .update({ 
                    attack_angle: attackAngle, 
                    outreach_copy: outreachCopy 
                })
                .eq('id', campaign.id);
            
            if (updateError) {
                console.error("Error updating DB:", updateError);
            } else {
                console.log(`✅ ${businessName} Updated Successfully!`);
            }
        } catch(err) {
            console.error(`Error processing ${businessName}:`, err.message);
        }
        index++;
    }
    console.log("\n🚀 All 35 leads updated with the new human-only copies!");
    process.exit(0);
})();
