import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const SYNC_LOOKBACK_HOURS = Number(process.env.GHL_REPLY_SYNC_LOOKBACK_HOURS ?? 24);
const BATCH_SIZE = Number(process.env.GHL_REPLY_SYNC_BATCH_SIZE ?? 10);
const RETRY_DELAY_MS = 30000;

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.EMPIRIKA_GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function findContactByEmail(email) {
  if (!email) return null;
  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set('locationId', LOCATION_ID);
  url.searchParams.set('query', email);
  url.searchParams.set('limit', '5');
  try {
    const res = await fetch(url.toString(), { headers: getHeaders() });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
  } catch (err) {
    logger.warn('[ghl_reply_sync] contact lookup failed', { email, error: err?.message });
    return null;
  }
}

async function writeNoteToContact(contactId, noteBody) {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ value: noteBody }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[ghl_reply_sync] note write failed', { status: res.status, error: text.slice(0, 200) });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[ghl_reply_sync] note write exception', { error: err?.message });
    return { ok: false };
  }
}

async function moveToStage(opportunityId, stageId) {
  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ pipelineStageId: stageId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[ghl_reply_sync] stage move failed', { status: res.status, error: text.slice(0, 200) });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[ghl_reply_sync] stage move exception', { error: err?.message });
    return { ok: false };
  }
}

async function processReply(supabase, event) {
  try {
    const { lead_id, metadata } = event;
    if (!lead_id) return;

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, email_address, email, ghl_contact_id')
      .eq('id', lead_id)
      .maybeSingle();

    if (leadError || !lead) {
      logger.warn('[ghl_reply_sync] lead not found', { lead_id });
      return;
    }

    const email = lead.email_address || lead.email;
    if (!email) {
      logger.warn('[ghl_reply_sync] no email on lead', { lead_id });
      return;
    }

    let contact = null;
    if (lead.ghl_contact_id) {
      contact = { id: lead.ghl_contact_id };
    } else {
      contact = await findContactByEmail(email);
    }

    if (!contact?.id) {
      logger.warn('[ghl_reply_sync] ghl contact not found', { lead_id, email });
      return;
    }

    const replyPreview = (metadata?.reply_body || '')
      .slice(0, 300)
      .replace(/\n/g, ' ')
      .trim();

    const noteBody = `📩 Reply received: ${replyPreview}`;

    const noteResult = await writeNoteToContact(contact.id, noteBody);
    if (!noteResult.ok) {
      if (noteResult.status === 408 || noteResult.status === 503) {
        logger.warn('[ghl_reply_sync] note write timeout, will retry', { lead_id });
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        await writeNoteToContact(contact.id, noteBody);
      }
      return;
    }

    if (GHL_PIPELINE_ID && GHL_STAGE_INTERESADO_ID && contact.opportunityId) {
      const stageResult = await moveToStage(contact.opportunityId, GHL_STAGE_INTERESADO_ID);
      if (!stageResult.ok && (stageResult.status === 408 || stageResult.status === 503)) {
        logger.warn('[ghl_reply_sync] stage move timeout, will retry', { lead_id });
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        await moveToStage(contact.opportunityId, GHL_STAGE_INTERESADO_ID);
      }
    }

    await supabase
      .from('outreach_events')
      .update({ metadata: { ...metadata, ghl_synced: true } })
      .eq('id', event.id);

    logger.info('[ghl_reply_sync] reply synced to ghl', { lead_id, contact_id: contact.id });
  } catch (err) {
    logger.warn('[ghl_reply_sync] process error', { error: err?.message, event_id: event.id });
  }
}

async function main() {
  const supabase = buildSupabase();

  if (!process.env.EMPIRIKA_GHL_KEY) {
    logger.warn('[ghl_reply_sync] EMPIRIKA_GHL_KEY not set — skipping');
    return;
  }

  if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
    logger.warn('[ghl_reply_sync] GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID not set');
  }

  const since = new Date(Date.now() - SYNC_LOOKBACK_HOURS * 3600 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata, occurred_at')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', since)
    .is('metadata->>ghl_synced', null)
    .order('occurred_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error('[ghl_reply_sync] fetch failed', { error: error.message });
    return;
  }

  if (!events || events.length === 0) {
    logger.info('[ghl_reply_sync] no new replies to sync');
    return;
  }

  logger.info('[ghl_reply_sync] processing replies', { count: events.length });

  for (const event of events) {
    await processReply(supabase, event);
  }

  logger.info('[ghl_reply_sync] batch complete');
}

main().catch(err => {
  logger.error('[ghl_reply_sync] fatal error', { error: err?.message });
  process.exit(1);
});
