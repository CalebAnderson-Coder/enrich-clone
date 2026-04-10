import dotenv from 'dotenv';
dotenv.config();

import { AgentRuntime } from './lib/AgentRuntime.js';
import { davinci } from './agents/davinci.js';

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

runtime.registerAgent(davinci);

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TEST 1: Negocio SIN web → Debe elegir LANDING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const prompt1 = `Por favor evalúa este perfil, ejecuta la tool adecuada y devuelve el JSON.
Business: Tacos El Patrón
Industry: Restaurantes
Website: Ninguno (solo tienen un perfil viejo de Google Maps)

MEGA PROFILE:
{
  "strengths": ["Buenas reseñas en Google (4.8★)", "Alta actividad local", "Tacos reconocidos en la zona"],
  "weaknesses": ["Sin sitio web", "Sin presencia digital organizada", "Sin captación de leads online"],
  "ads_activity": null,
  "instagram": { "followers": 85, "posts": 3 },
  "google_reviews": { "rating": 4.8, "count": 230 }
}`;

  console.log('▶ Ejecutando DaVinci...');
  const result1 = await runtime.run('DaVinci', prompt1, { currentAgent: 'DaVinci' });
  
  console.log('\n📋 RESULTADO DAVINCI:');
  console.log('─────────────────────');
  console.log(result1.response);
  
  // Parse and validate
  try {
    let clean = result1.response.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log('\n✅ JSON parseado exitosamente:');
      console.log(`   Tipo: ${parsed.magnet_type}`);
      console.log(`   Razón: ${parsed.decision_reasoning?.substring(0, 120)}...`);
      console.log(`   Asset URL: ${parsed.visual_asset_url}`);
      console.log(`   Stitch ID: ${parsed.stitch_project_id}`);
      console.log(`   Email Subject: ${parsed.angela_email_subject}`);
      if (parsed.visual_strategy) {
        console.log(`   🎯 Target Emotion: ${parsed.visual_strategy.target_emotion}`);
        console.log(`   📝 Copy Framework: ${parsed.visual_strategy.copy_framework}`);
        console.log(`   🎨 Color Rationale: ${parsed.visual_strategy.color_rationale?.substring(0, 120)}...`);
      }
    }
  } catch (e) {
    console.error('❌ Error parseando JSON:', e.message);
  }
}

async function runTest2() {
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TEST 2: Negocio CON web + Ads → Debe elegir ADS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const prompt2 = `Por favor evalúa este perfil, ejecuta la tool adecuada y devuelve el JSON.
Business: Bella Nails Studio
Industry: Salón de Belleza / Uñas
Website: https://bellanails.com (landing básica pero funcional)

MEGA PROFILE:
{
  "strengths": ["Buena web básica", "Buen engagement local", "Clientela fiel"],
  "weaknesses": ["Ads de Facebook con imágenes de baja calidad (fotos de celular)", "CTAs genéricos en sus anuncios", "No usan remarketing"],
  "ads_activity": {
    "platform": "Facebook Ads",
    "monthly_spend": "$300-500",
    "ad_quality": "Baja - fotos pixeladas tomadas con celular, sin diseño profesional",
    "current_ads": ["Promo uñas acrílicas $25", "Pedicure especial fin de semana"],
    "cta": "Llámanos"
  },
  "instagram": { "followers": 2400, "posts": 180 },
  "google_reviews": { "rating": 4.6, "count": 89 }
}`;

  console.log('▶ Ejecutando DaVinci para ADS path...');
  const result2 = await runtime.run('DaVinci', prompt2, { currentAgent: 'DaVinci' });
  
  console.log('\n📋 RESULTADO DAVINCI (ADS):');
  console.log('─────────────────────');
  console.log(result2.response);
  
  try {
    let clean = result2.response.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log('\n✅ JSON parseado exitosamente:');
      console.log(`   Tipo: ${parsed.magnet_type}`);
      console.log(`   Razón: ${parsed.decision_reasoning?.substring(0, 120)}...`);
      console.log(`   Asset URL: ${parsed.visual_asset_url}`);
      console.log(`   Imagen Prompt: ${parsed.gemini_imagen_prompt?.substring(0, 100)}...`);
      console.log(`   Email Subject: ${parsed.angela_email_subject}`);
      if (parsed.visual_strategy) {
        console.log(`   🎯 Target Emotion: ${parsed.visual_strategy.target_emotion}`);
        console.log(`   📝 Copy Framework: ${parsed.visual_strategy.copy_framework}`);
        console.log(`   🎨 Color Rationale: ${parsed.visual_strategy.color_rationale?.substring(0, 120)}...`);
      }
    }
  } catch (e) {
    console.error('❌ Error parseando JSON:', e.message);
  }
}

// Run only Test 2 (ADS path)
const testNum = process.argv[2] || '1';
if (testNum === '2') {
  runTest2().catch(console.error);
} else {
  run().catch(console.error);
}
