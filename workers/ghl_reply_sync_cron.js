import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const SYNC_WINDOW_HOURS = Number(process.env.GHL_REPLY_SYNC_WINDOW_HOURS ?? 24);
const RETRY_DELAY_MS = 30000;

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function ghlHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function addNoteToContact(contactId, body) {
  const headers = ghlHeaders();
  if (!headers) throw new Error('GHL_PRIVATE_TOKEN not configured');

  const noteBody = {
    body,
  };

  const response = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(noteBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GHL API error [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  return data.id;
}

async function moveOpportunityToStage(opportunityId, pipelineId, stageId) {
  const headers = ghlHeaders();
  if (!headers) throw new Error('GHL_PRIVATE_TOKEN not configured');

  const payload = {
    pipelineId,
    stageId,
  };

  const response = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GHL API error [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  return data;
}

async function getPendingReplies(supabase) {
  const cutoffTime = new Date(Date.now() - SYNC_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select(`
      id,
      lead_id,
      metadata,
      occurred_at,
      leads:lead_id(id, ghl_contact_id, ghl_opportunity_id)
    `)
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', cutoffTime)
    .not('metadata->>ghl_synced', 'is', null);

  if (error) {
    logger.error('ghl_reply_sync_cron: failed to fetch pending replies', { err: error.message });
    return [];
  }

  const filtered = (events || []).filter(e => {
    const alreadySynced = e.metadata?.ghl_synced === true;
    return !alreadySynced;
  });

  return filtered;
}

async function syncReply(supabase, event) {
  const lead = Array.isArray(event.leads) ? event.leads[0] : event.leads;
  const ghlContactId = lead?.ghl_contact_id;
  const ghlOpptyId = lead?.ghl_opportunity_id;

  if (!ghlContactId || !ghlOpptyId) {
    logger.warn('ghl_reply_sync_cron: lead missing GHL ids', {
      event_id: event.id,
      lead_id: event.lead_id,
      has_contact: !!ghlContactId,
      has_oppty: !!ghlOpptyId,
    });
    return { success: false, reason: 'missing_ghl_ids' };
  }

  try {
    const replyPreview = (event.metadata?.reply_body || '').substring(0, 200);
    const noteText = `[Empírika Auto-Reply Sync]\n\n${replyPreview}`;

    const noteId = await addNoteToContact(ghlContactId, noteText);

    if (GHL_PIPELINE_ID && GHL_STAGE_INTERESADO_ID) {
      await moveOpportunityToStage(ghlOpptyId, GHL_PIPELINE_ID, GHL_STAGE_INTERESADO_ID);
    }

    await supabase
      .from('outreach_events')
      .update({
        metadata: {
          ...event.metadata,
          ghl_synced: true,
          ghl_note_id: noteId,
        },
      })
      .eq('id', event.id);

    logger.info('ghl_reply_sync_cron: reply synced', {
      event_id: event.id,
      lead_id: event.lead_id,
      ghl_note_id: noteId,
    });

    return { success: true, noteId };
  } catch (err) {
    logger.warn('ghl_reply_sync_cron: sync failed', {
      event_id: event.id,
      lead_id: event.lead_id,
      err: err.message,
    });
    return { success: false, reason: 'ghl_api_error', error: err.message };
  }
}

async function runCycle() {
  const supabase = buildSupabase();

  const replies = await getPendingReplies(supabase);
  logger.info('ghl_reply_sync_cron: cycle start', { pending_replies: replies.length });

  if (replies.length === 0) {
    return { synced: 0, skipped: 0, errors: 0 };
  }

  let synced = 0, skipped = 0, errors = 0;

  for (const event of replies) {
    const result = await syncReply(supabase, event);
    if (result.success) {
      synced++;
    } else if (result.reason === 'missing_ghl_ids') {
      skipped++;
    } else {
      errors++;
    }
  }

  logger.info('ghl_reply_sync_cron: cycle done', { synced, skipped, errors });
  return { synced, skipped, errors };
}

async function main() {
  logger.info('ghl_reply_sync_cron starting', {
    brand_id: BRAND_ID,
    ghl_stage_interesado_id: GHL_STAGE_INTERESADO_ID,
    ghl_pipeline_id: GHL_PIPELINE_ID,
    sync_window_hours: SYNC_WINDOW_HOURS,
  });

  const result = await runCycle();
  logger.info('ghl_reply_sync_cron: done', result);
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('ghl_reply_sync_cron fatal', err);
    process.exit(1);
  });
}

export { runCycle, syncReply, getPendingReplies };
