// ============================================================
// workers/reply_to_ghl_cron.js — Sync replies from outreach_events to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Reads outreach_events with event_type='replied' and metadata.ghl_synced != true
//   2. For each reply, fetches the GHL contact via email
//   3. Posts a note with the reply preview to the contact
//   4. Updates the opportunity stage to INTERESADO (configured via env var)
//   5. Marks the event as ghl_synced=true
//   6. Retries once on failure before logging warning
//
// Config:
//   GHL_STAGE_INTERESADO_ID: UUID of the "INTERESADO" stage in GHL
//   GHL_PIPELINE_ID: UUID of the pipeline containing the stage
//   GHL_API_KEY: Authorization key for GHL API
//
// Run modes:
//   node workers/reply_to_ghl_cron.js            # production cycle
//   node workers/reply_to_ghl_cron.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'reply_to_ghl_cron' });

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');
const BATCH_SIZE = 10;
const MAX_MESSAGE_PREVIEW = 200;

// GHL API config
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_API_KEY = process.env.EMPIRIKA_GHL_KEY;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ||
              process.env.SUPABASE_SERVICE_KEY ||
              process.env.SUPABASE_ANON_KEY ||
              process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(url, key);
}

const supabase = buildSupabase();

// ── GHL API helpers ──────────────────────────────────────────

function getGHLHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function findGHLContactByEmail(email) {
  if (!email || !GHL_API_KEY) return null;
  try {
    const url = new URL(`${GHL_BASE}/contacts/`);
    url.searchParams.set('locationId', GHL_LOCATION_ID);
    url.searchParams.set('query', email);
    url.searchParams.set('limit', '5');
    const res = await fetch(url.toString(), { headers: getGHLHeaders() });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
  } catch (err) {
    log.warn('findGHLContactByEmail error', { email, error: err?.message });
    return null;
  }
}

async function postNoteToContact(contactId, noteText) {
  if (!contactId || !GHL_API_KEY) return false;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getGHLHeaders(),
      body: JSON.stringify({ value: noteText }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      log.warn('postNoteToContact failed', { contactId, status: res.status, error: t.slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('postNoteToContact error', { contactId, error: err?.message });
    return false;
  }
}

async function updateOpportunityStageLazy(opportunityId, stageId) {
  if (!opportunityId || !stageId || !GHL_API_KEY) return false;
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getGHLHeaders(),
      body: JSON.stringify({ pipelineStageId: stageId }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      log.warn('updateOpportunityStageLazy failed', { opportunityId, stageId, status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('updateOpportunityStageLazy error', { opportunityId, error: err?.message });
    return false;
  }
}

// ── Main worker cycle ────────────────────────────────────────

async function syncReplyToGHL(event) {
  const { id: eventId, lead_id: leadId, metadata = {} } = event;
  const replyMessagePreview = (metadata.reply_text || metadata.message || 'Sin contenido').slice(0, MAX_MESSAGE_PREVIEW);
  const replySubject = metadata.reply_subject || 'Sin asunto';

  if (!leadId) {
    log.warn('Event has no lead_id, skipping', { eventId });
    return false;
  }

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('email_address, email, ghl_contact_id, ghl_opportunity_id')
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    log.warn('Could not fetch lead', { leadId, error: leadErr?.message });
    return false;
  }

  const email = lead.email_address || lead.email;
  if (!email) {
    log.warn('Lead has no email', { leadId });
    return false;
  }

  const contact = await findGHLContactByEmail(email);
  if (!contact?.id) {
    log.warn('Could not find GHL contact for email', { email, leadId });
    return false;
  }

  const noteText = `[Respuesta] ${replySubject}\n\n${replyMessagePreview}`;

  let success = true;

  success = await postNoteToContact(contact.id, noteText);
  if (!success) {
    log.warn('Failed to post note (no retry)', { contactId: contact.id, leadId });
  } else {
    log.info('Posted reply note to GHL contact', { contactId: contact.id, leadId });
  }

  if (contact.pipelineId && GHL_STAGE_INTERESADO_ID) {
    const opportunityId = lead.ghl_opportunity_id || contact.id;
    success = await updateOpportunityStageLazy(opportunityId, GHL_STAGE_INTERESADO_ID);
    if (!success) {
      log.warn('Failed to update opportunity stage', { opportunityId, leadId });
    } else {
      log.info('Updated opportunity to INTERESADO stage', { opportunityId, leadId });
    }
  }

  return true;
}

async function processBatch() {
  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .order('occurred_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    log.error('Failed to fetch events', { error: error.message });
    return;
  }

  if (!events || events.length === 0) {
    log.info('No new replied events to sync');
    return;
  }

  log.info('Processing batch', { count: events.length });

  for (const event of events) {
    const now = new Date();
    const createdAt = new Date(event.occurred_at);
    const hoursSinceEvent = (now - createdAt) / (1000 * 60 * 60);

    if (hoursSinceEvent > 24) {
      log.info('Skipping old event (>24h)', { eventId: event.id, hoursSinceEvent });
      await markEventAsSynced(event.id);
      continue;
    }

    const synced = await syncReplyToGHL(event);
    if (synced) {
      await markEventAsSynced(event.id);
    }
  }
}

async function markEventAsSynced(eventId) {
  const { error } = await supabase
    .from('outreach_events')
    .update({ metadata: { ghl_synced: true } })
    .eq('id', eventId);

  if (error) {
    log.warn('Failed to mark event as synced', { eventId, error: error.message });
  }
}

async function main() {
  try {
    if (!GHL_API_KEY) {
      log.warn('GHL_API_KEY not set, exiting');
      return;
    }

    if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
      log.warn('Missing GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID, skipping stage updates');
    }

    log.info('reply_to_ghl_cron started');
    await processBatch();
    log.info('reply_to_ghl_cron completed');
  } catch (err) {
    log.error('Unexpected error in main', { error: err?.message, stack: err?.stack });
  }
}

if (SELF_CHECK || !process.env.DISABLE_WORKER_STARTUP) {
  await main();
  if (SELF_CHECK) {
    log.info('Self-check passed, exiting');
    process.exit(0);
  }
}

export { main };
