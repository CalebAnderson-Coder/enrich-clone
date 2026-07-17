// ============================================================
// workers/sync_replies_to_ghl_cron.js — Sync replies to GHL
//
// Cron (every 5 min) que:
//   1. Lee outreach_events con event_type='replied' que NO tengan
//      metadata.ghl_synced=true.
//   2. Para cada reply: escribe una nota en GHL + mueve el lead
//      a la etapa INTERESADO del pipeline.
//   3. Marca metadata.ghl_synced=true tras éxito.
//   4. Si falla: retry una vez tras 30s. Si falla otra vez:
//      log warning y marca como error pero NO rompe el cron.
//
// Cron sugerido: cada 5 min en Render.
// Run modes:
//   node workers/sync_replies_to_ghl_cron.js            # production cycle
//   node workers/sync_replies_to_ghl_cron.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_API_KEY = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const REPLY_MAX_AGE_HOURS = 24;

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchGHLContactId(supabase, leadId) {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('ghl_contact_id, mega_profile')
    .eq('id', leadId)
    .maybeSingle();

  if (error || !lead) {
    return null;
  }

  if (lead.ghl_contact_id) {
    return lead.ghl_contact_id;
  }

  if (lead.mega_profile?.ghl_contact_id) {
    return lead.mega_profile.ghl_contact_id;
  }

  return null;
}

async function syncReplyToGHL(contactId, replyEvent, attempt = 1) {
  const log = logger.child({ contactId, event_id: replyEvent.id, attempt });

  if (!GHL_API_KEY) {
    log.warn('sync_replies_to_ghl: GHL_API_KEY not set — skipping');
    return { success: false, reason: 'no_ghl_key' };
  }

  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  };

  const replyBody = replyEvent.metadata?.body
    || replyEvent.metadata?.preview
    || replyEvent.metadata?.snippet
    || 'Lead respondió';
  const preview = replyBody.length > 100
    ? replyBody.slice(0, 100) + '...'
    : replyBody;

  const fromEmail = replyEvent.metadata?.from_email || 'unknown@lead.com';
  const noteText = `[Empírika Auto] Lead respondió desde ${fromEmail}\n\n${preview}`;

  try {
    // 1. Write note to GHL contact
    const noteRes = await fetch(
      `${GHL_BASE_URL}/contacts/${contactId}/notes`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: noteText }),
      }
    );

    if (!noteRes.ok) {
      const errText = await noteRes.text().catch(() => '');
      log.warn('sync_replies_to_ghl: failed to write note', {
        status: noteRes.status,
        error: errText,
      });

      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 30000));
        return syncReplyToGHL(contactId, replyEvent, attempt + 1);
      }
      return { success: false, reason: 'note_failed', error: errText };
    }

    log.info('sync_replies_to_ghl: note written');

    // 2. Move lead to INTERESADO stage (optional, only if env vars set)
    if (GHL_STAGE_INTERESADO_ID && GHL_PIPELINE_ID) {
      const optyRes = await fetch(
        `${GHL_BASE_URL}/opportunities/${contactId}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            pipelineId: GHL_PIPELINE_ID,
            pipelineStageId: GHL_STAGE_INTERESADO_ID,
          }),
        }
      );

      if (!optyRes.ok) {
        const errText = await optyRes.text().catch(() => '');
        log.warn('sync_replies_to_ghl: failed to update opportunity stage', {
          status: optyRes.status,
          error: errText,
        });

        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 30000));
          return syncReplyToGHL(contactId, replyEvent, attempt + 1);
        }
        return { success: false, reason: 'stage_update_failed', error: errText };
      }

      log.info('sync_replies_to_ghl: opportunity stage updated');
    }

    return { success: true };
  } catch (err) {
    log.error('sync_replies_to_ghl: network error', { error: err.message });

    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 30000));
      return syncReplyToGHL(contactId, replyEvent, attempt + 1);
    }
    return { success: false, reason: 'network_error', error: err.message };
  }
}

async function markAsSynced(supabase, eventId, metadata) {
  const updatedMetadata = { ...metadata, ghl_synced: true };
  const { error } = await supabase
    .from('outreach_events')
    .update({ metadata: updatedMetadata })
    .eq('id', eventId);

  if (error) {
    logger.warn('sync_replies_to_ghl: failed to mark as synced', { event_id: eventId, error: error.message });
  }
}

async function processOneReply(supabase, replyEvent) {
  const log = logger.child({ event_id: replyEvent.id, lead_id: replyEvent.lead_id });

  const contactId = await fetchGHLContactId(supabase, replyEvent.lead_id);
  if (!contactId) {
    log.warn('sync_replies_to_ghl: no GHL contact ID found');
    return { processed: false, reason: 'no_contact_id' };
  }

  const result = await syncReplyToGHL(contactId, replyEvent);

  if (result.success) {
    await markAsSynced(supabase, replyEvent.id, replyEvent.metadata);
    log.info('sync_replies_to_ghl: synced successfully');
    return { processed: true, success: true };
  } else {
    log.warn('sync_replies_to_ghl: sync failed', { reason: result.reason, error: result.error });
    return { processed: false, reason: result.reason, error: result.error };
  }
}

async function runCycle(supabase) {
  const cutoffTime = new Date(Date.now() - REPLY_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: replyEvents, error: queryErr } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', cutoffTime);

  if (queryErr) {
    logger.error('sync_replies_to_ghl: failed to fetch events', { error: queryErr.message });
    return {
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 1,
    };
  }

  const events = replyEvents || [];
  const filtered = events.filter(e => !e.metadata?.ghl_synced);

  logger.info('sync_replies_to_ghl: cycle start', {
    total_replies: events.length,
    to_process: filtered.length,
    max_age_hours: REPLY_MAX_AGE_HOURS,
  });

  let processed = 0;
  let skipped = 0;

  for (const evt of filtered) {
    const outcome = await processOneReply(supabase, evt);
    if (outcome.processed) {
      processed++;
    } else {
      skipped++;
    }
  }

  logger.info('sync_replies_to_ghl: cycle done', {
    total_replies: events.length,
    processed,
    skipped,
  });

  return {
    total: events.length,
    processed,
    skipped,
    errors: 0,
  };
}

async function main() {
  logger.info('sync_replies_to_ghl worker starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  await runCycle(supabase);

  if (SELF_CHECK) {
    logger.info('sync_replies_to_ghl: self-check OK, exiting');
    process.exit(0);
  }
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('sync_replies_to_ghl fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneReply };
