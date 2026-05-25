import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const SELF_CHECK = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function syncReplyToGHL(supabase, event) {
  const { id: eventId, lead_id: leadId, metadata } = event;
  
  if (!GHL_KEY || !LOCATION_ID || !GHL_STAGE_INTERESADO_ID) {
    logger.warn('reply_ghl_sync_cron: missing GHL config', {
      has_key: !!GHL_KEY,
      has_location_id: !!LOCATION_ID,
      has_stage_id: !!GHL_STAGE_INTERESADO_ID,
    });
    return { action: 'skipped', reason: 'missing_ghl_config' };
  }

  const ghlHeaders = {
    Authorization: `Bearer ${GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const ghlContactId = metadata?.ghl_contact_id;
  const ghlOpportunityId = metadata?.ghl_opportunity_id;
  const messageBody = metadata?.body || 'Reply received';
  const messageSubject = metadata?.subject || 'Reply';

  if (!ghlContactId) {
    logger.warn('reply_ghl_sync_cron: no GHL contact ID in metadata', { eventId, leadId });
    return { action: 'skipped', reason: 'no_ghl_contact_id' };
  }

  let noteFailed = false;
  let stageFailed = false;

  try {
    const noteRes = await fetch(`${GHL_BASE}/contacts/${ghlContactId}/notes`, {
      method: 'POST',
      headers: ghlHeaders,
      body: JSON.stringify({
        body: `${messageSubject}\n\n${messageBody}`,
      }),
    });

    if (!noteRes.ok) {
      const errorText = await noteRes.text();
      logger.warn('reply_ghl_sync_cron: note creation failed', {
        eventId,
        contactId: ghlContactId,
        status: noteRes.status,
        error: errorText.substring(0, 200),
      });
      noteFailed = true;

      if (noteRes.status < 500) {
        await updateEventMetadata(supabase, eventId, { ghl_sync_error: errorText.substring(0, 200) });
      }
    } else {
      logger.info('reply_ghl_sync_cron: note created', { eventId, contactId: ghlContactId });
    }
  } catch (err) {
    logger.error('reply_ghl_sync_cron: note fetch error', { eventId, error: err.message });
    noteFailed = true;
    await updateEventMetadata(supabase, eventId, { ghl_sync_error: err.message });
  }

  if (ghlOpportunityId && GHL_PIPELINE_ID && GHL_STAGE_INTERESADO_ID) {
    try {
      const stageRes = await fetch(`${GHL_BASE}/opportunities/${ghlOpportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders,
        body: JSON.stringify({
          pipelineStageId: GHL_STAGE_INTERESADO_ID,
        }),
      });

      if (!stageRes.ok) {
        const errorText = await stageRes.text();
        logger.warn('reply_ghl_sync_cron: stage update failed', {
          eventId,
          oppId: ghlOpportunityId,
          status: stageRes.status,
          error: errorText.substring(0, 200),
        });
        stageFailed = true;
      } else {
        logger.info('reply_ghl_sync_cron: stage updated', { eventId, oppId: ghlOpportunityId });
      }
    } catch (err) {
      logger.error('reply_ghl_sync_cron: stage update fetch error', { eventId, error: err.message });
      stageFailed = true;
    }
  }

  const syncedSuccessfully = !noteFailed && !stageFailed;
  if (syncedSuccessfully) {
    await markEventSynced(supabase, eventId);
    return { action: 'synced', eventId };
  } else {
    return { action: 'partial_failure', eventId, noteFailed, stageFailed };
  }
}

async function updateEventMetadata(supabase, eventId, partialMetadata) {
  const { data: event } = await supabase
    .from('outreach_events')
    .select('metadata')
    .eq('id', eventId)
    .single();

  if (!event) return;

  const updated = { ...event.metadata, ...partialMetadata };
  await supabase
    .from('outreach_events')
    .update({ metadata: updated })
    .eq('id', eventId);
}

async function markEventSynced(supabase, eventId) {
  const { data: event } = await supabase
    .from('outreach_events')
    .select('metadata')
    .eq('id', eventId)
    .single();

  if (!event) return;

  const updated = { ...event.metadata, ghl_synced: true, ghl_synced_at: new Date().toISOString() };
  await supabase
    .from('outreach_events')
    .update({ metadata: updated })
    .eq('id', eventId);
}

async function runCycle(supabase) {
  logger.info('reply_ghl_sync_cron: cycle start');

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .filter('metadata->ghl_synced', 'is', null)
    .gt('occurred_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('occurred_at', { ascending: true });

  if (error) {
    logger.error('reply_ghl_sync_cron: query error', { error: error.message });
    return { action: 'query_failed', error: error.message };
  }

  if (!events || events.length === 0) {
    logger.info('reply_ghl_sync_cron: no events to sync');
    return { action: 'completed', synced: 0, failed: 0 };
  }

  logger.info('reply_ghl_sync_cron: found events to sync', { count: events.length });

  let synced = 0;
  let failed = 0;

  for (const event of events) {
    const result = await syncReplyToGHL(supabase, event);
    if (result.action === 'synced') {
      synced++;
    } else if (result.action === 'partial_failure') {
      failed++;
    }
  }

  logger.info('reply_ghl_sync_cron: cycle complete', { synced, failed });
  return { action: 'completed', synced, failed };
}

async function main() {
  logger.info('reply_ghl_sync_cron starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  try {
    await runCycle(supabase);
    if (SELF_CHECK) {
      logger.info('reply_ghl_sync_cron: self-check OK, exiting');
      process.exit(0);
    }
  } catch (err) {
    logger.error('reply_ghl_sync_cron fatal error', err);
    process.exit(1);
  }
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('reply_ghl_sync_cron fatal error', err);
    process.exit(1);
  });
}

export { runCycle, syncReplyToGHL };
