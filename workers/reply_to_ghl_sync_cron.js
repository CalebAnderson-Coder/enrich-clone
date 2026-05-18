import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SCAN_WINDOW_HOURS = 24;
const SELF_CHECK = process.argv.includes('--self-check');
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 30000;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID || 'interesado-stage-id';
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'PbSBohJh1m1L08INwMzv';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function ghlHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
  if (!token) {
    logger.warn('No GHL_PRIVATE_TOKEN — sync will be skipped');
    return null;
  }
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 0) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL API error ${res.status}: ${text}`);
    }
    return res;
  } catch (err) {
    if (retries < MAX_RETRIES) {
      logger.warn(`Fetch failed, retrying in ${RETRY_DELAY_MS}ms:`, err.message);
      await sleep(RETRY_DELAY_MS);
      return fetchWithRetry(url, options, retries + 1);
    }
    logger.warn(`Fetch failed after ${MAX_RETRIES} retries:`, err.message);
    return null;
  }
}

async function syncReplyToGHL(supabase, event) {
  const { lead_id, metadata } = event;
  if (!lead_id || metadata?.ghl_synced) return; // Already synced

  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('ghl_contact_id, email, business_name')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead?.ghl_contact_id) {
      logger.warn(`Lead ${lead_id} not found or missing ghl_contact_id`, leadError);
      return;
    }

    const headers = ghlHeaders();
    if (!headers) return;

    const messagePreview = (metadata?.message_body || '').substring(0, 200);
    const noteBody = `Reply received: ${messagePreview}...`;

    const noteRes = await fetchWithRetry(
      `${GHL_BASE}/contacts/${lead.ghl_contact_id}/notes`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          value: noteBody,
          createdBy: 'rally-sync-cron',
        }),
      }
    );

    if (!noteRes) {
      logger.warn(`Failed to create GHL note for lead ${lead_id}`);
      return; // Retry next cycle
    }

    const opportunityRes = await fetchWithRetry(
      `${GHL_BASE}/opportunities/${lead.ghl_contact_id}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          pipelineId: GHL_PIPELINE_ID,
          pipelineStageId: GHL_STAGE_INTERESADO_ID,
        }),
      }
    );

    if (!opportunityRes) {
      logger.warn(`Failed to update GHL opportunity stage for lead ${lead_id}`);
      return;
    }

    await supabase
      .from('outreach_events')
      .update({ metadata: { ...metadata, ghl_synced: true } })
      .eq('id', event.id);

    logger.info(`Successfully synced reply to GHL for lead ${lead_id}`);
  } catch (err) {
    logger.error(`Error syncing reply for lead ${lead_id}:`, err.message);
  }
}

async function run() {
  logger.info('Reply-to-GHL sync cron starting...');

  try {
    const supabase = buildSupabase();

    const cutoffTime = new Date(Date.now() - SCAN_WINDOW_HOURS * 60 * 60 * 1000);

    const { data: events, error } = await supabase
      .from('outreach_events')
      .select('*')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .gte('created_at', cutoffTime.toISOString())
      .is('metadata->>ghl_synced', null);

    if (error) {
      logger.error('Failed to fetch outreach events:', error);
      process.exit(1);
    }

    logger.info(`Found ${events?.length || 0} new replied events to sync`);

    for (const event of events || []) {
      await syncReplyToGHL(supabase, event);
    }

    logger.info('Reply-to-GHL sync cron completed');
    if (SELF_CHECK) process.exit(0);
  } catch (err) {
    logger.error('Reply-to-GHL sync cron failed:', err);
    process.exit(1);
  }
}

run().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
