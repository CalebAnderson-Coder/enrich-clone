// scripts/enrich_pending_batch.js — Enrich all PENDING leads missing campaign_enriched_data
//
// Usage:
//   node scripts/enrich_pending_batch.js [batch_size] [metro]
//     batch_size  = max leads to process (default 10)
//     metro       = optional metro filter substring (default: all PENDING)
//
//   Examples:
//     node scripts/enrich_pending_batch.js 25         # all PENDING, top 25
//     node scripts/enrich_pending_batch.js 5 Orlando  # Orlando only, top 5
//
// 2026-04-28: arreglado para (1) NO restringir a Orlando hardcoded (los 22
// PENDING actuales están repartidos en Orlando/Miami/Tampa/Houston) y (2)
// pasar apiKey NVIDIA al AgentRuntime para que tenga fallback efectivo cuando
// Gemini topa cuota (incidente 04-25→28).
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { manager } from '../agents/manager.js';
import { scout } from '../agents/scout.js';
import { angela } from '../agents/angela.js';
import { helena } from '../agents/helena.js';
import { sam } from '../agents/sam.js';
import { kai } from '../agents/kai.js';
import { carlos } from '../agents/carlos.js';
import { supabase, saveCampaignData } from '../supabaseUtils.js';
import dotenv from 'dotenv';
dotenv.config();

// Pass apiKey (NVIDIA) so AgentRuntime can use NVIDIA as fallback when
// Gemini 429s. Without this, Helena topa cuota y se cae sin recovery.
// PRIMARY_LLM env decide cuál es primary; default 'nvidia'.
const runtime = new AgentRuntime({
  apiKey: process.env.NVIDIA_API_KEY,
  model: 'meta/llama-3.1-70b-instruct',
});

runtime.registerAgent(manager);
runtime.registerAgent(scout);
runtime.registerAgent(angela);
runtime.registerAgent(helena);
runtime.registerAgent(sam);
runtime.registerAgent(kai);
runtime.registerAgent(carlos);

async function getUnenrichedLeads(metroFilter) {
  // Default scope: every lead with outreach_status='PENDING' (waiting for enrich).
  // Optional metroFilter narrows it (substring match, case-insensitive).
  let query = supabase
    .from('leads')
    .select('*')
    .eq('outreach_status', 'PENDING')
    .order('created_at', { ascending: false });
  if (metroFilter) {
    query = query.ilike('metro_area', `%${metroFilter}%`);
  }
  const { data: leads } = await query;

  // Skip leads that already have a campaign_enriched_data row.
  const { data: enriched } = await supabase
    .from('campaign_enriched_data')
    .select('prospect_id');

  const enrichedIds = new Set((enriched || []).map(e => e.prospect_id));
  return (leads || []).filter(l => !enrichedIds.has(l.id));
}

// Lista de prospect_ids cuyo campaign_enriched_data tiene copy débil.
// Considera "débil" cualquiera de: outreach_copy NULL, length<50, o que
// match alguno de los placeholder tokens conocidos.
async function getWeakEnrichments() {
  // Order created_at DESC: priorizamos enrichments más recientes primero.
  // Sin esto el script procesaba históricos viejos antes que los del batch
  // que acaba de correr — a 2 min/lead se gastan 80+ min en cola innecesaria.
  const { data, error } = await supabase
    .from('campaign_enriched_data')
    .select('id, prospect_id, outreach_copy, attack_angle, radiography_technical, leads:prospect_id(id, business_name, metro_area, industry, website, phone, rating, review_count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const WEAK_TOKENS = ['pendiente de revisión', 'sin copy', 'sin ángulo', 'sin radiografía', 'subject: ...', 'asunto: ...'];
  const isWeak = (s) => {
    if (!s) return true;
    if (s.length < 50) return true;
    const lower = s.toLowerCase();
    return WEAK_TOKENS.some(t => lower.includes(t));
  };
  return (data || [])
    .filter(r => r.leads && (isWeak(r.outreach_copy) || isWeak(r.attack_angle)))
    .map(r => ({
      ...r.leads,
      _ced_id: r.id,
    }));
}

async function enrichLead(lead, index, total, mode = 'create') {
  const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - Enriquecimiento y Ventas) para este negocio REAL:

RESTRICCIÓN DE EJECUCIÓN (verifier audit 2026-04-28): Tu tarea en este run es SOLO generar análisis y copy (radiography_technical, attack_angle, outreach_copy). NO llames sendEmail, sendBatchEmails, ni requestApproval. NO envíes emails reales. NO dispares ninguna herramienta de outreach. Solo devolvé el JSON con los tres campos al final. La aprobación humana y el envío los maneja un proceso posterior.

DATOS DEL LEAD:
- Nombre: ${lead.business_name}
- Ciudad: ${lead.metro_area || 'Orlando, FL'}
- Industria: ${lead.industry || 'Remodeling/Roofing'}
- Website: ${lead.website || 'No disponible'}
- Teléfono: ${lead.phone || 'No disponible'}
- Rating: ${lead.rating || 'N/A'}
- Reviews: ${lead.review_count || 0}

INSTRUCCIONES:
1. Usa tus herramientas de búsqueda web para investigar la presencia online REAL de esta empresa.
2. Haz una radiografía técnica de su presencia digital (website, SEO, social, publicidad).
3. Define el ángulo de ataque ("attack angle") para el mercado hispano.
4. Genera el email copy (subject + body) en Spanglish auténtico que Angela usaría.
5. Devuelve la respuesta SIEMPRE como bloque JSON entre triple backticks. Las keys del JSON son literalmente: radiography_technical, attack_angle, outreach_copy. Para outreach_copy, escribir el cuerpo del email en español, formato "Asunto: <texto real> | Cuerpo: <texto real del email>". NO devolver placeholders genéricos como "Subject: ..." o "Ángulo de ventas en 1 párrafo" — esos son descriptivos del schema, no datos. Si no encontrás suficiente información para un campo, escribilo igual con un fallback honesto (ej. "No se encontró información suficiente sobre presencia digital, propuesta basada en industria/zona").

Schema obligatorio (sustituí los <texto real ...> por contenido real, NO copies estos placeholders):
\`\`\`json
{
  "radiography_technical": "<texto real de 1-2 párrafos describiendo la presencia online>",
  "attack_angle": "<texto real de 1 párrafo con el ángulo de venta>",
  "outreach_copy": "Asunto: <asunto real, 30-60 chars> | Cuerpo: <cuerpo real del email, mínimo 100 palabras>"
}
\`\`\``;

  console.log(`\n[${index}/${total}] 🔬 Enriqueciendo: ${lead.business_name}...`);
  
  try {
    const result = await runtime.run('Manager', enrichPrompt, { currentAgent: 'Manager', maxIterations: 20 });

    // Parser robusto: 4 estrategias en cascada antes de caer al placeholder.
    // Detecta también el modo "el agente copió el placeholder del schema" y lo trata como inválido.
    const PLACEHOLDER_TOKENS = [
      'Subject: ...', 'Asunto: ...',
      'Ángulo de ventas en 1 párrafo', 'Evaluación técnica en 1-2 párrafos',
      '<texto real', 'Sin Radiografía', 'Sin Ángulo', 'Sin Copy',
    ];
    const looksLikePlaceholder = (s) =>
      typeof s === 'string' && PLACEHOLDER_TOKENS.some(t => s.toLowerCase().includes(t.toLowerCase()));

    const tryParse = (raw) => {
      if (!raw) return null;
      const cleaned = String(raw)
        .replace(/,\s*([}\]])/g, '$1')   // trailing commas
        .replace(/[“”]/g, '"') // smart quotes → double
        .replace(/[‘’]/g, "'");
      try { return JSON.parse(cleaned); } catch { return null; }
    };

    const extractJSON = (text) => {
      if (!text) return null;
      // Estrategia 1: bloque ```json ... ``` greedy
      let m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (m) {
        const parsed = tryParse(m[1]);
        if (parsed) return parsed;
      }
      // Estrategia 2: bloque ```...``` cualquier
      m = text.match(/```\s*([\s\S]*?)\s*```/);
      if (m) {
        const parsed = tryParse(m[1]);
        if (parsed) return parsed;
      }
      // Estrategia 3: greedy outermost {...}
      m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = tryParse(m[0]);
        if (parsed) return parsed;
      }
      // Estrategia 4: non-greedy primer {...} (último recurso)
      m = text.match(/\{[\s\S]*?\}/);
      if (m) return tryParse(m[0]);
      return null;
    };

    const parsed = extractJSON(result.response);
    let enrichData;
    if (parsed && typeof parsed === 'object') {
      enrichData = {
        radiography_technical: looksLikePlaceholder(parsed.radiography_technical) ? null : parsed.radiography_technical,
        attack_angle:          looksLikePlaceholder(parsed.attack_angle)          ? null : parsed.attack_angle,
        outreach_copy:         looksLikePlaceholder(parsed.outreach_copy)         ? null : parsed.outreach_copy,
      };
    } else {
      // No JSON parseable — guardamos el response crudo como attack_angle (mejor info que "Pendiente").
      console.log(`  ⚠️ JSON parse fallback for ${lead.business_name} — preservando response crudo`);
      enrichData = {
        radiography_technical: null,
        attack_angle:          result.response?.slice(0, 1000) || null,
        outreach_copy:         null,
      };
    }

    // Preferí el campo del enrichData si tiene contenido sustantivo (>50 chars).
    // El fallback "Sin X" solo se usa si el campo viene null o muy corto — esto
    // preserva el response crudo guardado en attack_angle cuando JSON falla.
    const pickField = (val, fallback) => {
      if (val && typeof val === 'string' && val.trim().length >= 50) return val;
      if (val && typeof val === 'string' && val.trim().length > 0) return val; // > 0 mejor que el placeholder
      return fallback;
    };
    const payload = {
      radiography_technical: pickField(enrichData.radiography_technical, "Sin Radiografía."),
      attack_angle:          pickField(enrichData.attack_angle,          "Sin Ángulo."),
      outreach_copy:         pickField(enrichData.outreach_copy,         "Sin Copy."),
      status: 'ENRICHED',
    };

    if (mode === 'update' && lead._ced_id) {
      // Retry mode: UPDATE row existente en lugar de INSERT.
      const { data: updated, error: upErr } = await supabase
        .from('campaign_enriched_data')
        .update({ ...payload, lead_magnet_status: 'COMPLETED' })
        .eq('id', lead._ced_id)
        .select()
        .single();
      if (upErr || !updated) {
        console.log(`  ❌ ${lead.business_name} → UPDATE failed: ${upErr?.message || 'no row'}`);
        return false;
      }
      console.log(`  ✅ ${lead.business_name} → Re-enriched & Updated (${updated.id})`);
      return true;
    }

    // Create mode (default): INSERT nueva row.
    const saved = await saveCampaignData({ prospect_id: lead.id, ...payload });
    if (saved) {
      await supabase.from('campaign_enriched_data')
        .update({ lead_magnet_status: 'COMPLETED' })
        .eq('id', saved.id);
      console.log(`  ✅ ${lead.business_name} → Enriched & Saved (${saved.id})`);
    } else {
      console.log(`  ⚠️ ${lead.business_name} → Enriched but save failed`);
    }
    return true;
  } catch (err) {
    console.error(`  ❌ Error enriching ${lead.business_name}:`, err.message);
    return false;
  }
}

