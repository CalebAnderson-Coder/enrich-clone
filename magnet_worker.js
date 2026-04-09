import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { manager } from './agents/manager.js';
import { AgentRuntime } from './lib/AgentRuntime.js';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const runtime = new AgentRuntime();
runtime.registerAgent(manager);

async function processPendingMagnets() {
    console.log('Buscando leads pendientes de magets...');
    const { data: leads, error } = await supabase
        .from('campaign_enriched_data')
        .select(`
            id,
            prospect_id,
            radiography_technical,
            attack_angle,
            leads (
                business_name,
                website,
                industry,
                review_count,
                rating
            )
        `)
        .eq('lead_magnet_status', 'PENDING')
        .limit(5);

    if (error) {
        console.error('Error buscando leads:', error);
        return;
    }

    if (!leads || leads.length === 0) {
        return;
    }

    for (const lead of leads) {
        console.log(`Procesando Lead Magnets para el prospecto: ${lead.leads?.business_name}`);
        
        // Lo marcamos como procesando
        await supabase
            .from('campaign_enriched_data')
            .update({ lead_magnet_status: 'PROCESSING' })
            .eq('id', lead.id);

        try {
            // Contexto rico para el agente
            const prompt = `
El siguiente prospecto necesita una estrategia de "Lead Magnets" hyper-personalizada para regalarle y abrir la puerta a una venta de agencia:
Nombre de negocio: ${lead.leads?.business_name}
Industria: ${lead.leads?.industry}
Sitio Web Actual: ${lead.leads?.website || 'No tiene sitio web'}
Reviews: ${lead.leads?.rating} de ${lead.leads?.review_count} reseñas.

Análisis Técnico Previo:
${lead.radiography_technical}

Ángulo de Ataque:
${lead.attack_angle}

TU TAREA COMO MANAGER:
Necesitamos que coordines la creación de 2 Lead Magnets:
1. Una propuesta conceptual de un "Sitio Web Gratis" optimizado (enfocado en conversión).
2. Un borrador de anuncios (Ads) para promocionar sus servicios top (Creative Ad 1 y Creative Ad 2).

Entrega el resultado en FORMATO JSON (No markdown). Estructura esperada:
{
  "free_website_magnet": {
    "title": "Boceto de sitio ideal",
    "value_proposition": "Por qué su negocio necesita esta web urgente",
    "structure": "Secciones principales de la web"
  },
  "ads_magnet": {
    "creative_1": { "hook": "...", "copy": "...", "visual": "..." },
    "creative_2": { "hook": "...", "copy": "...", "visual": "..." }
  }
}
Responde SOLO con el objeto JSON.
`;

            // Simulamos a los agentes. Aquí el runtime orquestra al manager y los subagentes.
            // Para asegurar respuesta JSON estricta, enviamos al manager.
            const resultMsg = await runtime.run([manager], prompt);
            const rawOutput = resultMsg.content;
            
            let magnetData = {};
            try {
                // Limpiar markdown residual de LLM
                let cleanOutput = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
                const match = cleanOutput.match(/\{[\s\S]*\}/);
                if (match) {
                    cleanOutput = match[0];
                }
                magnetData = JSON.parse(cleanOutput);
            } catch (e) {
                console.error('Error parseando JSON de los agentes:', e);
                magnetData = { error: 'No se pudo parsear', raw: rawOutput };
            }

            console.log('Actualizando prospecto completado...');
            await supabase
                .from('campaign_enriched_data')
                .update({ 
                    lead_magnet_status: 'COMPLETED',
                    lead_magnets_data: magnetData
                })
                .eq('id', lead.id);

        } catch (e) {
            console.error('Error corriendo agentes para el lead:', e);
            await supabase
                .from('campaign_enriched_data')
                .update({ lead_magnet_status: 'ERROR' })
                .eq('id', lead.id);
        }
    }
}

// Daemon Loop
console.log('✅ Magnet Worker iniciado. Esperando trabajos...');
setInterval(processPendingMagnets, 10000); // Poll cada 10 segundos
processPendingMagnets();
