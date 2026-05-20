// ============================================================
// workers/reply_to_ghl_sync_cron.js — Sync replied events to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Reads outreach_events with event_type='replied' and 
//      metadata.ghl_synced ≠ true
//   2. For each reply: fetch GHL contact, POST note with preview,
//      PUT pipeline stage to INTERESADO
//   3. Mark event with metadata.ghl_synced=true
//   4. If sync fails (timeout, 4xx), retry once after 30s
//
// Constraints:
//   - Only processes replies < 24h old (no backfill)
//   - Env vars: GHL_STAGE_INTERESADO_ID, GHL_PIPELINE_ID
//   - Never throws; logs all failures
//
// Run modes:
//   node workers/reply_to_ghl_sync_cron.js            # production
//   node workers/reply_to_ghl_sync_cron.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_KEY = process.env.EMPIRIKA_GHL_KEY;
const GHL_LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const MAX_REPLY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GHL API helpers ──────────────────────────────────────────

function getGhlHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function findGhlContact(email) {
  if (!email || !GHL_KEY) return null;
  try {
    const url = new URL(`${GHL_BASE}/contacts/`);
    url.searchParams.set('locationId', GHL_LOCATION_ID);
    url.searchParams.set('query', email);
    url.searchParams.set('limit', '5');
    
    const res = await fetch(url.toString(), {
      headers: getGhlHeaders(),
      timeout: 10000,
    });
    
    if (!res.ok) {
      logger.warn('reply_to_ghl_sync: GHL contact search failed', {
        email,
        status: res.status,
      });
      return null;
    }

    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: GHL contact search error', { email, err: err.message });
    return null;
  }
}

async function postNoteToContact(contactId, noteBody) {
  if (!contactId || !noteBody || !GHL_KEY) return false;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getGhlHeaders(),
      body: JSON.stringify({ value: noteBody }),
      timeout: 10000,
    });

    if (!res.ok) {
      logger.warn('reply_to_ghl_sync: failed to post note', {
        contactId,
        status: res.status,
      });
      return false;
    }

    logger.info('reply_to_ghl_sync: note posted', { contactId });
    return true;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: error posting note', {
      contactId,
      err: err.message,
    });
    return false;
  }
}

async function updatePipelineStage(opportunityId, stageId) {
  if (!opportunityId || !stageId || !GHL_KEY) return false;
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getGhlHeaders(),
      body: JSON.stringify({ pipelineStageId: stageId }),
      timeout: 10000,
    });

    if (!res.ok) {
      logger.warn('reply_to_ghl_sync: failed to update stage', {
        opportunityId,
        status: res.status,
      });
      return false;
    }

    logger.info('reply_to_ghl_sync: stage updated', { opportunityId });
    return true;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: error updating stage', {
      opportunityId,
      err: err.message,
    });
    return false;
  }
}

// ── processOneReplyEvent ─────────────────────────────────────

