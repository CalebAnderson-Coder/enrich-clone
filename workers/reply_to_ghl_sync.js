// ============================================================
// workers/reply_to_ghl_sync.js — Sync replied events to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Fetches outreach_events with event_type='replied' 
//      that haven't been synced yet (metadata.ghl_synced != true).
//   2. For each reply: POSTs a note to GHL /contacts/{id}/notes
//      with the reply preview.
//   3. Moves the lead to the GHL_STAGE_INTERESADO stage via 
//      PUT /opportunities/{id}.
//   4. Marks the event as synced in metadata.ghl_synced=true.
//   5. Retries once on failure (30s delay), then logs warning.
//      Does NOT break the cron on failure.
//
// Configuration:
//   - EMPIRIKA_GHL_KEY or GHL_API_KEY (required)
//   - GHL_STAGE_INTERESADO_ID (required, from env)
//   - GHL_PIPELINE_ID (required, from env)
//   - BRAND_ID (default: Empírika hardcoded UUID)
//
// Run modes:
//   node workers/reply_to_ghl_sync.js            # production cycle
//   node workers/reply_to_ghl_sync.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/resilience.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');

const GHL_KEY = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

const GHL_HEADERS = {
  'Authorization': `Bearer ${GHL_KEY}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json',
};

// Max age: don't process replies older than 24h (avoid massive backfills)
const MAX_REPLY_AGE_MS = 24 * 60 * 60 * 1000;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Get GHL contact ID from lead_id ──────────────────────────

/**
 * Looks up the GHL contact_id for a given lead_id by 
 * reading the leads table's ghl_id field.
 * Returns null if not found or if ghl_id is empty.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} lead_id
 * @returns {Promise<string|null>}
 */
async function getGHLContactId(supabase, lead_id) {
  const { data, error } = await supabase
    .from('leads')
    .select('ghl_id')
    .eq('id', lead_id)
    .maybeSingle();

  if (error) {
    logger.warn('reply_to_ghl_sync: failed to get GHL contact ID', { lead_id, err: error.message });
    return null;
  }

  return data?.ghl_id || null;
}

// ── Post note to GHL contact ─────────────────────────────────

/**
 * POSTs a note to GHL /contacts/{contactId}/notes endpoint.
 * Includes a preview of the reply message and timestamps.
 * Non-throwing — returns { ok, error }.
 *
 * @param {string} contactId - GHL contact ID
 * @param {object} event - outreach_events row
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function postReplyNoteToGHL(contactId, event) {
  const metadata = event.metadata || {};
  const replyBody = metadata.body || '(Sin vista previa)';
  const preview = replyBody.length > 300 
    ? replyBody.slice(0, 300) + '…'
    : replyBody;
  const replyFrom = metadata.from_email || 'desconocido';
  const replyDate = new Date(event.occurred_at).toLocaleString('es-ES');

  const noteText = `[Respuesta de prospect]
De: ${replyFrom}
Fecha: ${replyDate}

Vista previa:
${preview}`;

  try {
    const response = await withRetry(
      () => fetch(`${GHL_BASE_URL}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({ body: noteText, userId: undefined }),
      }),
      { maxRetries: 1, baseDelayMs: 30000, label: 'GHL-note-post' }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${errBody.slice(0, 100)}` };
    }

    logger.info('reply_to_ghl_sync: note posted', { contactId, eventId: event.id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Move opportunity to INTERESADO stage ──────────────────────

/**
 * PUTs to GHL /opportunities/{opportunityId} to move the stage
 * to GHL_STAGE_INTERESADO_ID.
 * Non-throwing — returns { ok, error }.
 *
 * @param {string} opportunityId - GHL opportunity ID (same as contact ID in many flows)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function moveOpportunityToInteresado(opportunityId) {
  if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
    logger.warn('reply_to_ghl_sync: GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID missing, skipping stage move', { opportunityId });
    return { ok: true }; // Not an error — just skip silently
  }

  try {
    const response = await withRetry(
      () => fetch(`${GHL_BASE_URL}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: GHL_HEADERS,
        body: JSON.stringify({
          pipelineId: GHL_PIPELINE_ID,
          pipelineStageId: GHL_STAGE_INTERESADO_ID,
        }),
      }),
      { maxRetries: 1, baseDelayMs: 30000, label: 'GHL-opp-put' }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${errBody.slice(0, 100)}` };
    }

    logger.info('reply_to_ghl_sync: opportunity moved to INTERESADO', { opportunityId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Process one replied event ────────────────────────────────

/**
 * Handles a single replied event:
 *   1. Gets the GHL contact ID
 *   2. Posts a note
 *   3. Moves the opportunity
 *   4. Marks the event as ghl_synced=true
 * 
 * Returns a result object — never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} event - outreach_events row
 * @returns {Promise<{status: string, [key: string]: any}>}
 */
async function processOneEvent(supabase, event) {
  const contactId = await getGHLContactId(supabase, event.lead_id);
  if (!contactId) {
    logger.warn('reply_to_ghl_sync: no GHL contact ID found, marking as skipped', { eventId: event.id, lead_id: event.lead_id });
    // Still mark as synced so we don't retry repeatedly
    await supabase
      .from('outreach_events')
      .update({ metadata: { ...event.metadata, ghl_synced: 'skipped_no_contact' } })
      .eq('id', event.id)
      .catch(e => logger.warn('Failed to mark event as skipped', { eventId: event.id, err: e.message }));
    return { status: 'skipped_no_contact' };
  }

  // Post note
  const noteResult = await postReplyNoteToGHL(contactId, event);
  if (!noteResult.ok) {
    logger.warn('reply_to_ghl_sync: note post failed', { eventId: event.id, error: noteResult.error });
    // Don't mark as synced — will retry next cycle
    return { status: 'note_post_failed', error: noteResult.error };
  }

  // Move opportunity (errors here don't block the whole sync)
  const moveResult = await moveOpportunityToInteresado(contactId);
  if (!moveResult.ok) {
    logger.warn('reply_to_ghl_sync: opportunity move failed', { eventId: event.id, error: moveResult.error });
    // Still mark note as synced since that worked
  }

  // Mark event as synced
  const { error: updateErr } = await supabase
    .from('outreach_events')
    .update({ 
      metadata: {
        ...event.metadata,
        ghl_synced: true,
        ghl_synced_at: new Date().toISOString(),
        ghl_note_ok: noteResult.ok,
        ghl_move_ok: moveResult.ok,
      }
    })
    .eq('id', event.id);

  if (updateErr) {
    logger.error('reply_to_ghl_sync: failed to mark event as synced', { eventId: event.id, err: updateErr.message });
    return { status: 'update_failed', error: updateErr.message };
  }

  logger.info('reply_to_ghl_sync: event synced', { 
    eventId: event.id, 
    contactId, 
    noteOk: noteResult.ok,
    moveOk: moveResult.ok,
  });
  return { status: 'synced', contactId, noteOk: noteResult.ok, moveOk: moveResult.ok };
}

// ── Fetch unsync'd replied events ────────────────────────────

/**
 * Fetches recent replied events that haven't been synced to GHL yet.
 * Filters for events < 24h old to avoid massive backfills.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<any[]>}
 */
async function fetchUnsyncedReplies(supabase) {
  const cutoffTime = new Date(Date.now() - MAX_REPLY_AGE_MS).toISOString();

  const { data, error } = await supabase
    .from('outreach_events')
    .select('*')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', cutoffTime)
    .order('occurred_at', { ascending: true })
    .limit(50);

  if (error) {
    logger.error('reply_to_ghl_sync: failed to fetch unsync\'d replies', { err: error.message });
    return [];
  }

  // Filter out events that are already synced
  return (data || []).filter(evt => {
    const metadata = evt.metadata || {};
    return metadata.ghl_synced !== true;
  });
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * One full sync cycle: fetch unsync'd replies → process each → report.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{fetched: number, synced: number, failed: number, skipped: number}>}
 */
async function runCycle(supabase) {
  if (!GHL_KEY) {
    logger.warn('reply_to_ghl_sync: GHL_API_KEY missing, skipping cycle');
    return { fetched: 0, synced: 0, failed: 0, skipped: 0 };
  }

  logger.info('reply_to_ghl_sync: cycle start');

  const events = await fetchUnsyncedReplies(supabase);
  logger.info('reply_to_ghl_sync: fetched unsync\'d replies', { count: events.length });

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of events) {
    const result = await processOneEvent(supabase, event);
    if (result.status === 'synced') {
      synced++;
    } else if (result.status.includes('skipped')) {
      skipped++;
    } else {
      failed++;
    }
  }

  logger.info('reply_to_ghl_sync: cycle done', { fetched: events.length, synced, failed, skipped });
  return { fetched: events.length, synced, failed, skipped };
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  logger.info('reply_to_ghl_sync worker starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  await runCycle(supabase);

  if (SELF_CHECK) {
    logger.info('reply_to_ghl_sync: self-check OK, exiting');
    process.exit(0);
  }
  // Not self-check: cron mode — single pass then process ends naturally.
  // Render fires this every 5 min via schedule config in render.yaml.
}

// ── Entry point ──────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('reply_to_ghl_sync fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneEvent };
