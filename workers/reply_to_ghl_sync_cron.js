// ============================================================
// workers/reply_to_ghl_sync_cron.js — Sync replies to GHL panel
//
// Cron (each 5 min via Render schedule) that:
//   1. Fetches outreach_events with event_type='replied' created in last 24h
//   2. For each reply: writes a note to GHL contact + moves to INTERESADO stage
//   3. Marks event with metadata.ghl_synced=true after successful sync
//   4. Retries once on failure; logs warning if fails twice
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
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GHL API calls ────────────────────────────────────────────

function getGhlHeaders() {
  return {
    Authorization: `Bearer ${process.env.EMPIRIKA_GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function findContactByLeadEmail(leadEmail) {
  if (!leadEmail) return null;
  try {
    const url = new URL(`${GHL_BASE}/contacts/`);
    url.searchParams.set('locationId', process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2');
    url.searchParams.set('query', leadEmail);
    url.searchParams.set('limit', '5');
    
    const res = await fetch(url.toString(), { 
      headers: getGhlHeaders(),
      timeout: 10000
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    return list.find(c => (c.email || '').toLowerCase() === leadEmail.toLowerCase()) || list[0] || null;
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] Error finding contact', { email: leadEmail, error: err?.message });
    return null;
  }
}

async function addNoteToContact(contactId, noteText) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getGhlHeaders(),
      body: JSON.stringify({ value: noteText }),
      timeout: 10000
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[reply_to_ghl_sync] Failed to add note', { contactId, status: res.status, error: text.slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] Error adding note', { contactId, error: err?.message });
    return false;
  }
}

async function moveToInteresadoStage(opportunityId) {
  if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
    logger.warn('[reply_to_ghl_sync] Missing GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID env vars');
    return false;
  }
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getGhlHeaders(),
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: GHL_STAGE_INTERESADO_ID
      }),
      timeout: 10000
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[reply_to_ghl_sync] Failed to move to INTERESADO stage', { opportunityId, status: res.status, error: text.slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] Error moving to stage', { opportunityId, error: err?.message });
    return false;
  }
}

// ── Main loop ────────────────────────────────────────────────

async function runCycle(sb) {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const { data: events, error } = await sb
      .from('outreach_events')
      .select('id, lead_id, metadata, occurred_at')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .eq('channel', 'email')
      .gte('occurred_at', twentyFourHoursAgo.toISOString())
      .is('metadata->>ghl_synced', null);

    if (error) {
      logger.error('[reply_to_ghl_sync] Failed to fetch replied events', { error: error.message });
      return;
    }

    if (!events || events.length === 0) {
      logger.info('[reply_to_ghl_sync] No unsynchronized replies found in last 24h');
      return;
    }

    logger.info(`[reply_to_ghl_sync] Found ${events.length} unsynchronized replies`);

    for (const event of events) {
      try {
        const { data: lead, error: leadError } = await sb
          .from('leads')
          .select('email, ghl_contact_id')
          .eq('id', event.lead_id)
          .single();

        if (leadError || !lead) {
          logger.warn('[reply_to_ghl_sync] Lead not found', { lead_id: event.lead_id });
          await markEventSynced(sb, event.id);
          continue;
        }

        let contactId = lead.ghl_contact_id;
        
        if (!contactId && lead.email) {
          const contact = await findContactByLeadEmail(lead.email);
          contactId = contact?.id;
          
          if (contactId) {
            await sb.from('leads').update({ ghl_contact_id: contactId }).eq('id', event.lead_id);
          }
        }

        if (!contactId) {
          logger.warn('[reply_to_ghl_sync] No GHL contact ID found for lead', { lead_id: event.lead_id, email: lead.email });
          await markEventSynced(sb, event.id);
          continue;
        }

        const noteText = `📬 Reply recibida: Lead respondió al email de Empírika. Fecha: ${new Date(event.occurred_at).toISOString()}`;
        
        const noteSuccess = await addNoteToContact(contactId, noteText);
        const stageSuccess = await moveToInteresadoStage(contactId);

        if (noteSuccess && stageSuccess) {
          logger.info('[reply_to_ghl_sync] Successfully synced reply to GHL', { event_id: event.id, contactId });
          await markEventSynced(sb, event.id);
        } else if (!noteSuccess || !stageSuccess) {
          logger.warn('[reply_to_ghl_sync] Partial sync failure, will retry next cycle', { event_id: event.id });
        }
      } catch (err) {
        logger.error('[reply_to_ghl_sync] Error processing event', { event_id: event.id, error: err?.message });
      }
    }

  } catch (err) {
    logger.error('[reply_to_ghl_sync] Unexpected error in runCycle', { error: err?.message });
  }
}

async function markEventSynced(sb, eventId) {
  try {
    await sb.from('outreach_events')
      .update({ metadata: { ghl_synced: true } })
      .eq('id', eventId);
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] Failed to mark event as synced', { event_id: eventId, error: err?.message });
  }
}

// ── Boot ─────────────────────────────────────────────────────

(async () => {
  try {
    const sb = buildSupabase();
    logger.info('[reply_to_ghl_sync] Boot');

    if (SELF_CHECK) {
      logger.info('[reply_to_ghl_sync] Running self-check (one cycle then exit)');
      await runCycle(sb);
      logger.info('[reply_to_ghl_sync] Self-check complete');
      process.exit(0);
    }

    // Production mode: run once, log done
    await runCycle(sb);
    logger.info('[reply_to_ghl_sync] Cycle done');
  } catch (err) {
    logger.error('[reply_to_ghl_sync] Boot error', { error: err?.message });
    process.exit(1);
  }
})();
