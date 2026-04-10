import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Realiza una búsqueda semántica en la tabla carlos_knowledge.
 * @param {string} query - El "problema" o búsqueda formulada por el diagnóstico.
 * @param {number} limit - Cantidad de videos/transcripciones a retornar.
 * @returns {Promise<Array>} - Los posts más relevantes.
 */
export async function searchCarlosKnowledge(query, limit = 3) {
    try {
        console.log(`🔎 Generando vector para búsqueda: "${query}"`);
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent({
            content: { role: 'user', parts: [{ text: query }] },
            outputDimensionality: 768
        });
        const queryEmbedding = result.embedding.values;

        console.log(`🧠 Buscando recuerdos similares en Supabase...`);
        const { data, error } = await supabase.rpc('match_carlos_knowledge', {
            query_embedding: queryEmbedding,
            match_threshold: 0.2, // Ajustable: 0 = todo, 1 = igualdad exacta
            match_count: limit
        });

        if (error) {
            console.error("❌ Error en RAG (RPC Supabase):", error);
            return [];
        }

        return data;
    } catch (err) {
        console.error("❌ Error en búsqueda semántica (Gemini/RAG):", err);
        return [];
    }
}

/**
 * Genera el outreach basado en la memoria y prospect data. (NUECLEO DE RAG)
 */
export async function generateHyperPersonalizedOutreach(prospectData, memoryResults) {
    // Aquí invocamos a Groq o Gemini para redactar, usando memoryResults en el System Prompt
    const memoryContext = memoryResults.map(m => 
        `\n--- VIDEO RECUERDO ---\nTranscripción de Carlos: "${m.transcription || m.caption}"\nURL: ${m.source_url}`
    ).join('\n');

    const prompt = `
Eres Carlos, CEO de Empirika Group. A continuación tienes un cliente potencial y tu PROPIA memoria de lo que has hablado en videos pasados.

MEMORIA TÉCNICA (Tus videos anteriores sobre este tema):
${memoryContext}

DATOS DEL LEAD (Problema a resolver):
${JSON.stringify(prospectData, null, 2)}

INSTRUCCIONES:
Redacta un mensaje de venta en frío (outreach) de no más de 4 párrafos cortos.
Aplica exactamente los mismos conceptos, metodologías y el TONO exacto que usas en los "Videos Recuerdo".
No suenes a robot de IA. Suena a ti. Ve al grano, ataca la yugular del dolor comercial.
    `;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Puedes usar groq sdk aquí
        const response = await model.generateContent(prompt);
        return response.response.text();
    } catch (e) {
         console.error("Error generating outreach", e);
         return null;
    }
}
