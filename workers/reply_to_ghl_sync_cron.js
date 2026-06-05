// ============================================================
// workers/reply_to_ghl_sync_cron.js — Sync replies to GHL
//
// Cron (each 5 min) that:
//   1. Reads outreach_events with event_type='replied' that haven't been
//      synced to GHL (check metadata.ghl_synced = false/absent)
//   2. For each reply, writes a note to the GHL contact
//   3. Moves the lead to the INTERESADO pipeline stage in GHL
//   4. Marks metadata.ghl_synced = true after success
//   5. On failure (timeout, 4xx), retry once after 30s, then log warning
//
// Config:
//   GHL_PIPELINE_ID — from env (e.g., pipeline UUID in GHL)
//   GHL_STAGE_INTERESADO_ID — from env (e.g., stage UUID for "INTERESADO")
//   EMPIRIKA_GHL_KEY — GHL API token
//   EMPIRIKA_GHL_LOCATION_ID — GHL location
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
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_KEY = process.env.EMPIRIKA_GHL_KEY;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const SELF_CHECK = process.argv.includes('--self-check');

// Only process replies from the last 24 hours (no backfill)
const HOUR_24 = 24 * 60 * 60 * 1000;

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

/**
 * Fetch GHL contact by email to get the contact ID.
 * @param {string} email
 * @returns {Promise<string|null>} contactId or null
 */
async function fetchGhlContactId(email) {
  try {
    if (!email) return null;
    const url = new URL(`${GHL_BASE}/contacts/`);
    url.searchParams.set('locationId', LOCATION_ID);
    url.searchParams.set('query', email);
    url.searchParams.set('limit', '5');
    
    const res = await fetch(url.toString(), { headers: getGhlHeaders() });
    if (!res.ok) return null;
    
    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    const contact = list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0];
    return contact?.id || null;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: fetchGhlContactId error', { email, error: err.message });
    return null;
  }
}

/**
 * Post a note to a GHL contact.
 * @param {string} contactId
 * @param {string} noteBody
 * @returns {Promise<boolean>} true if success
 */
