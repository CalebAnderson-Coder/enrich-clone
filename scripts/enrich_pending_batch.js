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
4. Genera el email copy (subject + body) en español autentico que Angela usaría.
5. Devuelve la respuesta SIEMPRE como bloque JSON entre triple backticks. Las keys del JSON son literalmente: radiography_technical, attack_angle, outreach_copy. Para outreach_copy, escribir el cuerpo del email en español, formato "Asunto: <texto real> | Cuerpo: <texto real del email>". NO devolver placeholders genéricos como "Subject: ..." o "Ángulo de ventas en 1 párrafo" — esos son descriptivos del schema, no datos. Si no encontrás suficiente información para un campo, escribilo igual con un fallback honesto (ej. "No se encontró información suficiente sobre presencia digital, propuesta basada en industria/zona").

REGLA DE COPY LIMPIO (CRÍTICA):
- El email VA a salir tal cual lo escribas. NO dejes meta-instrucciones, condicionales ni razonamiento dentro del cuerpo.
- PROHIBIDO usar corchetes [...] dentro del outreach_copy. Nunca escribas "[Nombre del contacto, si lo encuentras en LinkedIn...]" o "[Equipo de X, si no encuentras nombre]". Decide tú la forma final del saludo y firma.
- Si no sabés el nombre del contacto, usa directamente "Equipo de ${lead.business_name}" o "Hola," — NO escribas instrucciones condicionales sobre cómo elegir el saludo.
- PROHIBIDO firmas con [Tu Nombre], [Empírika], [Empresa]. Firma cerrada: "Angela M. — Empírika Digital".
- PROHIBIDO frases "si lo encuentras", "si es posible", "si no, usa", "[opcional]" dentro del cuerpo.
- El outreach_copy debe ser texto enviable tal cual. Si lo lees y suena a borrador con notas para el editor, está mal — re-escribilo limpio.

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
    // 2026-04-29: code-reviewer audit detectó que la versión previa pasaba [Nombre del propietario],
    // "Estimado [", "Pendiente de revisión.", "No se encontró información suficiente" como válidos.
    // Patch: lista expandida + 2 regex (BRACKET_PLACEHOLDER, GENERIC_SALUTATION) + hard floor 100 chars.
    const PLACEHOLDER_TOKENS = [
      'subject: ...', 'asunto: ...', 'body: ...', 'cuerpo: ...',
      'ángulo de ventas en 1 párrafo', 'evaluación técnica',
      '<texto real', 'sin radiografía', 'sin ángulo', 'sin copy',
      'pendiente de revisión', 'pendiente de revision',
      'no se encontró información suficiente',
      'no se encontro informacion suficiente',
      'no se puede generar',
    ];
    const BRACKET_PLACEHOLDER = /\[(nombre|empresa|ciudad|propietario|cliente|negocio|owner|company)[^\]]*\]/i;
    const GENERIC_SALUTATION  = /\bestimad[oa]s?\s*\[/i;

    const looksLikePlaceholder = (s) => {
      if (typeof s !== 'string') return true;
      const lower = s.toLowerCase().trim();
      if (lower.length < 100) return true;                       // hard floor
      if (PLACEHOLDER_TOKENS.some(t => lower.includes(t))) return true;
      if (BRACKET_PLACEHOLDER.test(s)) return true;
      if (GENERIC_SALUTATION.test(s)) return true;
      return false;
    };

    // outreach_copy debe contener subject + body markers reales con cuerpo sustantivo
    const looksLikeRealCopy = (s) =>
      typeof s === 'string' &&
      s.length >= 120 &&
      /asunto\s*:/i.test(s) &&
      /cuerpo\s*:/i.test(s) &&
      !looksLikePlaceholder(s);

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

    // pickField con validador estricto. Si val no pasa el validator, devuelve fallback.
    // Code-reviewer audit 04-29: la versión previa con length>=50 || length>0 era una
    // farsa — cualquier string no vacío pasaba. Ahora outreach_copy exige looksLikeRealCopy.
    const pickField = (val, fallback, validator = (v) => !looksLikePlaceholder(v)) => {
      if (val && validator(val)) return val;
      return fallback;
    };

    // Si CUALQUIER field crítico falla el validator, marcamos el row como NEEDS_REWRITE
    // en vez de ENRICHED. El dispatcher solo procesa ENRICHED — esto es defense-in-depth.
    const validRadiography = !looksLikePlaceholder(enrichData.radiography_technical);
    const validAttack      = !looksLikePlaceholder(enrichData.attack_angle);
    const validOutreach    = looksLikeRealCopy(enrichData.outreach_copy);
    const allValid         = validRadiography && validAttack && validOutreach;

    const payload = {
      radiography_technical: pickField(enrichData.radiography_technical, null),
      attack_angle:          pickField(enrichData.attack_angle,          null),
      outreach_copy:         pickField(enrichData.outreach_copy,         null, looksLikeRealCopy),
      status: allValid ? 'ENRICHED' : 'NEEDS_REWRITE',
    };
    if (!allValid) {
      console.log(`  ⚠️ ${lead.business_name} → NEEDS_REWRITE (radio:${validRadiography} attack:${validAttack} outreach:${validOutreach})`);
    }

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