async function main() {
  // Detect modo: si arg incluye --retry-weak, vamos por enrichments con copy débil.
  // Si no, default es PENDING leads sin campaign_enriched_data.
  const args = process.argv.slice(2);
  const retryWeak = args.includes('--retry-weak');
  const positional = args.filter(a => !a.startsWith('--'));
  const BATCH_SIZE   = parseInt(positional[0] || '10');
  const METRO_FILTER = retryWeak ? null : (positional[1] || null);

  const candidates = retryWeak
    ? await getWeakEnrichments()
    : await getUnenrichedLeads(METRO_FILTER);
  const scopeLabel = retryWeak
    ? 'enrichments con copy débil'
    : (METRO_FILTER ? `metro="${METRO_FILTER}"` : 'all PENDING');
  console.log(`\n🎯 Found ${candidates.length} leads (${scopeLabel}).`);

  if (candidates.length === 0) {
    console.log('✅ Nada que procesar.');
    return;
  }

  const batch = candidates.slice(0, BATCH_SIZE);
  const mode = retryWeak ? 'update' : 'create';
  console.log(`📦 Processing batch of ${batch.length} leads (of ${candidates.length} total) — mode=${mode}\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const ok = await enrichLead(batch[i], i + 1, batch.length, mode);
    if (ok) success++;
    else failed++;
    
    // Small delay between leads to not hit rate limits
    if (i < batch.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n📊 Batch complete: ${success} enriched, ${failed} failed`);
  console.log(`📦 Remaining: ${candidates.length - batch.length}`);
  
  // Show outreach readiness
  const { count } = await supabase
    .from('campaign_enriched_data')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ENRICHED')
    .eq('lead_magnet_status', 'COMPLETED')
    .is('outreach_status', null);
  
  console.log(`\n📬 Total leads ready for outreach dispatch: ${count}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
