// ============================================================
// workers/reply_to_ghl_sync_cron.js — Sync replies to GHL
//
// Cron (each 5 min) that:
//   1. Reads outreach_events with event_type='replied' + not synced (last 24h)
//   2. For each reply:
//      - Fetches the lead and its ghl_contact_id
//      - Posts a note to GHL contact with reply preview
//      - Updates GHL opportunity to INTERESADO stage
//   3. Marks event with metadata.ghl_synced=true
//   4. Retries once on failure (30s delay)
//
// Run modes:
//   node workers/reply_to_ghl_sync_cron.js            # production cycle
//   node workers/reply_to_ghl_sync_cron.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.EMPIRIKA_GHL_KEY;
const GHL_LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'default';
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID || 'interesado-default-id';

const REPLY_LOOKBACK_HOURS = 24;
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 30000;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GHL API Helpers ──────────────────────────────────────────

function getGHLHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Post a note to a GHL contact
 * @param {string} contactId GHL contact ID
 * @param {string} body Note text
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function postNoteToContact(contactId, body) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getGHLHeaders(),
      body: JSON.stringify({ value: body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown error');
      return { ok: false, status: res.status, error: err.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update GHL opportunity to INTERESADO stage
 * @param {string} opportunityId GHL opportunity ID
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function moveOpportunityToInteresado(opportunityId) {
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getGHLHeaders(),
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        stageId: GHL_STAGE_INTERESADO_ID,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown error');
      return { ok: false, status: res.status, error: err.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Main logic ───────────────────────────────────────────────

/**
 * Fetch new replied events not yet synced to GHL
 */
async function fetchRepliedEventsToSync(supabase) {
  const since = new Date(Date.now() - REPLY_LOOKBACK_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false });

  if (error) {
    logger.error('reply_to_ghl_sync_cron: failed to fetch replied events', { error: error.message });
    return [];
  }

  // Filter to only those not yet synced
  return (data || []).filter((event) => !event.metadata?.ghl_synced);
}

/**
 * Get lead details including GHL contact/opportunity IDs
 */
async function getLead(supabase, leadId) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, business_name, email_address, ghl_contact_id, ghl_opportunity_id, mega_profile')
    .eq('id', leadId)
    .maybeSingle();

  if (error) {
    logger.warn('reply_to_ghl_sync_cron: failed to fetch lead', { leadId, error: error.message });
    return null;
  }

  return data;
}

/**
 * Get the reply message preview from agent_events or outreach_events metadata
 */
async function getReplyPreview(supabase, leadId) {
  // Try to get from agent_events if available (higher priority)
  const { data: agentEvents } = await supabase
    .from('agent_events')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('agent_name', 'inbox_reply_cron')
    .order('created_at', { ascending: false })
    .limit(1);

  if (agentEvents?.[0]?.metadata?.reply_preview) {
    return agentEvents[0].metadata.reply_preview;
  }

  // Fallback to generic message
  return 'El lead ha respondido a tu email. Revisa el inbox para ver el mensaje completo.';
}

/**
 * Sync a single replied event to GHL
 */
async function syncReplyEventToGHL(supabase, event, lead, replyPreview, retryCount = 0) {
  const { id: eventId, lead_id: leadId } = event;

  if (!lead?.ghl_contact_id) {
    logger.warn('reply_to_ghl_sync_cron: lead has no ghl_contact_id, skipping', {
      leadId,
      eventId,
    });
    return false;
  }

  // Step 1: Post note to GHL contact
  const noteResult = await postNoteToContact(lead.ghl_contact_id, replyPreview);
  if (!noteResult.ok) {
    logger.warn('reply_to_ghl_sync_cron: failed to post note', {
      leadId,
      eventId,
      status: noteResult.status,
      error: noteResult.error,
      retryCount,
    });

    if (retryCount < MAX_RETRIES) {
      logger.info('reply_to_ghl_sync_cron: retrying in 30s', { eventId, retryCount: retryCount + 1 });
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return syncReplyEventToGHL(supabase, event, lead, replyPreview, retryCount + 1);
    }

    // Max retries exhausted - mark with error but continue
    return false;
  }

  // Step 2: Move opportunity to INTERESADO (if we have an opportunity ID)
  if (lead.ghl_opportunity_id) {
    const oppResult = await moveOpportunityToInteresado(lead.ghl_opportunity_id);
    if (!oppResult.ok) {
      logger.warn('reply_to_ghl_sync_cron: failed to move opportunity', {
        opportunityId: lead.ghl_opportunity_id,
        status: oppResult.status,
        error: oppResult.error,
      });
      // Don't retry on opportunity failure - note was posted successfully
    } else {
      logger.info('reply_to_ghl_sync_cron: moved opportunity to INTERESADO', {
        leadId,
        opportunityId: lead.ghl_opportunity_id,
      });
    }
  }

  // Step 3: Mark event as synced
  const updatedMetadata = { ...event.metadata, ghl_synced: true };
  const { error: updateError } = await supabase
    .from('outreach_events')
    .update({ metadata: updatedMetadata })
    .eq('id', eventId);

  if (updateError) {
    logger.error('reply_to_ghl_sync_cron: failed to mark event as synced', {
      eventId,
      error: updateError.message,
    });
    return false;
  }

  logger.info('reply_to_ghl_sync_cron: successfully synced reply to GHL', {
    leadId,
    eventId,
    contactId: lead.ghl_contact_id,
  });

  return true;
}

/**
 * Main cycle
 */
async function runCycle(supabase) {
  if (!GHL_KEY) {
    logger.warn('reply_to_ghl_sync_cron: EMPIRIKA_GHL_KEY not set, skipping cycle');
    return;
  }

  const events = await fetchRepliedEventsToSync(supabase);
  if (events.length === 0) {
    logger.info('reply_to_ghl_sync_cron: no new replied events to sync');
    return;
  }

  logger.info('reply_to_ghl_sync_cron: processing', { count: events.length });

  let synced = 0;
  let failed = 0;

  for (const event of events) {
    const lead = await getLead(supabase, event.lead_id);
    if (!lead) {
      logger.warn('reply_to_ghl_sync_cron: lead not found', { leadId: event.lead_id });
      failed++;
      continue;
    }

    const replyPreview = await getReplyPreview(supabase, event.lead_id);
    const success = await syncReplyEventToGHL(supabase, event, lead, replyPreview);

    if (success) {
      synced++;
    } else {
      failed++;
    }
  }

  logger.info('reply_to_ghl_sync_cron: cycle complete', { synced, failed, total: events.length });
}

// ── Entrypoint ──────────────────────────────────────────────

async function main() {
  const supabase = buildSupabase();

  if (SELF_CHECK) {
    await runCycle(supabase);
    process.exit(0);
  }

  // Production: run every 5 minutes indefinitely
  await runCycle(supabase);
  const interval = setInterval(() => runCycle(supabase), 5 * 60 * 1000);

  process.on('SIGTERM', () => {
    logger.info('reply_to_ghl_sync_cron: SIGTERM received, exiting');
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error('reply_to_ghl_sync_cron: fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
