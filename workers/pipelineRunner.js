// ============================================================
// workers/pipelineRunner.js — Reusable entry points for the two
// Macro-Flujos, shared by HTTP endpoints and the Manager daemon.
//
// Keeping the orchestration logic here (instead of inline in
// index.js) lets the Sprint-1 autonomy daemon drive Scout and
// Macro-Flujo 2 without going through the Express stack.
//
// Contract (both helpers):
//   - never throw: return { success, ... , error? }
//   - accept `source='api'|'daemon'|'test'` so observability
//     can distinguish human clicks from autonomous ticks.
// ============================================================

import { getLeadById, updateLeadOutreach } from '../tools/database.js';
import { supabase } from '../lib/supabase.js';

// The runtime is a heavy singleton — resolve it lazily so this
// file stays safe to import from tests that stub dependencies.
let _runtimePromise = null;
async function getRuntime() {
  if (_runtimePromise) return _runtimePromise;
  _runtimePromise = (async () => {
    const { AgentRuntime } = await import('../lib/AgentRuntime.js');
    const { manager }  = await import('../agents/manager.js');
    const { scout }    = await import('../agents/scout.js');
    const { helena }   = await import('../agents/helena.js');
    const { sam }      = await import('../agents/sam.js');
    const { kai }      = await import('../agents/kai.js');
    const { carlos }   = await import('../agents/carlos.js');
    const { angela }   = await import('../agents/angela.js');
    const { davinci }  = await import('../agents/davinci.js');
    const { verifier } = await import('../agents/verifier.js');

    const runtime = new AgentRuntime({
      apiKey: process.env.NVIDIA_API_KEY,
      model: 'meta/llama-3.1-70b-instruct',
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
    [manager, scout, helena, sam, kai, carlos, angela, davinci, verifier]
      .forEach(a => runtime.registerAgent(a));
    return runtime;
  })();
  return _runtimePromise;
}

// Inject a pre-built runtime (tests). Passed instance must already
// have the agents registered.
export function __setRuntimeForTest(instance) {
  _runtimePromise = Promise.resolve(instance);
}

// ── Macro-Flujo 1: Scout prospecting ─────────────────────────
export async function runPipelineForBrand({ brandId, niche, metro, source = 'api' }) {
  if (!brandId || !niche || !metro) {
    return { success: false, error: 'brandId, niche and metro are required' };
  }

  const runtime = await getRuntime();

  const managerPrompt = `Por favor, ejecuta un Macro-Flujo de prospectación (El Radar) para el Nicho: "${niche}" en la Ciudad: "${metro}".

INSTRUCCIONES PARA TI (Orquestador):
1. Delega al agente 'scout' la tarea de buscar hasta 5 negocios para este nicho en esta ciudad usando scrapeGoogleMaps.
2. Pide a Scout que filtre, califique (HOT, WARM, etc.) y guarde los leads en la base de datos.
3. Cuando Scout regrese con los leads guardados, devuélveme un resumen estructurado indicando cuántos encontró y los mejores perfiles (HOT).

Recuerda: Este flujo es puro volumen y prospección. Solo interactúa con 'scout'. NO analices ni escribas correos todavía.
Fuente del disparo: ${source}.`;

  try {
    const result = await runtime.run('Manager', managerPrompt, {
      currentAgent: 'Manager',
      maxIterations: 20,
      brandId,
    });
    return { success: true, response: result.response, iterations: result.iterations };
  } catch (err) {
    console.error('[pipelineRunner] runPipelineForBrand error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Macro-Flujo 2: deep enrichment + outreach drafts ─────────
export async function runEnrichForLead({ leadId, brandId, source = 'api' }) {
  if (!leadId || !brandId) {
    return { success: false, error: 'leadId and brandId are required' };
  }

  const lead = await getLeadById(leadId, brandId);
  if (!lead) return { success: false, error: 'Lead not found' };

  const runtime = await getRuntime();

  const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - MEGA Enrichment + Ventas) para este negocio (lead HOT):
- Negocio: ${lead.business_name}
- Industria: ${lead.industry || 'N/A'}
- Ciudad: ${lead.metro_area}
- Web: ${lead.website || 'Sin web'}
- Rating: ${lead.rating} (${lead.review_count} reseñas)
- Google Maps: ${lead.google_maps_url || 'N/A'}

INSTRUCCIONES DE DELEGACIÓN ESTRICTA EN ORDEN:
1. Delega a 'Helena', 'Sam' y 'Kai' para hacer una radiografía técnica del lead (SEO/Velocidad, Ads y Redes Sociales).
2. Con los hallazgos de esos tres agentes, delega a 'Carlos' para armar el 'Attack Angle' estratégico.
3. Con el Angle de Carlos listo, delega a 'Angela' para crear el copy de multi-contacto (Email, WhatsApp, Instagram).
4. Devuélveme todo consolidado en español (Markdown).

MANDATORIO: Al final de tu respuesta, DEBES incluir el bloque JSON con los borradores así:
OUTREACH_JSON_START
{
  "subject": "Email Subject",
  "body": "Email Body HTML",
  "whatsapp": "WhatsApp Msg",
  "instagram": "Instagram/FB DM"
}
OUTREACH_JSON_END
(Fuente del disparo: ${source}.)`;

  try {
    const result = await runtime.run('Manager', enrichPrompt, {
      currentAgent: 'Manager',
      maxIterations: 30,
      brandId,
    });

    let parsedOutreach = null;
    const m = result.response.match(/OUTREACH_JSON_START([\s\S]*?)OUTREACH_JSON_END/);
    if (m && m[1]) {
      try { parsedOutreach = JSON.parse(m[1].trim()); }
      catch (e) { console.error('[pipelineRunner] outreach JSON parse:', e.message); }
    }

    if (parsedOutreach) {
      // Stamp auto_approve_at so the dispatcher can pick it up when
      // AUTONOMY_ENABLED=true. We write via updateLeadOutreach (which
      // already handles the legacy path) and then patch the timestamp.
      await updateLeadOutreach(lead.id, parsedOutreach, 'PENDING', null, brandId);

      try {
        const timeoutMs = Number(process.env.AUTO_APPROVE_TIMEOUT_MS || 7200000);
        const autoAt = new Date(Date.now() + timeoutMs).toISOString();
        if (supabase) {
          await supabase
            .from('campaign_enriched_data')
            .update({ auto_approve_at: autoAt })
            .eq('prospect_id', lead.id)
            .eq('brand_id', brandId);
        }
      } catch (err) {
        console.warn('[pipelineRunner] auto_approve_at stamp failed:', err.message);
      }
    }

    return {
      success: true,
      lead_id: lead.id,
      business_name: lead.business_name,
      enrichment: result.response,
      parsed_outreach: parsedOutreach,
      iterations: result.iterations,
    };
  } catch (err) {
    console.error('[pipelineRunner] runEnrichForLead error:', err.message);
    return { success: false, error: err.message };
  }
}
