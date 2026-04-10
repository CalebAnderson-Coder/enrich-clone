import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { manager } from './agents/manager.js';
import { davinci } from './agents/davinci.js';
import { AgentRuntime } from './lib/AgentRuntime.js';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});
runtime.registerAgent(manager);
runtime.registerAgent(davinci);

export async function processIdleMagnets() {
    console.log('🤖 [Lead Magnet Worker] Buscando leads con status IDLE...');
    const { data: campaignData, error } = await supabase
        .from('campaign_enriched_data')
        .select(`
            id,
            prospect_id,
            leads!inner (
                business_name,
                industry,
                website,
                mega_profile
            )
        `)
        .eq('lead_magnet_status', 'IDLE')
        .limit(5);

    if (error) {
        console.error('❌ [Lead Magnet Worker] Error buscando leads:', error);
        return;
    }

    if (!campaignData || campaignData.length === 0) {
        return;
    }

    for (const record of campaignData) {
        const lead = record.leads;
        console.log(`⚡ [Lead Magnet Worker] Generando estrategia de Magneto Visual para: ${lead.business_name}`);
        
        await supabase
            .from('campaign_enriched_data')
            .update({ lead_magnet_status: 'PROCESSING' })
            .eq('id', record.id);

        try {
            const megaProfileJSON = lead.mega_profile ? JSON.stringify(lead.mega_profile, null, 2) : 'No mega_profile available.';
            
            const prompt = `Por favor, evalúa este perfil, ejecuta la tool para diseñar el magnet (Stitch o DALLE) y devuelve el reporte final.
Business: ${lead.business_name}
Industry: ${lead.industry}
Website: ${lead.website || 'Ninguno'}

MEGA PROFILE:
${megaProfileJSON}`;

            const resultMsg = await runtime.run('DaVinci', prompt, { currentAgent: 'DaVinci' });
            const rawOutput = resultMsg.response || resultMsg.content;
            
            let magnetData = {};
            let isParseSuccess = false;
            try {
                let cleanOutput = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
                const match = cleanOutput.match(/\{[\s\S]*\}/);
                if (match) {
                    cleanOutput = match[0];
                }
                magnetData = JSON.parse(cleanOutput);
                isParseSuccess = true;
            } catch (e) {
                console.error('❌ [Lead Magnet Worker] Error parseando JSON:', e);
                magnetData = { error: 'No se pudo parsear devolucion de DaVinci.', raw: rawOutput };
            }

            console.log(`✅ [Lead Magnet Worker] Completado para: ${lead.business_name} | Ruta: ${magnetData.magnet_type || 'Desconocida'}`);

            
            await supabase
                .from('campaign_enriched_data')
                .update({ 
                    lead_magnet_status: 'COMPLETED',
                    lead_magnets_data: magnetData
                })
                .eq('id', record.id);

        } catch (e) {
            console.error('❌ [Lead Magnet Worker] Error procesando el lead:', e);
            await supabase
                .from('campaign_enriched_data')
                .update({ lead_magnet_status: 'ERROR' })
                .eq('id', record.id);
        }
    }
}
