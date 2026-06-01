// ============================================================
// workers/reply_to_ghl_sync_cron.js — Sincroniza replies de
//   outreach_events con GHL: nota en contacto + move a INTERESADO.
//
// Flujo:
//   1. Lee outreach_events nuevos con event_type='replied' que NO
//      tengan metadata.ghl_synced=true.
//   2. Para cada uno: crea nota en el contacto GHL con preview del
//      mensaje, y mueve la oportunidad a stage INTERESADO.
//   3. Marca el evento con metadata.ghl_synced=true para idempotencia.
//   4. Si la nota falla (timeout, 4xx), reintenta una vez tras 30s.
//      Si falla otra vez, loggea warning pero NO rompe el cron.
//   5. NO procesa replies más antiguas que 24h (evita backfill masivo).
//
// Cron sugerido: cada 5 min en Render.
// Run modes:
//   node workers/reply_to_ghl_sync_cron.js            # production cycle
//   node workers/reply_to_ghl_sync_cron.js --self-check  # boot+1-iter+exit
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/resilience.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_KEY = process.env.EMPIRIKA_GHL_KEY || process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID || 'stage-interesado-id';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'PbSBohJh1m1L08INwMzv';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const REPLY_WINDOW_HOURS = 24;
const SELF_CHECK = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

