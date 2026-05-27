import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'PbSBohJh1m1L08INwMzv';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const SELF_CHECK = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function addNoteToGHL(contactId, noteText) {
  if (!GHL_TOKEN) {
    logger.warn('reply_to_ghl_sync: GHL_PRIVATE_TOKEN not set — skipping note');
    return { success: false, reason: 'no_token' };
  }

  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: noteText,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn('reply_to_ghl_sync: GHL note API failed', {
        contactId,
        status: res.status,
        response: text.substring(0, 200),
      });
      return { success: false, status: res.status };
    }

    const data = await res.json();
    return { success: true, noteId: data.id };
  } catch (err) {
    logger.error('reply_to_ghl_sync: GHL note API error', {
      contactId,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

async function moveToStageGHL(opportunityId, stageId) {
  if (!GHL_TOKEN || !stageId) {
    logger.warn('reply_to_ghl_sync: GHL_TOKEN or stage_id not set — skipping stage move');
    return { success: false, reason: 'missing_config' };
  }

  try {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipelineStageId: stageId,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn('reply_to_ghl_sync: GHL opportunity API failed', {
        opportunityId,
        status: res.status,
        response: text.substring(0, 200),
      });
      return { success: false, status: res.status };
    }

    const data = await res.json();
    return { success: true };
  } catch (err) {
    logger.error('reply_to_ghl_sync: GHL opportunity API error', {
      opportunityId,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

async function processOneEvent(supabase, event) {
  const leadId = event.lead_id;
  if (!leadId) {
    return { action: 'skip', reason: 'no_lead_id' };
  }

  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('ghl_contact_id, ghl_opportunity_id')
      .eq('id', leadId)
      .single();

    if (leadError || !lead || !lead.ghl_contact_id) {
      return { action: 'skip', reason: 'no_ghl_contact' };
    }

    const metadata = event.metadata || {};
    const replyBody = metadata.body || '';
    const preview = replyBody.substring(0, 200);
    const noteText = `Lead respondió: "${preview}"${preview.length < replyBody.length ? '...' : ''}`;

    let noteResult = { success: false };
    let moveResult = { success: false };

    noteResult = await addNoteToGHL(lead.ghl_contact_id, noteText);

    if (noteResult.success && lead.ghl_opportunity_id && GHL_STAGE_INTERESADO_ID) {
      moveResult = await moveToStageGHL(lead.ghl_opportunity_id, GHL_STAGE_INTERESADO_ID);
    }

    const updateMetadata = {
      ...metadata,
      ghl_synced: true,
      ghl_note_result: noteResult,
      ghl_move_result: moveResult,
    };

    const { error: updateError } = await supabase
      .from('outreach_events')
      .update({ metadata: updateMetadata })
      .eq('id', event.id);

    if (updateError) {
      logger.warn('reply_to_ghl_sync: update error', {
        event_id: event.id,
        error: updateError.message,
      });
    }

    return {
      action: 'synced',
      lead_id: leadId,
      ghl_note: noteResult.success,
      ghl_move: moveResult.success,
    };
  } catch (err) {
    logger.error('reply_to_ghl_sync: process error', {
      event_id: event.id,
      lead_id: leadId,
      error: err.message,
    });
    return {
      action: 'error',
      error: err.message,
    };
  }
}

async function runCycle(supabase) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, occurred_at, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gt('occurred_at', cutoff)
    .order('occurred_at', { ascending: false });

  if (error) {
    logger.error('reply_to_ghl_sync: failed to fetch replied events', { error: error.message });
    return { fetched: 0, processed: 0, synced: 0, skipped: 0 };
  }

  logger.info('reply_to_ghl_sync: fetched events', { count: events?.length ?? 0 });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events || []) {
    if (event.metadata?.ghl_synced) {
      skipped++;
      continue;
    }

    const result = await processOneEvent(supabase, event);

    if (result.action === 'synced') {
      synced++;
    } else if (result.action === 'error') {
      failed++;
    } else {
      skipped++;
    }
  }

  logger.info('reply_to_ghl_sync: cycle done', {
    fetched: events?.length ?? 0,
    synced,
    skipped,
    failed,
  });

  return {
    fetched: events?.length ?? 0,
    synced,
    skipped,
    failed,
  };
}

async function main() {
  logger.info('reply_to_ghl_sync worker starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  if (!GHL_TOKEN) {
    logger.warn('reply_to_ghl_sync: GHL_PRIVATE_TOKEN not configured — no syncs will occur');
  }

  if (!GHL_STAGE_INTERESADO_ID) {
    logger.warn('reply_to_ghl_sync: GHL_STAGE_INTERESADO_ID not configured — stage moves will be skipped');
  }

  await runCycle(supabase);

  if (SELF_CHECK) {
    logger.info('reply_to_ghl_sync: self-check OK, exiting');
    process.exit(0);
  }
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('reply_to_ghl_sync fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneEvent };
