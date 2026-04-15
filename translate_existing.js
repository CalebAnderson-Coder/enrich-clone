import { AgentRuntime, Agent } from './lib/AgentRuntime.js';
import { supabase } from './supabaseUtils.js';
import dotenv from 'dotenv';
dotenv.config();

const runtime = new AgentRuntime({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
});

const translatorAgent = new Agent({
  name: 'Translator',
  systemPrompt: `You are an expert translator specializing in marketing and B2B sales terminology. 
Your job is to translate the given text from English to Spanish.
Ensure the tone is native, professional, and persuasive.
Respond with the JSON format strictly as given in the prompt. Do not add markdown around it if possible, just the JSON string.`
});

runtime.registerAgent(translatorAgent);

async function translateExisting() {
  const { data: campaignRows, error } = await supabase.from('campaign_enriched_data').select('*');
  if (error || !campaignRows) {
    console.error('Error fetching campaign data:', error);
    return;
  }

  const { data: leadsData } = await supabase.from('leads').select('id, mega_profile');

  console.log(`\n🌍 Iniciando traducción de ${campaignRows.length} registros (Radiografía y Angulo de Ataque)...`);

  let count = 1;
  for (const row of campaignRows) {
    console.log(`[${count}/${campaignRows.length}] Traduciendo row_id: ${row.id}...`);

    let parsedMegaProfile = {};
    const leadMatch = leadsData?.find(l => l.id === row.prospect_id);
    if (leadMatch?.mega_profile) {
      try {
         parsedMegaProfile = typeof leadMatch.mega_profile === 'string' ? JSON.parse(leadMatch.mega_profile) : leadMatch.mega_profile;
      } catch (e) { }
    }

    let radarSummary = parsedMegaProfile?.radar_parsed?.radar_summary || "";

    const prompt = `Translate the following three technical observation and sales fields into professional B2B Spanish. 
Maintain the business implications and factual observations. Keep it concise.
Return ONLY a valid JSON object matching this structure:
{
  "radiography_technical": "(Translated Spanish text of the technical)",
  "attack_angle": "(Translated Spanish text of the attack angle)",
  "radar_summary": "(Translated Spanish text of the radar summary)"
}

TEXT TO TRANSLATE:
Technical: ${row.radiography_technical || ''}
Attack Angle: ${row.attack_angle || ''}
Radar Summary: ${radarSummary || ''}`;

    try {
      const result = await runtime.run('Translator', prompt, { maxIterations: 3 });
      
      let parsed = {};
      const jsonMatch = result.response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
      } else {
          const fallbackMatch = result.response.match(/\{[\s\S]*?\}/);
          if (fallbackMatch) parsed = JSON.parse(fallbackMatch[0]);
      }

      // Update the campaign table
      await supabase.from('campaign_enriched_data').update({
        radiography_technical: parsed.radiography_technical || row.radiography_technical,
        attack_angle: parsed.attack_angle || row.attack_angle
      }).eq('id', row.id);

      // If radar_summary was translated, update the lead's mega_profile
      if (parsed.radar_summary && parsedMegaProfile.radar_parsed) {
         parsedMegaProfile.radar_parsed.radar_summary = parsed.radar_summary;
         await supabase.from('leads').update({
            mega_profile: JSON.stringify(parsedMegaProfile)
         }).eq('id', row.prospect_id);
      }

    } catch (err) {
      console.log(`  ⚠️ Error al traducir:`, err.message);
    }
    
    count++;
  }
  console.log('✅ Traducción finalizada.');
}

translateExisting();
