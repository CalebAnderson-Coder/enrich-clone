// ============================================================
// Fix all broken outreach_copy entries using Gemini directly
// Uses 'prospects' table (not 'leads') for lead data
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(
  process.env.SUPABASE_URL || 'https://wzdhxnnpupbybxzbdrna.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6ZGh4bm5wdXBieWJ4emJkcm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTU0NzQsImV4cCI6MjA5MTIzMTQ3NH0.DMQ8bcxA_Na1FQzTl2-qxNsjzsLNQShRewA2qm9Sb-0'
);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
    })
  });
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function main() {
  // 1. Get all broken campaign_enriched_data
  const { data: broken } = await sb.from('campaign_enriched_data')
    .select('prospect_id, outreach_copy, radiography_technical, attack_angle')
    .like('outreach_copy', '%max iterations%');

  if (!broken?.length) {
    console.log('✅ No broken outreach to fix!');
    return;
  }

  console.log(`🔧 Fixing ${broken.length} broken outreach entries via Gemini...\n`);

  let fixed = 0, failed = 0;

  for (const row of broken) {
    // Get prospect info from 'prospects' table
    const { data: prospect } = await sb.from('prospects')
      .select('business_name, website, phone, city, rating, reviews_count')
      .eq('id', row.prospect_id)
      .single();

    if (!prospect) {
      console.log(`  ⚠️ ${row.prospect_id} — prospect not found, skipping`);
      failed++;
      continue;
    }

    console.log(`  📧 [${fixed+failed+1}/${broken.length}] ${prospect.business_name}...`);

    const prompt = `Eres Angela, la copywriter de Empírika — una agencia de marketing digital para negocios hispanos en USA.

Escribe un cold email profesional en ESPAÑOL para este negocio:

Negocio: ${prospect.business_name}
Website: ${prospect.website || 'No tiene'}
Ciudad: ${prospect.city || 'USA'}
Rating Google: ${prospect.rating || 'N/A'} (${prospect.reviews_count || 0} reseñas)
Teléfono: ${prospect.phone || 'N/A'}

Análisis previo: ${(row.radiography_technical || '').substring(0, 500)}
Ángulo de ataque: ${row.attack_angle || 'Mejorar presencia digital y captar más clientes'}

INSTRUCCIONES:
- Escribe Subject y Body del email
- Tono: profesional, cálido, directo, como de agencia boutique  
- NO seas genérico — referencia datos específicos del negocio (reseñas, website, zona)
- Incluye un CTA claro: agendar una reunión de 15 minutos
- El email debe sentirse personalizado, NO automatizado
- Firma como: Angela M. | Empírika Digital

Responde EXACTAMENTE con este formato:
Subject: [tu subject line aquí]

[body del email aquí]`;

    try {
      const response = await callGemini(prompt);
      
      if (!response || response.length < 50) {
        console.log(`    ❌ Gemini returned empty/short response`);
        failed++;
        continue;
      }

      // Update campaign_enriched_data
      const { error } = await sb.from('campaign_enriched_data')
        .update({ outreach_copy: response })
        .eq('prospect_id', row.prospect_id);

      if (error) {
        console.log(`    ❌ DB error: ${error.message}`);
        failed++;
      } else {
        const preview = response.substring(0, 80).replace(/\n/g, ' ');
        console.log(`    ✅ ${preview}...`);
        fixed++;
      }

      // Rate limit — 500ms between calls
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Done! Fixed: ${fixed} | Failed: ${failed} | Total: ${broken.length}`);
}

main().catch(console.error);
