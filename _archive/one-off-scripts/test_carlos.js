import dotenv from 'dotenv';
dotenv.config();

import { carlos } from './agents/carlos.js';
import { AgentRuntime } from './lib/AgentRuntime.js';

async function testCarlos() {
  console.log("🤖 Iniciando prueba de Carlos Empirika con RAG...\n");
  
  // Create a fake UUID for testing
  const prospect_id = crypto.randomUUID();
  const testInstagram = "https://www.instagram.com/empirika.agency/"; // Using Empirika's own IG or any target
  
  const messages = [
    { 
      role: "user", 
      content: `Tenemos un nuevo prospecto. Su ID es ${prospect_id}. 
      Su perfil de Instagram es: ${testInstagram}.
      
      POR FAVOR:
      1. Usa la herramienta 'scrapeClientInstagram' para explorar su perfil.
      2. No tienes que esperar la transcripción ahora mismo. Solo analiza lo que extraigas.
      3. Luego dime qué opinas sobre cómo podemos abordarlo.` 
    }
  ];

  try {
    const runtime = new AgentRuntime({
      geminiApiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-2.0-flash',
    });
    runtime.registerAgent(carlos);

    console.log(`Enviando mensaje a ${carlos.name}...\n`);
    
    // Convert target to proper string instead of array of objects if needed, 
    // wait, runtime.run takes (agentName, messageString, context)
    const result = await runtime.run(carlos.name, messages[0].content, {});
    
    console.log("\n=================================");
    console.log("📝 RESPUESTA FINAL DE CARLOS:");
    console.log("=================================\n");
    console.log(result.response);
    
  } catch (error) {
    console.error("❌ Error en la prueba:", error);
  }
}

testCarlos();
