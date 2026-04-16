import { searchCarlosKnowledge, generateHyperPersonalizedOutreach } from './lib/agents/campaign_rag.js';
import dotenv from 'dotenv';
dotenv.config();

async function runRAGTest() {
    console.log("==========================================");
    console.log("⚡ TEST RAG Y GENERACIÓN DE HYPER-COPY ⚡");
    console.log("==========================================");

    const prospectoFicticio = {
        name: "Clínica Dental Sonrisa Perfecta",
        diagnostico: "Tienen una página web de los años 90. Carga lento, no muestra beneficios y están perdiendo pacientes digitales frente a su competencia directa que usa TikTok y buen SEO.",
        sector: "Salud / Dental"
    };

    // 1. Simular la mente del Agente buscando conocimiento:
    const query = `problemas con paginas web viejas, sitios lentos, perdida de ventas por mal diseño web clinicas`;
    console.log(`\n1. El Agente formuló la búsqueda: "${query}"`);
    
    // 2. Extraer memoria
    const memory = await searchCarlosKnowledge(query, 2); // Buscar top 2 videos relevantes

    if (memory.length === 0) {
        console.log("❌ No se encontró memoria o los embeddings aún no existen en la tabla carlos_knowledge. Usa vectorize_knowledge.js primero.");
        return;
    }

    console.log("\n2. ✨ MEMORIA RECUPERADA (Videos similares encontrados):");
    memory.forEach((m, i) => {
        console.log(`   [Video ${i+1}] Similitud: ${(m.similarity * 100).toFixed(1)}%`);
        console.log(`   Transcripción (extracto): "${(m.transcription || m.caption).substring(0, 150)}..."`);
    });

    // 3. Generar el Outreach usando el cerebro
    console.log("\n3. ✍️ GENERANDO OUTREACH HIPER-PERSONALIZADO (Carlos Mode)...");
    const testCopy = await generateHyperPersonalizedOutreach(prospectoFicticio, memory);

    console.log("\n------ RESULTADO DEL CORREO FINAL ------\n");
    console.log(testCopy);
    console.log("\n----------------------------------------\n");
}

runRAGTest();