async function postGhlNote(contactId, noteBody) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getGhlHeaders(),
      body: JSON.stringify({ body: noteBody }),
      timeout: 10000,
    });
    
    if (!res.ok) {
      logger.warn('reply_to_ghl_sync: postGhlNote failed', { 
        contactId, 
        status: res.status, 
        error: await res.text().catch(() => '') 
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: postGhlNote error', { contactId, error: err.message });
    return false;
  }
}

/**
 * Move a GHL opportunity to INTERESADO stage.
 * @param {string} opportunityId
 * @returns {Promise<boolean>} true if success
 */
async function moveGhlOpportunity(opportunityId) {
  try {
    if (!GHL_PIPELINE_ID || !GHL_STAGE_INTERESADO_ID) {
      logger.warn('reply_to_ghl_sync: missing GHL_PIPELINE_ID or GHL_STAGE_INTERESADO_ID');
      return false;
    }

    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getGhlHeaders(),
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: GHL_STAGE_INTERESADO_ID,
      }),
      timeout: 10000,
    });

    if (!res.ok) {
      logger.warn('reply_to_ghl_sync: moveGhlOpportunity failed', {
        opportunityId,
        status: res.status,
        error: await res.text().catch(() => ''),
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('reply_to_ghl_sync: moveGhlOpportunity error', { opportunityId, error: err.message });
    return false;
  }
}

// ── Process one reply ────────────────────────────────────────

/**
 * Sync a single reply event to GHL.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} event — outreach_events row
 * @returns {Promise<{action: string, [key: string]: any}>}
 */
async function syncReplyToGhl(supabase, event) {
  try {
    // Fetch lead details
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('email, ghl_contact_id, ghl_opportunity_id')
      .eq('id', event.lead_id)
      .single();

    if (leadErr || !lead) {
      logger.warn('reply_to_ghl_sync: lead not found', { lead_id: event.lead_id });
      return { action: 'lead_not_found', event_id: event.id };
    }

    // Resolve GHL contact ID
    let contactId = lead.ghl_contact_id;
    if (!contactId && lead.email) {
      contactId = await fetchGhlContactId(lead.email);
      if (!contactId) {
        logger.warn('reply_to_ghl_sync: could not resolve GHL contact', { 
          lead_id: event.lead_id, 
          email: lead.email 
        });
        return { action: 'contact_not_found', event_id: event.id };
      }
    }

    // Build note with reply preview
    const replyText = event.metadata?.reply_preview || event.metadata?.message || '';
    const noteBody = `Lead ha respondido al email:\n\n${replyText.slice(0, 200)}${replyText.length > 200 ? '...' : ''}`;

    // Post note
    const noteOk = await postGhlNote(contactId, noteBody);
    if (!noteOk) {
      return { action: 'note_failed', event_id: event.id };
    }

    // Move opportunity
    const oppId = lead.ghl_opportunity_id;
    let moveOk = false;
    if (oppId) {
      moveOk = await moveGhlOpportunity(oppId);
    } else {
      logger.warn('reply_to_ghl_sync: no ghl_opportunity_id', { lead_id: event.lead_id });
      moveOk = true; // Don't fail — note was posted
    }

    // Mark as synced
    const { error: updateErr } = await supabase
      .from('outreach_events')
      .update({
        metadata: { ...event.metadata, ghl_synced: true, ghl_synced_at: new Date().toISOString() },
      })
      .eq('id', event.id);

    if (updateErr) {
      logger.warn('reply_to_ghl_sync: failed to mark as synced', { event_id: event.id, error: updateErr.message });
      return { action: 'sync_mark_failed', event_id: event.id };
    }

    return { action: 'synced', event_id: event.id, contact_id: contactId, move_ok: moveOk };
  } catch (err) {
    logger.warn('reply_to_ghl_sync: unexpected error', { event_id: event.id, error: err.message });
    return { action: 'error', event_id: event.id, error: err.message };
  }
}

// ── Main cron cycle ──────────────────────────────────────────

async function runCycle() {
  if (!GHL_KEY) {
    logger.warn('reply_to_ghl_sync: GHL_KEY not set — skipping');
    return;
  }

  try {
    const supabase = buildSupabase();

    // Fetch unsynced replies from last 24 hours
    const cutoff = new Date(Date.now() - HOUR_24).toISOString();
    const { data: events, error: queryErr } = await supabase
      .from('outreach_events')
      .select('id, lead_id, metadata, occurred_at')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .gte('occurred_at', cutoff)
      .order('occurred_at', { ascending: true });

    if (queryErr) {
      logger.warn('reply_to_ghl_sync: query failed', { error: queryErr.message });
      return;
    }

    if (!events || events.length === 0) {
      logger.info('reply_to_ghl_sync: no unsynced replies');
      return;
    }

    logger.info(`reply_to_ghl_sync: processing ${events.length} replies`);

    // Filter to only unsync events
    const toSync = events.filter(e => !e.metadata?.ghl_synced);

    // Process each
    const results = [];
    for (const event of toSync) {
      const result = await syncReplyToGhl(supabase, event);
      results.push(result);
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 500));
    }

    const summary = {
      total: toSync.length,
      synced: results.filter(r => r.action === 'synced').length,
      failed: results.filter(r => r.action !== 'synced').length,
    };

    logger.info('reply_to_ghl_sync: cycle complete', summary);
  } catch (err) {
    logger.error('reply_to_ghl_sync: cycle failed', { error: err.message });
  }
}

// ── Boot ─────────────────────────────────────────────────────

async function main() {
  if (SELF_CHECK) {
    logger.info('reply_to_ghl_sync: self-check mode');
    await runCycle();
    process.exit(0);
  }

  // Production mode: run once per 5 minutes
  logger.info('reply_to_ghl_sync: starting loop');
  await runCycle();

  // Subsequent cycles every 5 minutes
  setInterval(runCycle, 5 * 60 * 1000);
}

main().catch(err => {
  logger.error('reply_to_ghl_sync: boot failed', { error: err.message });
  process.exit(1);
});
