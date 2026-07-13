// ============================================================
// workers/reply_to_ghl_sync.js — Sync replied events to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Fetches outreach_events with event_type='replied' that
//      haven't been synced to GHL yet.
//   2. For each reply, posts a note to the GHL contact via
//      /contacts/{id}/notes API.
//   3. Updates the opportunity stage to INTERESADO via
//      /opportunities/{id} API.
//   4. Marks the event as ghl_synced=true in metadata so
//      we don't re-sync.
//
// Idempotency: keyed on outreach_events.metadata.ghl_synced
//
// Run modes:
//   node workers/reply_to_ghl_sync.js            # production cycle
//   node workers/reply_to_ghl_sync.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID    = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_KEY     = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const SELF_CHECK  = process.argv.includes('--self-check');
const REPLY_MAX_AGE_HOURS = 24;

if (!GHL_KEY) {
  logger.warn('reply_to_ghl_sync: EMPIRIKA_GHL_KEY not set — skipping sync');
  process.exit(0);
}

if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
  logger.warn('reply_to_ghl_sync: GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID not set — skipping sync', {
    stage: GHL_STAGE_INTERESADO_ID,
    pipeline: GHL_PIPELINE_ID,
  });
  process.exit(0);
}

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GHL API helpers ──────────────────────────────────────────

/**
 * Posts a note to a GHL contact.
 *
 * @param {string} contactId  — GHL contact ID
 * @param {string} noteText   — note content (max ~1000 chars recommended)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function postNoteToGHL(contactId, noteText) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GHL_KEY}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        body: noteText,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn(`postNoteToGHL failed: ${res.status}`, { contactId, status: res.status, body: text.substring(0, 200) });
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    logger.error('postNoteToGHL exception', { contactId, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Moves a GHL opportunity to the INTERESADO stage.
 *
 * @param {string} opportunityId  — GHL opportunity ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function moveOpportToInteresado(opportunityId) {
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GHL_KEY}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        pipelineStageId: GHL_STAGE_INTERESADO_ID,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn(`moveOpportToInteresado failed: ${res.status}`, { opportunityId, status: res.status, body: text.substring(0, 200) });
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    logger.error('moveOpportToInteresado exception', { opportunityId, error: err.message });
    return { success: false, error: err.message };
  }
}

// ── processOneReply ──────────────────────────────────────────

/**
 * Syncs a single reply event to GHL.
 *
 * Returns a result object — never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} event  — outreach_events row
 * @returns {Promise<{action: string, [key: string]: any}>}
 */
async function processOneReply(supabase, event) {
  const { id: eventId, lead_id: leadId, metadata = {} } = event;

  // Already synced?
  if (metadata.ghl_synced) {
    return { action: 'already_synced', event_id: eventId };
  }

  // Fetch lead to get GHL contact ID
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, ghl_contact_id')
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    logger.warn('processOneReply: lead not found', { lead_id: leadId, error: leadErr?.message });
    return { action: 'lead_not_found', event_id: eventId };
  }

  const ghlContactId = lead.ghl_contact_id;
  if (!ghlContactId) {
    logger.info('processOneReply: no GHL contact ID', { lead_id: leadId, event_id: eventId });
    return { action: 'no_ghl_contact', event_id: eventId };
  }

  // Extract preview from metadata
  const replyBody = metadata.body || '(sin contenido)';
  const replyFrom = metadata.from_email || 'desconocido';
  const replySubject = metadata.subject || '(sin asunto)';

  const noteText = `Lead respondió:\n\nDe: ${replyFrom}\nAsunto: ${replySubject}\n\nPreview: ${replyBody.substring(0, 250)}...`;

  // Post note
  const noteResult = await postNoteToGHL(ghlContactId, noteText);
  if (!noteResult.success) {
    logger.warn('processOneReply: note post failed', {
      event_id: eventId,
      lead_id: leadId,
      contact_id: ghlContactId,
      error: noteResult.error,
    });
    // Don't mark as synced — we'll retry
    return { action: 'note_failed', event_id: eventId, error: noteResult.error };
  }

  // Try to move opportunity to INTERESADO
  // First, fetch the opportunity ID from the lead's GHL sync data
  const { data: leadData } = await supabase
    .from('leads')
    .select('campaign_enriched_data')
    .eq('id', leadId)
    .maybeSingle();

  const ghlOpportId = leadData?.campaign_enriched_data?.ghl_opportunity_id;
  if (ghlOpportId) {
    const opportResult = await moveOpportToInteresado(ghlOpportId);
    if (!opportResult.success) {
      logger.warn('processOneReply: opportunity move failed', {
        event_id: eventId,
        opportunity_id: ghlOpportId,
        error: opportResult.error,
      });
      // Still mark as synced — the note was posted successfully
    }
  }

  // Mark event as synced
  const { error: updateErr } = await supabase
    .from('outreach_events')
    .update({
      metadata: { ...metadata, ghl_synced: true, ghl_synced_at: new Date().toISOString() },
    })
    .eq('id', eventId);

  if (updateErr) {
    logger.error('processOneReply: failed to mark synced', { event_id: eventId, error: updateErr.message });
    return { action: 'mark_failed', event_id: eventId, error: updateErr.message };
  }

  logger.info('processOneReply: synced to GHL', {
    event_id: eventId,
    lead_id: leadId,
    contact_id: ghlContactId,
  });

  return { action: 'synced', event_id: eventId, lead_id: leadId };
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * One full sync cycle: fetch unsync'd replies → sync each → count results.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{fetched: number, synced: number, failed: number, [key: string]: any}>}
 */
async function runCycle(supabase) {
  logger.info('reply_to_ghl_sync: cycle start');

  // Fetch replies that haven't been synced to GHL yet
  const cutoffTime = new Date(Date.now() - REPLY_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: events, error: fetchErr } = await supabase
    .from('outreach_events')
    .select('*')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .eq('channel', 'email')
    .gte('occurred_at', cutoffTime)
    .order('occurred_at', { ascending: false })
    .limit(50);

  if (fetchErr) {
    logger.error('reply_to_ghl_sync: fetch failed', { error: fetchErr.message });
    return { fetched: 0, synced: 0, failed: 0, error: fetchErr.message };
  }

  logger.info('reply_to_ghl_sync: fetched events', { total: events.length });

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of events) {
    const outcome = await processOneReply(supabase, event);
    switch (outcome.action) {
      case 'synced':
        synced++;
        break;
      case 'already_synced':
      case 'lead_not_found':
      case 'no_ghl_contact':
        skipped++;
        break;
      case 'note_failed':
      case 'mark_failed':
        failed++;
        break;
    }
  }

  logger.info('reply_to_ghl_sync: cycle done', {
    fetched: events.length,
    synced,
    failed,
    skipped,
  });

  return {
    fetched: events.length,
    synced,
    failed,
    skipped,
  };
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

export { runCycle, processOneReply };
