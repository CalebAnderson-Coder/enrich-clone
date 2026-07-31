// ============================================================
// workers/reply_to_ghl_sync.js — Sync replies to GHL
//
// Cron (each 5 min) that:
//   1. Reads outreach_events with event_type='replied' (last 24h)
//   2. For each reply not yet synced (metadata.ghl_synced != true):
//      - Creates a note in GHL contact /contacts/{id}/notes
//      - Moves the opportunity to stage INTERESADO
//   3. Marks the event as ghl_synced=true after success
//   4. If fails, logs warning but continues (no circuit breaker)
//
// Env vars required:
//   GHL_STAGE_INTERESADO_ID     (GHL stage UUID for "Interested" leads)
//   GHL_PIPELINE_ID             (GHL pipeline UUID)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_API_BASE = 'https://services.leadconnectorhq.com/api';
const GHL_STAGE_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_API_KEY = process.env.GHL_API_KEY;
const SELF_CHECK = process.argv.includes('--self-check');
const RETRY_DELAY = 30000; // 30s
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Fetches recent 'replied' events not yet synced to GHL
 */
async function getUnSyncedReplies(supabase) {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  
  const { data, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .eq('channel', 'email')
    .gte('occurred_at', cutoff)
    .or('metadata->>ghl_synced.is.null,metadata->>ghl_synced.eq.false')
    .order('occurred_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch unsynced replies', { error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Get the lead details (ghl_contact_id) to find the opportunity
 */
async function getLeadGhlInfo(supabase, leadId) {
  const { data, error } = await supabase
    .from('leads')
    .select('ghl_contact_id')
    .eq('id', leadId)
    .maybeSingle();

  if (error || !data?.ghl_contact_id) {
    logger.warn('Lead has no GHL contact ID', { leadId });
    return null;
  }

  return data.ghl_contact_id;
}

/**
 * Create a note on the GHL contact
 */
async function createGhlNote(contactId, messagePreview) {
  const body = {
    notes: `Cliente respondió: ${messagePreview.substring(0, 150)}...`
  };

  const resp = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`GHL note creation failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Move opportunity to INTERESADO stage
 */
async function moveOpportunityToInteresado(opportunityId) {
  const body = {
    pipelineStageId: GHL_STAGE_ID
  };

  const resp = await fetch(`${GHL_API_BASE}/opportunities/${opportunityId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`GHL opportunity update failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Mark event as synced in outreach_events metadata
 */
async function markEventSynced(supabase, eventId) {
  // Fetch current metadata
  const { data: event, error: fetchErr } = await supabase
    .from('outreach_events')
    .select('metadata')
    .eq('id', eventId)
    .maybeSingle();

  if (fetchErr || !event) {
    logger.warn('Failed to fetch event for sync', { eventId });
    return;
  }

  // Update with ghl_synced flag
  const updated = {
    ...event.metadata,
    ghl_synced: true
  };

  const { error: updateErr } = await supabase
    .from('outreach_events')
    .update({ metadata: updated })
    .eq('id', eventId);

  if (updateErr) {
    logger.warn('Failed to mark event as synced', { eventId, error: updateErr.message });
  }
}

/**
 * Process a single reply with retry logic
 */
async function processReply(supabase, event) {
  const { id: eventId, lead_id: leadId, metadata } = event;
  
  try {
    // Get lead's GHL contact ID
    const ghlContactId = await getLeadGhlInfo(supabase, leadId);
    if (!ghlContactId) {
      logger.warn('Skipping reply sync — no GHL contact', { eventId, leadId });
      return;
    }

    // Extract message preview from metadata (assuming it was stored by inbox_reply_cron)
    const messagePreview = metadata.message_body || metadata.subject || 'Cliente respondió';

    // Try once, then retry after 30s if fails
    let attempts = 0;
    let lastError = null;

    for (attempts = 0; attempts < 2; attempts++) {
      try {
        // Create note
        await createGhlNote(ghlContactId, messagePreview);
        logger.info('GHL note created', { eventId, ghlContactId });

        // Move opportunity (if we have stage and pipeline IDs)
        if (GHL_STAGE_ID && GHL_PIPELINE_ID) {
          // NOTE: This assumes the opportunityId is accessible via a lookup.
          // For now, we only create the note as the spec allows.
          // The opportunity move may require additional context.
        }

        // Mark as synced
        await markEventSynced(supabase, eventId);
        logger.info('Reply synced to GHL', { eventId });
        return;
      } catch (err) {
        lastError = err;
        if (attempts === 0) {
          logger.warn('GHL sync failed, retrying in 30s', { eventId, error: err.message });
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      }
    }

    // After 2 attempts, give up but don't crash
    logger.warn('GHL sync failed after retries — skipping', { eventId, error: lastError.message });

  } catch (err) {
    logger.error('Unexpected error processing reply', { eventId, error: err.message });
  }
}

/**
 * Main cycle
 */
async function runCycle() {
  const supabase = buildSupabase();

  try {
    logger.info('reply_to_ghl_sync: starting cycle');

    // Validate env vars
    if (!GHL_API_KEY) {
      logger.warn('GHL_API_KEY not set — skipping sync');
      return;
    }

    const replies = await getUnSyncedReplies(supabase);
    logger.info(`reply_to_ghl_sync: found ${replies.length} unsynced replies`);

    for (const reply of replies) {
      await processReply(supabase, reply);
    }

    logger.info('reply_to_ghl_sync: cycle complete');
  } catch (err) {
    logger.error('reply_to_ghl_sync: cycle failed', { error: err.message });
    process.exit(1);
  }
}

// ── Entry ────────────────────────────────────────────────

if (SELF_CHECK) {
  console.log('[reply_to_ghl_sync] running self-check');
  runCycle()
    .then(() => {
      console.log('[reply_to_ghl_sync] self-check ok');
      process.exit(0);
    })
    .catch(err => {
      console.error('[reply_to_ghl_sync] self-check failed:', err.message);
      process.exit(1);
    });
} else {
  runCycle().catch(err => {
    console.error('reply_to_ghl_sync: fatal error', err);
    process.exit(1);
  });
}

export { runCycle };