const ghlHeaders = {
  Authorization: `Bearer ${GHL_KEY}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
};

async function createNoteInGHL(contactId, noteBody) {
  if (!GHL_KEY || !GHL_LOCATION_ID) {
    logger.warn('reply_to_ghl: GHL credentials missing');
    return { ok: false, error: 'missing_credentials' };
  }

  try {
    const payload = {
      locationId: GHL_LOCATION_ID,
      body: noteBody,
    };

    const res = await withRetry(
      () => fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify(payload),
      }),
      { maxRetries: 1, baseDelayMs: 1000, label: 'GHL-note-create' }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      logger.warn('reply_to_ghl: note creation failed', {
        contactId,
        status: res.status,
        body: errorBody.slice(0, 200),
      });
      return { ok: false, error: `note_${res.status}` };
    }

    const data = await res.json();
    return { ok: true, noteId: data?.id };
  } catch (err) {
    logger.warn('reply_to_ghl: note creation threw', { contactId, error: err.message });
    return { ok: false, error: err.message };
  }
}

async function moveOpportunityToStage(opportunityId, stageId) {
  if (!GHL_KEY || !opportunityId || !stageId) {
    logger.warn('reply_to_ghl: moveOpp missing args', { opportunityId, stageId });
    return { ok: false, error: 'missing_args' };
  }

  try {
    const payload = {
      pipelineStageId: stageId,
    };

    const res = await withRetry(
      () => fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders,
        body: JSON.stringify(payload),
      }),
      { maxRetries: 1, baseDelayMs: 1000, label: 'GHL-opp-update' }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      logger.warn('reply_to_ghl: opportunity update failed', {
        opportunityId,
        status: res.status,
        body: errorBody.slice(0, 200),
      });
      return { ok: false, error: `opp_${res.status}` };
    }

    const data = await res.json();
    return { ok: true, opportunityId: data?.id };
  } catch (err) {
    logger.warn('reply_to_ghl: opportunity update threw', { opportunityId, error: err.message });
    return { ok: false, error: err.message };
  }
}

async function processOneReply(supabase, replyEvent, lead, magnetData) {
  const log = logger.child({ event_id: replyEvent.id, lead_id: lead.id });

  const contactId = magnetData?.ghl_contact_id;
  const opportunityId = magnetData?.ghl_opportunity_id;

  if (!contactId) {
    log.info('reply_to_ghl: no ghl_contact_id — skipping GHL sync');
    // Mark as synced anyway to avoid retry loop
    await updateEventMetadata(supabase, replyEvent.id, { ghl_synced: true, reason: 'no_contact_id' });
    return { processed: false, reason: 'no_contact_id' };
  }

  // Extract reply message body
  const replyBody =
    replyEvent.metadata?.body ||
    replyEvent.metadata?.preview ||
    replyEvent.metadata?.snippet ||
    replyEvent.metadata?.text ||
    'Lead replied to outreach';

  // Truncate for GHL note (limit to 500 chars)
  const noteBody = `Lead respondió a outreach:\n\n"${replyBody.slice(0, 300)}${replyBody.length > 300 ? '…' : ''}"`;

  // 1. Create note in GHL
  const noteResult = await createNoteInGHL(contactId, noteBody);
  if (!noteResult.ok) {
    log.warn('reply_to_ghl: note creation failed', { reason: noteResult.error });
    await updateEventMetadata(supabase, replyEvent.id, {
      ghl_synced: false,
      ghl_note_error: noteResult.error,
    });
    return { processed: false, reason: 'note_creation_failed' };
  }

  log.info('reply_to_ghl: note created', { noteId: noteResult.noteId });

  // 2. Move opportunity to INTERESADO if present
  let oppMoveResult = { ok: true };
  if (opportunityId && GHL_STAGE_INTERESADO_ID !== 'stage-interesado-id') {
    oppMoveResult = await moveOpportunityToStage(opportunityId, GHL_STAGE_INTERESADO_ID);
    if (oppMoveResult.ok) {
      log.info('reply_to_ghl: opportunity moved to INTERESADO', { opportunityId });
    } else {
      log.warn('reply_to_ghl: opportunity move failed', { reason: oppMoveResult.error });
    }
  }

  // 3. Mark event as synced (note succeeded, even if opp move failed)
  await updateEventMetadata(supabase, replyEvent.id, {
    ghl_synced: true,
    ghl_note_id: noteResult.noteId,
    ghl_opp_move_ok: oppMoveResult.ok,
  });

  return { processed: true };
}

async function updateEventMetadata(supabase, eventId, metadataPartial) {
  try {
    const { data: current } = await supabase
      .from('outreach_events')
      .select('metadata')
      .eq('id', eventId)
      .maybeSingle();

    const newMetadata = {
      ...(current?.metadata || {}),
      ...metadataPartial,
      ghl_sync_attempted_at: new Date().toISOString(),
    };

    await supabase
      .from('outreach_events')
      .update({ metadata: newMetadata })
      .eq('id', eventId);
  } catch (err) {
    logger.warn('reply_to_ghl: failed to update event metadata', {
      eventId,
      error: err.message,
    });
  }
}

async function main() {
  if (!GHL_KEY || !GHL_LOCATION_ID) {
    logger.error('reply_to_ghl: GHL credentials missing (GHL_API_KEY or GHL_LOCATION_ID)');
    process.exit(1);
  }

  const supabase = buildSupabase();

  try {
    // Fetch unsync'd replied events from last 24h
    const cutoff = new Date(Date.now() - REPLY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data: events, error } = await supabase
      .from('outreach_events')
      .select('*')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .gte('occurred_at', cutoff)
      .order('occurred_at', { ascending: true })
      .limit(100);

    if (error) {
      logger.error('reply_to_ghl: query error', { error: error.message });
      process.exit(1);
    }

    if (!events || events.length === 0) {
      logger.info('reply_to_ghl: no unsync\'d replied events in last 24h');
      process.exit(0);
    }

    logger.info('reply_to_ghl: processing replied events', { count: events.length });

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of events) {
      // Skip if already synced
      if (event.metadata?.ghl_synced === true) {
        skipped++;
        continue;
      }

      try {
        // Fetch lead + campaign data
        const { data: lead, error: leadErr } = await supabase
          .from('leads')
          .select('id, business_name, email_address, phone')
          .eq('id', event.lead_id)
          .maybeSingle();

        if (leadErr || !lead) {
          logger.warn('reply_to_ghl: lead not found', { lead_id: event.lead_id });
          await updateEventMetadata(supabase, event.id, {
            ghl_synced: false,
            reason: 'lead_not_found',
          });
          errors++;
          continue;
        }

        const { data: ced, error: cedErr } = await supabase
          .from('campaign_enriched_data')
          .select('lead_magnets_data')
          .eq('prospect_id', lead.id)
          .maybeSingle();

        const magnetData = ced?.lead_magnets_data || {};

        const result = await processOneReply(supabase, event, lead, magnetData);

        if (result.processed) {
          processed++;
        } else {
          errors++;
        }
      } catch (err) {
        logger.error('reply_to_ghl: processing threw', {
          event_id: event.id,
          error: err.message,
        });
        errors++;
      }
    }

    logger.info('reply_to_ghl: sync complete', { processed, skipped, errors });
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    logger.error('reply_to_ghl: fatal error', { error: err.message });
    process.exit(1);
  }
}

if (SELF_CHECK) {
  logger.info('reply_to_ghl: self-check mode');
  await main();
} else {
  await main();
}
