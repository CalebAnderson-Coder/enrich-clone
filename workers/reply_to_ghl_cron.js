import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_ACCESS_TOKEN = process.env.GHL_ACCESS_TOKEN;
const GHL_API_URL = 'https://services.leadconnectorhq.com';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchUnsyncedReplies(supabase) {
  const { data, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .eq('metadata->>ghl_synced', 'false')
    .gt('occurred_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('occurred_at', { ascending: true })
    .limit(100);

  if (error) {
    logger.error('reply_to_ghl_cron: failed to fetch unsynced replies', { error: error.message });
    return [];
  }

  return data || [];
}

async function fetchLeadGHLInfo(supabase, leadId) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, ghl_contact_id, ghl_opportunity_id')
    .eq('id', leadId)
    .maybeSingle();

  if (error) {
    logger.warn('reply_to_ghl_cron: failed to fetch lead GHL info', { leadId, error: error.message });
    return null;
  }

  return data;
}

async function syncReplyToGHL(leadGHLInfo, replyBody) {
  if (!leadGHLInfo?.ghl_contact_id) {
    logger.warn('reply_to_ghl_cron: lead missing ghl_contact_id', { leadId: leadGHLInfo?.id });
    return { success: false, reason: 'missing_ghl_contact_id' };
  }

  const contactId = leadGHLInfo.ghl_contact_id;
  const opportunityId = leadGHLInfo.ghl_opportunity_id;

  try {
    const noteBody = `Cliente respondió:\n\n${replyBody.substring(0, 200)}${replyBody.length > 200 ? '...' : ''}`;

    const noteResponse = await fetchWithRetry(
      `${GHL_API_URL}/contacts/${contactId}/notes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: noteBody }),
      },
      2,
      30000
    );

    if (!noteResponse.ok) {
      logger.warn('reply_to_ghl_cron: failed to add note', {
        contactId,
        status: noteResponse.status,
      });
      return { success: false, reason: 'note_failed' };
    }

    if (opportunityId && GHL_STAGE_INTERESADO_ID) {
      const stageResponse = await fetchWithRetry(
        `${GHL_API_URL}/opportunities/${opportunityId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pipelineStageId: GHL_STAGE_INTERESADO_ID }),
        },
        2,
        30000
      );

      if (!stageResponse.ok) {
        logger.warn('reply_to_ghl_cron: failed to update stage', {
          opportunityId,
          status: stageResponse.status,
        });
      }
    }

    return { success: true };
  } catch (err) {
    logger.error('reply_to_ghl_cron: sync error', {
      leadId: leadGHLInfo?.id,
      error: err.message,
    });
    return { success: false, reason: 'sync_error', error: err.message };
  }
}

async function fetchWithRetry(url, options, maxRetries = 2, delayMs = 30000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        logger.warn('reply_to_ghl_cron: fetch attempt failed, retrying', {
          attempt,
          url,
          error: err.message,
        });
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError;
}

async function markAsSynced(supabase, eventId) {
  const { error } = await supabase
    .from('outreach_events')
    .update({ metadata: { ghl_synced: 'true' } })
    .eq('id', eventId);

  if (error) {
    logger.warn('reply_to_ghl_cron: failed to mark as synced', {
      eventId,
      error: error.message,
    });
  }
}

async function runCycle() {
  if (!GHL_ACCESS_TOKEN || !GHL_PIPELINE_ID || !GHL_STAGE_INTERESADO_ID) {
    logger.warn('reply_to_ghl_cron: missing GHL env vars, skipping cycle', {
      has_token: !!GHL_ACCESS_TOKEN,
      has_pipeline: !!GHL_PIPELINE_ID,
      has_stage: !!GHL_STAGE_INTERESADO_ID,
    });
    return;
  }

  const supabase = buildSupabase();

  try {
    const replies = await fetchUnsyncedReplies(supabase);
    logger.info('reply_to_ghl_cron: fetched unsynced replies', { count: replies.length });

    for (const reply of replies) {
      try {
        const leadGHLInfo = await fetchLeadGHLInfo(supabase, reply.lead_id);
        if (!leadGHLInfo) continue;

        const replyBody = reply.metadata?.body || '';
        const syncResult = await syncReplyToGHL(leadGHLInfo, replyBody);

        if (syncResult.success) {
          await markAsSynced(supabase, reply.id);
          logger.info('reply_to_ghl_cron: reply synced', { eventId: reply.id });
        } else {
          logger.warn('reply_to_ghl_cron: sync failed', {
            eventId: reply.id,
            reason: syncResult.reason,
          });
        }
      } catch (err) {
        logger.error('reply_to_ghl_cron: processing error', {
          eventId: reply.id,
          error: err.message,
        });
      }
    }

    logger.info('reply_to_ghl_cron: cycle complete', { processed: replies.length });
  } catch (err) {
    logger.error('reply_to_ghl_cron: cycle failed', { error: err.message });
  }
}

runCycle();
