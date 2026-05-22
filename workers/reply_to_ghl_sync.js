// ============================================================
// workers/reply_to_ghl_sync.js — Sync replied events to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Reads outreach_events with event_type='replied' and metadata.ghl_synced != true
//   2. For each reply, calls GHL API:
//      - POST /contacts/{ghl_id}/notes with message preview
//      - PUT /opportunities/{id} to move to INTERESADO stage
//   3. Marks as synced via metadata.ghl_synced = true
//   4. Retries once if timeout/4xx, then logs warning without breaking
//
// Run modes:
//   node workers/reply_to_ghl_sync.js            # production cycle
//   node workers/reply_to_ghl_sync.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_ACCESS_TOKEN = process.env.GHL_ACCESS_TOKEN || '';
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID || 'b8f77e8e-e6b1-4a3b-8c8f-43a5c5f1f1f1';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'PbSBohJh1m1L08INwMzv';

// Max age to process: 24 hours (avoid backfill)
const MAX_AGE_HOURS = 24;
const RETRY_DELAY_MS = 30000;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GHL API Helpers ──────────────────────────────────────────

/**
 * Call GHL API with retry logic.
 * If timeout or 4xx, retry once after RETRY_DELAY_MS.
 * If still fails, return error but don't throw.
 */
async function callGhlApi(method, endpoint, body = null) {
  const url = `${GHL_API_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        timeout: 10000,
      });

      if (!response.ok && (response.status === 408 || response.status >= 400 && response.status < 500)) {
        lastError = new Error(`GHL ${response.status}: ${response.statusText}`);
        if (attempt === 1) {
          logger.warn(`reply_to_ghl_sync: attempt ${attempt} failed, retrying in 30s`, {
            endpoint,
            status: response.status,
          });
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(`GHL API error ${response.status}: ${response.statusText}`);
      }

      return { ok: true, data: await response.json() };
    } catch (err) {
      lastError = err;
      if (attempt === 1 && (err.message.includes('timeout') || err.message.includes('ECONNREFUSED'))) {
        logger.warn(`reply_to_ghl_sync: attempt ${attempt} timeout, retrying`, { endpoint });
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  return { ok: false, error: lastError?.message ?? 'Unknown error' };
}

/**
 * Add a note to a GHL contact.
 */
async function addNoteToContact(ghlContactId, messagePreview) {
  const body = {
    body: messagePreview.slice(0, 500),
  };
  return await callGhlApi('POST', `/contacts/${ghlContactId}/notes`, body);
}

/**
 * Move opportunity to INTERESADO stage.
 */
async function moveToInteresadoStage(ghlOpportunityId) {
  const body = {
    pipelineId: GHL_PIPELINE_ID,
    pipelineStageId: GHL_STAGE_INTERESADO_ID,
  };
  return await callGhlApi('PUT', `/opportunities/${ghlOpportunityId}`, body);
}

// ── processOneReply ──────────────────────────────────────────

/**
 * Process a single replied event: sync to GHL.
 * Returns { action, ... } — never throws.
 */
async function processOneReply(supabase, eventRow) {
  const { id, lead_id, metadata } = eventRow;

  // 1. Fetch lead to get GHL IDs
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('ghl_contact_id, ghl_opportunity_id')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) {
    logger.warn('reply_to_ghl_sync: lead not found', { lead_id, err: leadErr?.message });
    return { action: 'lead_not_found', event_id: id };
  }

  const { ghl_contact_id, ghl_opportunity_id } = lead;
  if (!ghl_contact_id || !ghl_opportunity_id) {
    logger.warn('reply_to_ghl_sync: missing GHL IDs', { lead_id, ghl_contact_id, ghl_opportunity_id });
    return { action: 'missing_ghl_ids', event_id: id };
  }

  // 2. Add note to contact
  const msgPreview = metadata.body || metadata.subject || '(Sin contenido)';
  const noteResult = await addNoteToContact(ghl_contact_id, msgPreview);

  if (!noteResult.ok) {
    logger.warn('reply_to_ghl_sync: failed to add note', {
      event_id: id,
      lead_id,
      ghl_contact_id,
      error: noteResult.error,
    });
    return { action: 'note_failed', event_id: id, error: noteResult.error };
  }

  // 3. Move to INTERESADO stage
  const stageResult = await moveToInteresadoStage(ghl_opportunity_id);

  if (!stageResult.ok) {
    logger.warn('reply_to_ghl_sync: failed to move stage', {
      event_id: id,
      lead_id,
      ghl_opportunity_id,
      error: stageResult.error,
    });
    return { action: 'stage_failed', event_id: id, error: stageResult.error };
  }

  // 4. Mark as synced
  const newMetadata = { ...metadata, ghl_synced: true, ghl_synced_at: new Date().toISOString() };
  const { error: updateErr } = await supabase
    .from('outreach_events')
    .update({ metadata: newMetadata })
    .eq('id', id);

  if (updateErr) {
    logger.warn('reply_to_ghl_sync: failed to mark synced', { event_id: id, err: updateErr.message });
    return { action: 'sync_mark_failed', event_id: id, error: updateErr.message };
  }

  logger.info('reply_to_ghl_sync: synced reply to GHL', {
    event_id: id,
    lead_id,
    ghl_contact_id,
    note_added: true,
    stage_moved: true,
  });

  return { action: 'synced', event_id: id, lead_id };
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * One full sync cycle: fetch pending replies → sync each → advance.
 */
async function runCycle(supabase) {
  logger.info('reply_to_ghl_sync: cycle start');

  // Fetch replies from last 24 hours that haven't been synced
  const since = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: events, error: fetchErr } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true });

  if (fetchErr) {
    logger.error('reply_to_ghl_sync: fetch failed', { err: fetchErr.message });
    return { fetched: 0, synced: 0, skipped: 0, failed: 0 };
  }

  // Filter to only unsync'd events
  const pendingEvents = events.filter(e => !e.metadata?.ghl_synced);

  logger.info('reply_to_ghl_sync: found pending events', { total: pendingEvents.length });

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of pendingEvents) {
    const result = await processOneReply(supabase, event);
    switch (result.action) {
      case 'synced': synced++; break;
      case 'lead_not_found':
      case 'missing_ghl_ids':
        skipped++;
        break;
      default:
        failed++;
    }
  }

  logger.info('reply_to_ghl_sync: cycle done', {
    fetched: events.length,
    pending: pendingEvents.length,
    synced,
    failed,
    skipped,
  });

  return { fetched: events.length, synced, failed, skipped };
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  logger.info('reply_to_ghl_sync worker starting', { selfCheck: SELF_CHECK });

  if (!GHL_ACCESS_TOKEN) {
    logger.warn('reply_to_ghl_sync: GHL_ACCESS_TOKEN not set, skipping');
    process.exit(0);
  }

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
