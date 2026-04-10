import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const BATCH_SIZE = 200;

async function generateEmbedding(text) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent({
            content: { role: 'user', parts: [{ text }] },
            outputDimensionality: 768
        });
        return result.embedding.values;
    } catch (error) {
        console.error("Gemini Embedding Error:", error.message);
        return null;
    }
}

async function vectorizeMissingKnowledge() {
    console.log("🚀 Iniciando vectorización de carlos_knowledge...");

    // Obtenemos los posts que no tienen embedding aún
    const { data: posts, error } = await supabase
        .from('carlos_knowledge')
        .select('*')
        .is('embedding', null)
        .limit(BATCH_SIZE);

    if (error) {
        console.error("❌ Error leyendo Supabase:", error);
        return;
    }

    if (!posts || posts.length === 0) {
        console.log("✅ Todos los posts de la base de datos ya están vectorizados.");
        return;
    }

    console.log(`⏳ Encontrados ${posts.length} posts sin vector... Procesando batch.`);

    for (const post of posts) {
        // En prioridad usamos la transcripción, de lo contrario el caption
        const textToEmbed = post.transcription || post.caption || "";
        
        if (!textToEmbed.trim()) {
            console.log(`⚠️ Post ${post.id} está vacío, ignorando...`);
            continue;
        }

        console.log(`   -> Generando embedding para post: ${post.source_url || post.id}`);
        const vector = await generateEmbedding(textToEmbed);

        if (vector) {
            const { error: updateError } = await supabase
                .from('carlos_knowledge')
                .update({ embedding: vector })
                .eq('id', post.id);
            
            if (updateError) {
                console.error(`     ❌ Error subiendo vector:`, updateError);
            } else {
                console.log(`     ✅ Vector guardado correctamente.`);
            }
        }
        
        // Pausa obligatoria para no ahogar la API de Gemini
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log("-----------------------------------------");
    console.log("🔄 Batch terminado. Si hay más registros, vuelve a ejecutar el script.");
}

vectorizeMissingKnowledge().catch(console.error);
