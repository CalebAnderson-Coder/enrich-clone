import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_STAGE_INTERESADO = process.env.GHL_STAGE_INTERESADO_ID || 'c4a6f80a-f6f6-4e5e-a51a-8e5c0e3c2b1a';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'PbSBohJh1m1L08INwMzv';
const REPLY_MAX_AGE_HOURS = 24;

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function ghlHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
  if (!token) {
    logger.warn('GHL_PRIVATE_TOKEN not set, skipping GHL sync');
    return null;
  }
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function syncReplyToGHL(supabase, replyEvent) {
  const { lead_id, metadata, id: event_id } = replyEvent;
  
  if (!metadata.ghl_contact_id) {
    logger.warn(`Event ${event_id}: No ghl_contact_id in metadata, skipping`);
    return { synced: false, reason: 'no_ghl_contact_id' };
  }

  const ghlContactId = metadata.ghl_contact_id;
  const messagePreview = metadata.message_preview || metadata.reply_text || '(sin preview)';
  const noteBody = `Lead respondió: "${messagePreview.substring(0, 200)}"`;

  const headers = ghlHeaders();
  if (!headers) {
    return { synced: false, reason: 'no_ghl_token' };
  }

  try {
    const noteResult = await fetch(`${GHL_BASE}/contacts/${ghlContactId}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        value: noteBody,
      }),
      timeout: 15000,
    });

    if (!noteResult.ok) {
      const errorText = await noteResult.text();
      logger.warn(`GHL note creation failed: ${noteResult.status} ${errorText}`);
      if (noteResult.status >= 500) {
        return { synced: false, reason: 'ghl_server_error', retry: true };
      }
      return { synced: false, reason: 'ghl_note_failed', retry: false };
    }

    const opportunityResult = await fetch(
      `${GHL_BASE}/opportunities/${ghlContactId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          pipelineStageId: GHL_STAGE_INTERESADO,
        }),
        timeout: 15000,
      }
    );

    if (!opportunityResult.ok) {
      const errorText = await opportunityResult.text();
      logger.warn(`GHL opportunity update failed: ${opportunityResult.status} ${errorText}`);
      if (opportunityResult.status >= 500) {
        return { synced: false, reason: 'ghl_stage_server_error', retry: true };
      }
      return { synced: false, reason: 'ghl_stage_update_failed', retry: false };
    }

    logger.info(`GHL sync OK: event ${event_id}, contact ${ghlContactId}`);
    return { synced: true, reason: 'success' };
  } catch (error) {
    logger.error(`GHL sync error for event ${event_id}:`, error.message);
    return { synced: false, reason: 'fetch_error', retry: true };
  }
}

async function markEventSynced(supabase, eventId, result) {
  const { data, error } = await supabase
    .from('outreach_events')
    .update({
      metadata: supabase.rpc('jsonb_set', [
        'metadata',
        '["ghl_synced"]',
        'true',
      ]),
    })
    .eq('id', eventId)
    .select();

  if (error) {
    logger.error(`Failed to mark event ${eventId} as synced:`, error.message);
  }
}

async function runCron() {
  const supabase = buildSupabase();

  const cutoffTime = new Date(Date.now() - REPLY_MAX_AGE_HOURS * 3600 * 1000).toISOString();

  logger.info(`Fetching new replied events since ${cutoffTime} for brand ${BRAND_ID}`);

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('*')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .eq('channel', 'email')
    .gt('occurred_at', cutoffTime)
    .order('occurred_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch outreach_events:', error.message);
    return;
  }

  logger.info(`Found ${events?.length || 0} replied events to process`);

  for (const event of events || []) {
    const alreadySynced = event.metadata?.ghl_synced === true;
    if (alreadySynced) {
      logger.debug(`Event ${event.id} already synced, skipping`);
      continue;
    }

    const result = await syncReplyToGHL(supabase, event);
    logger.info(`Event ${event.id}: ${result.reason}`);

    if (result.synced) {
      await markEventSynced(supabase, event.id, result);
    } else if (!result.retry) {
      await markEventSynced(supabase, event.id, result);
    }
  }

  logger.info('Reply-to-GHL sync cycle completed');
}

runCron().catch((err) => {
  logger.error('Fatal error in reply_to_ghl_sync:', err);
  process.exit(1);
});