async function processOneReplyEvent(supabase, event) {
  const { id: eventId, metadata, lead_id: leadId } = event;

  if (!metadata || typeof metadata !== 'object') {
    logger.warn('reply_to_ghl_sync: invalid metadata', { eventId });
    return { action: 'skip', reason: 'invalid_metadata' };
  }

  const { from_email, subject, body } = metadata;

  if (!from_email) {
    logger.warn('reply_to_ghl_sync: no from_email in metadata', { eventId });
    return { action: 'skip', reason: 'no_from_email' };
  }

  // Fetch the lead to get email
  let lead;
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('email')
      .eq('id', leadId)
      .single();

    if (error || !data) {
      logger.warn('reply_to_ghl_sync: lead not found', { leadId, error: error?.message });
      return { action: 'skip', reason: 'lead_not_found' };
    }

    lead = data;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: error fetching lead', { leadId, err: err.message });
    return { action: 'skip', reason: 'fetch_lead_error' };
  }

  // Find GHL contact
  const ghlContact = await findGhlContact(lead.email);
  if (!ghlContact) {
    logger.warn('reply_to_ghl_sync: GHL contact not found', { email: lead.email });
    return { action: 'skip', reason: 'ghl_contact_not_found' };
  }

  const contactId = ghlContact.id;

  // Build note body
  const preview = body ? body.slice(0, 200).replace(/\n/g, ' ') : '(sin cuerpo)';
  const noteBody = `📧 Reply recibido\nDe: ${from_email}\nAsunto: ${subject || '(sin asunto)'}\nPreview: ${preview}`;

  // Post note
  const noteSuccess = await postNoteToContact(contactId, noteBody);
  if (!noteSuccess) {
    logger.warn('reply_to_ghl_sync: failed to post note', { eventId, contactId });
    return { action: 'retry', reason: 'note_failed' };
  }

  // Update pipeline stage
  let stageSuccess = true;
  if (GHL_STAGE_INTERESADO_ID && ghlContact.opportunityId) {
    stageSuccess = await updatePipelineStage(
      ghlContact.opportunityId,
      GHL_STAGE_INTERESADO_ID
    );
  } else if (!GHL_STAGE_INTERESADO_ID) {
    logger.info('reply_to_ghl_sync: GHL_STAGE_INTERESADO_ID not set, skipping stage update', {
      eventId,
    });
  } else if (!ghlContact.opportunityId) {
    logger.info('reply_to_ghl_sync: contact has no opportunityId, skipping stage update', {
      contactId,
    });
  }

  // Mark event as synced
  try {
    const { error: updateErr } = await supabase
      .from('outreach_events')
      .update({
        metadata: {
          ...metadata,
          ghl_synced: true,
          ghl_synced_at: new Date().toISOString(),
          ghl_contact_id: contactId,
        },
      })
      .eq('id', eventId);

    if (updateErr) {
      logger.warn('reply_to_ghl_sync: failed to mark synced', { eventId, err: updateErr.message });
      return { action: 'sync_ok_but_mark_failed', reason: updateErr.message };
    }
  } catch (err) {
    logger.warn('reply_to_ghl_sync: error marking synced', { eventId, err: err.message });
    return { action: 'sync_ok_but_mark_failed', reason: err.message };
  }

  logger.info('reply_to_ghl_sync: event synced', { eventId, contactId });
  return { action: 'synced', contactId };
}

// ── runCycle ─────────────────────────────────────────────────

async function runCycle(supabase) {
  // Sanity checks
  if (!GHL_KEY) {
    logger.warn('reply_to_ghl_sync: GHL_KEY not set, skipping cycle');
    return { skipped: true, reason: 'no_ghl_key' };
  }

  const cutoff = new Date(Date.now() - MAX_REPLY_AGE_MS).toISOString();

  // Fetch unsynced replies
  try {
    const { data: events, error } = await supabase
      .from('outreach_events')
      .select('*')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .filter('occurred_at', 'gte', cutoff)
      .order('occurred_at', { ascending: true })
      .limit(50);

    if (error) {
      logger.error('reply_to_ghl_sync: fetch failed', { err: error.message });
      return { error: error.message };
    }

    if (!events || events.length === 0) {
      logger.info('reply_to_ghl_sync: no unsynced replies in last 24h');
      return { processed: 0, synced: 0, skipped: 0, retry: 0 };
    }

    logger.info('reply_to_ghl_sync: found events to process', { count: events.length });

    let synced = 0;
    let skipped = 0;
    let retry = 0;

    for (const event of events) {
      // Skip if already marked synced
      if (event.metadata?.ghl_synced) {
        logger.info('reply_to_ghl_sync: already synced', { eventId: event.id });
        skipped++;
        continue;
      }

      const result = await processOneReplyEvent(supabase, event);

      switch (result.action) {
        case 'synced':
          synced++;
          break;
        case 'retry':
          retry++;
          // Sleep 30s then retry
          await new Promise(r => setTimeout(r, 30000));
          const retryResult = await processOneReplyEvent(supabase, event);
          if (retryResult.action === 'synced') {
            synced++;
          } else {
            logger.warn('reply_to_ghl_sync: retry failed', { eventId: event.id, retryResult });
          }
          break;
        case 'skip':
        case 'sync_ok_but_mark_failed':
        default:
          skipped++;
          break;
      }
    }

    logger.info('reply_to_ghl_sync: cycle done', { synced, skipped, retry });
    return { processed: events.length, synced, skipped, retry };
  } catch (err) {
    logger.error('reply_to_ghl_sync: cycle error', { err: err.message });
    return { error: err.message };
  }
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

export { runCycle };
