import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.EMPIRIKA_GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_KEY = process.env.EMPIRIKA_GHL_KEY;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const SELF_CHECK = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getGHLHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function findContactByLeadId(supabase, leadId) {
  const { data: leads, error: ledErr } = await supabase
    .from('leads')
    .select('email_address, email')
    .eq('id', leadId)
    .maybeSingle();

  if (ledErr || !leads) return null;

  const email = leads.email_address || leads.email;
  if (!email) return null;

  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set('locationId', LOCATION_ID);
  url.searchParams.set('query', email);
  url.searchParams.set('limit', '5');

  try {
    const res = await fetch(url.toString(), { headers: getGHLHeaders() });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const list = body?.contacts || [];
    return list.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || list[0] || null;
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] fetch contact error', { error: err.message });
    return null;
  }
}

async function postNoteToGHL(contactId, noteBody) {
  const url = `${GHL_BASE}/contacts/${contactId}/notes`;
  const payload = { body: noteBody };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getGHLHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn('[reply_to_ghl_sync] post note failed', {
        status: res.status,
        error: errText.slice(0, 200),
      });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] post note network error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function updateOpportunityStage(opportunityId, pipelineStageId) {
  const url = `${GHL_BASE}/opportunities/${opportunityId}`;
  const payload = { pipelineStageId };

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: getGHLHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn('[reply_to_ghl_sync] update opportunity failed', {
        status: res.status,
        error: errText.slice(0, 200),
      });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] update opportunity network error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function processReplyEvent(supabase, event) {
  const { id: eventId, lead_id: leadId, metadata } = event;
  
  if (!leadId) {
    logger.warn('[reply_to_ghl_sync] reply event has no lead_id', { eventId });
    return;
  }

  const contact = await findContactByLeadId(supabase, leadId);
  if (!contact) {
    logger.warn('[reply_to_ghl_sync] could not find GHL contact for lead', { leadId, eventId });
    return;
  }

  const messagePreview = (metadata?.preview || metadata?.snippet || metadata?.body || '').slice(0, 300);
  const noteBody = `🔔 Lead respondió: "${messagePreview}"`;

  let noteOk = false;
  try {
    const postRes = await postNoteToGHL(contact.id, noteBody);
    if (!postRes.ok) {
      await new Promise(r => setTimeout(r, 30000));
      const retryRes = await postNoteToGHL(contact.id, noteBody);
      noteOk = retryRes.ok;
      if (!noteOk) {
        logger.warn('[reply_to_ghl_sync] note failed twice', { leadId, eventId, contactId: contact.id });
      }
    } else {
      noteOk = true;
    }
  } catch (err) {
    logger.warn('[reply_to_ghl_sync] note post exception', { error: err.message, leadId });
  }

  if (GHL_PIPELINE_ID && GHL_STAGE_INTERESADO_ID && contact.defaultOpportunityId) {
    try {
      const oppRes = await updateOpportunityStage(contact.defaultOpportunityId, GHL_STAGE_INTERESADO_ID);
      if (!oppRes.ok) {
        await new Promise(r => setTimeout(r, 30000));
        const retryRes = await updateOpportunityStage(contact.defaultOpportunityId, GHL_STAGE_INTERESADO_ID);
        if (!retryRes.ok) {
          logger.warn('[reply_to_ghl_sync] opportunity update failed twice', {
            leadId,
            eventId,
            oppId: contact.defaultOpportunityId,
          });
        }
      }
    } catch (err) {
      logger.warn('[reply_to_ghl_sync] opportunity update exception', { error: err.message, leadId });
    }
  }

  await supabase
    .from('outreach_events')
    .update({ metadata: { ...metadata, ghl_synced: true } })
    .eq('id', eventId)
    .catch(err => logger.warn('[reply_to_ghl_sync] failed to mark synced', { error: err.message }));
}

async function runCycle(supabase) {
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, event_type, occurred_at, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', cutoff24h.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('[reply_to_ghl_sync] failed to fetch events', { error: error.message });
    return;
  }

  const toProcess = (events || []).filter(e => {
    const metadata = e.metadata || {};
    return !metadata.ghl_synced;
  });

  logger.info('[reply_to_ghl_sync] cycle start', {
    totalReplies: (events || []).length,
    toProcess: toProcess.length,
  });

  for (const event of toProcess) {
    await processReplyEvent(supabase, event);
  }

  logger.info('[reply_to_ghl_sync] cycle complete', { processed: toProcess.length });
}

async function main() {
  try {
    if (!GHL_KEY) {
      logger.warn('[reply_to_ghl_sync] EMPIRIKA_GHL_KEY not set — skipping');
      return;
    }

    const supabase = buildSupabase();
    
    if (SELF_CHECK) {
      await runCycle(supabase);
      logger.info('[reply_to_ghl_sync] self-check complete');
      process.exit(0);
    }

    const INTERVAL = 5 * 60 * 1000;
    logger.info('[reply_to_ghl_sync] starting cron', { intervalMs: INTERVAL });

    await runCycle(supabase);
    
    setInterval(async () => {
      try {
        await runCycle(supabase);
      } catch (err) {
        logger.error('[reply_to_ghl_sync] cycle error', { error: err.message });
      }
    }, INTERVAL);
  } catch (err) {
    logger.error('[reply_to_ghl_sync] startup error', { error: err.message });
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { processReplyEvent, findContactByLeadId, postNoteToGHL, updateOpportunityStage };
