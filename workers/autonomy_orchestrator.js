// ============================================================
// workers/autonomy_orchestrator.js
//
// Pure-logic orchestration for the Manager daemon. Rotates the
// (niche × metro) cursor deterministically, fans out Scout runs
// (Macro-Flujo 1) and enqueues pending HOT leads into the
// enrichment pipeline (Macro-Flujo 2) with a bounded concurrency
// semaphore.
//
// Heavy dependencies (Supabase, AgentRuntime) are pulled in
// lazily / via injection so this module can be unit-tested with
// fake clocks and stubbed runners.
// ============================================================

import { runPipelineForBrand, runEnrichForLead } from './pipelineRunner.js';
import { assertSendAllowed, GuardrailBlocked } from '../lib/guardrails.js';
import { supabase as defaultSupabase } from '../lib/supabase.js';

// ── Reference data (frozen) ──────────────────────────────────

// 20 ICP oficiales de Empírika — en inglés como aparecen en
// Google Maps. Mantener sincronizado con agents/manager.js (L86-106).
export const EMPIRIKA_NICHES = Object.freeze([
  'General construction',
  'Remodeling',
  'Junk removal',
  'HVAC',
  'Plumbing',
  'Electrical',
  'Maid services',
  'Landscaping',
  'Roofing',
  'Painting',
  'Pest control',
  'Handyman',
  'Moving services',
  'Pool service',
  'Flooring',
  'Smart home',
  'Pressure washing',
  'Tree service',
  'Appliance repair',
  'Gutter cleaning',
]);

export const LATINO_METROS = Object.freeze([
  'Miami FL',
  'Orlando FL',
  'Houston TX',
  'Dallas TX',
  'Phoenix AZ',
  'Los Angeles CA',
  'New York NY',
  'Chicago IL',
  'Atlanta GA',
  'San Antonio TX',
]);

// ── Cursor math ──────────────────────────────────────────────

/**
 * Advance the (niche, metro) cursor `count` steps (default 2)
 * and return:
 *   - pairs: [{ niche, metro }, ...] of length `count`
 *   - next:  the cursor to persist afterwards
 *
 * The cursor is a plain JSON object: { nicheIdx, metroIdx }.
 * Rotation advances metroIdx first, rolls over to the next
 * nicheIdx when it wraps. That way back-to-back cycles cover
 * distinct metros before repeating a niche.
 */
export function pickNext(cursor, { count = 2 } = {}) {
  let nicheIdx = Number.isInteger(cursor?.nicheIdx) ? cursor.nicheIdx : 0;
  let metroIdx = Number.isInteger(cursor?.metroIdx) ? cursor.metroIdx : 0;

  const pairs = [];
  for (let i = 0; i < count; i++) {
    const niche = EMPIRIKA_NICHES[nicheIdx % EMPIRIKA_NICHES.length];
    const metro = LATINO_METROS[metroIdx % LATINO_METROS.length];
    pairs.push({ niche, metro });

    // advance
    metroIdx++;
    if (metroIdx >= LATINO_METROS.length) {
      metroIdx = 0;
      nicheIdx = (nicheIdx + 1) % EMPIRIKA_NICHES.length;
    }
  }

  return { pairs, next: { nicheIdx, metroIdx } };
}

// ── Bounded concurrency helper (no new deps) ─────────────────
async function runWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const myIdx = i++;
      if (myIdx >= items.length) return;
      try {
        results[myIdx] = await worker(items[myIdx], myIdx);
      } catch (err) {
        results[myIdx] = { error: err?.message || String(err) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ── RADAR cycle — Scout on 2 pairs in parallel ───────────────
export async function runRadarCycle({
  brandId,
  pairs,
  source = 'daemon',
  pipelineFn = runPipelineForBrand,
}) {
  if (!brandId) return { ok: false, error: 'brandId required' };
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { ok: false, error: 'pairs required' };
  }

  const settled = await Promise.allSettled(
    pairs.map(({ niche, metro }) => pipelineFn({ brandId, niche, metro, source }))
  );

  const perPair = settled.map((r, idx) => ({
    niche:  pairs[idx].niche,
    metro:  pairs[idx].metro,
    status: r.status,
    ok:     r.status === 'fulfilled' && r.value?.success !== false,
    error:  r.status === 'rejected' ? (r.reason?.message || String(r.reason))
           : (r.value?.error || null),
  }));

  return {
    ok: perPair.every(p => p.ok),
    pairs: perPair,
  };
}

// ── ENRICH backlog — pull HOT leads w/o campaign and enqueue ──
export async function runEnrichBacklog({
  brandId,
  limit = 20,
  concurrency = 3,
  supabase: sb = defaultSupabase,
  enrichFn = runEnrichForLead,
}) {
  if (!brandId) return { ok: false, error: 'brandId required' };
  if (!sb) return { ok: false, error: 'supabase client unavailable', processed: 0 };

  try {
    await assertSendAllowed({ brandId });
  } catch (err) {
    if (err instanceof GuardrailBlocked) {
      return { ok: false, blocked: err.reason, processed: 0 };
    }
    throw err;
  }

  // 1. Fetch HOT leads for brand
  const { data: hotLeads, error: e1 } = await sb
    .from('leads')
    .select('id, business_name')
    .eq('brand_id', brandId)
    .eq('lead_tier', 'HOT')
    .order('created_at', { ascending: false })
    .limit(limit * 3); // over-fetch; filter out enriched below

  if (e1) return { ok: false, error: e1.message, processed: 0 };
  if (!hotLeads || hotLeads.length === 0) {
    return { ok: true, processed: 0, enqueued: [] };
  }

  // 2. Remove ones that already have a campaign row
  const ids = hotLeads.map(l => l.id);
  const { data: existing, error: e2 } = await sb
    .from('campaign_enriched_data')
    .select('prospect_id')
    .eq('brand_id', brandId)
    .in('prospect_id', ids);

  if (e2) return { ok: false, error: e2.message, processed: 0 };

  const already = new Set((existing || []).map(r => r.prospect_id));
  const todo = hotLeads.filter(l => !already.has(l.id)).slice(0, limit);

  if (todo.length === 0) return { ok: true, processed: 0, enqueued: [] };

  // 3. Run enrichment with bounded concurrency
  const results = await runWithLimit(todo, concurrency, async (lead) => {
    return enrichFn({ leadId: lead.id, brandId, source: 'daemon' });
  });

  const ok = results.filter(r => r && r.success !== false).length;
  return {
    ok: true,
    processed: todo.length,
    succeeded: ok,
    enqueued: todo.map(t => ({ id: t.id, business: t.business_name })),
  };
}
