import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/resilience.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const GHL_STAGE_INTERESADO_ID = process.env.GHL_STAGE_INTERESADO_ID;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const GHL_API_KEY = process.env.GHL_API_KEY;

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

export async function syncRepliesToGHL() {
  if (!supabase) {
    logger.error('Supabase not configured');
    return { processed: 0, synced: 0, errors: 0 };
  }

  if (!GHL_STAGE_INTERESADO_ID || !GHL_PIPELINE_ID) {
    logger.warn('GHL_STAGE_INTERESADO_ID or GHL_PIPELINE_ID missing');
    return { processed: 0, synced: 0, errors: 0 };
  }

  const stats = { processed: 0, synced: 0, errors: 0 };

  try {
    const { data: events, error } = await supabase
      .from('outreach_events')
      .select('id, lead_id, brand_id, metadata, occurred_at')
      .eq('event_type', 'replied')
      .eq('brand_id', BRAND_ID)
      .not('metadata', 'is', null)
      .gte('occurred_at', new Date(Date.now() - 24 * 3600000).toISOString())
      .is('metadata->ghl_synced', null)
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (error) {
      logger.error('Failed to fetch replied events', { error: error.message });
      return { processed: 0, synced: 0, errors: 1 };
    }

    if (!events || events.length === 0) {
      logger.info('No new replied events to sync');
      return stats;
    }

    logger.info('Found replied events to sync', { count: events.length });

    for (const event of events) {
      stats.processed++;

      const leadId = event.lead_id;
      if (!leadId) {
        logger.warn('Replied event has no lead_id', { eventId: event.id });
        stats.errors++;
        continue;
      }

      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, business_name, ghl_contact_id, ghl_opportunity_id')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        logger.warn('Lead not found', { leadId, error: leadError?.message });
        stats.errors++;
        continue;
      }

      const ghlContactId = lead.ghl_contact_id;
      const ghlOpportunityId = lead.ghl_opportunity_id;

      if (!ghlContactId) {
        logger.warn('Lead has no GHL contact ID', { leadId, business: lead.business_name });
        await markEventSynced(event.id, { error: 'no_ghl_contact' });
        continue;
      }

      const messagePreview = event.metadata?.message_preview || event.metadata?.body || '(sin preview)';

      try {
        await syncReplyToGHL({
          contactId: ghlContactId,
          opportunityId: ghlOpportunityId,
          messagePreview,
          businessName: lead.business_name,
        });

        await markEventSynced(event.id, { synced_at: new Date().toISOString() });
        stats.synced++;

        logger.info('Synced reply to GHL', { leadId, contactId: ghlContactId });
      } catch (err) {
        logger.warn('Failed to sync reply to GHL', {
          leadId,
          contactId: ghlContactId,
          error: err.message,
        });
        await markEventSynced(event.id, { error: err.message });
        stats.errors++;
      }
    }
  } catch (err) {
    logger.error('syncRepliesToGHL threw', { error: err.message });
    return { processed: 0, synced: 0, errors: 1 };
  }

  logger.info('Reply sync summary', stats);
  return stats;
}

async function syncReplyToGHL({
  contactId,
  opportunityId,
  messagePreview,
  businessName,
}) {
  if (!GHL_API_KEY) {
    throw new Error('GHL_API_KEY not configured');
  }

  const noteBody = `Lead respondió a nuestro email.\n\nPreview: ${messagePreview}\n\nRespuesta detectada por sistema de monitoreo automático.`;

  const createNotePromise = withRetry(
    () =>
      fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: noteBody,
        }),
      }),
    { maxRetries: 1, baseDelayMs: 30000, label: `GHL-note-${contactId}` }
  );

  const updateOppPromise = opportunityId
    ? withRetry(
      () =>
        fetch(`https://services.leadconnectorhq.com/opportunities/${opportunityId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pipelineStageId: GHL_STAGE_INTERESADO_ID,
          }),
        }),
      { maxRetries: 1, baseDelayMs: 30000, label: `GHL-opp-${opportunityId}` }
    )
    : Promise.resolve(null);

  const [noteRes, oppRes] = await Promise.all([createNotePromise, updateOppPromise]);

  if (!noteRes.ok) {
    const errData = await noteRes.text();
    throw new Error(`GHL note POST ${noteRes.status}: ${errData}`);
  }

  if (oppRes && !oppRes.ok) {
    const errData = await oppRes.text();
    throw new Error(`GHL opportunity PUT ${oppRes.status}: ${errData}`);
  }

  logger.info('GHL sync success', {
    contactId,
    opportunityId,
    business: businessName,
  });
}

async function markEventSynced(eventId, metadata) {
  const { error } = await supabase
    .from('outreach_events')
    .update({ metadata: { ghl_synced: true, ...metadata } })
    .eq('id', eventId);

  if (error) {
    logger.warn('Failed to mark event synced', { eventId, error: error.message });
  }
}

if (process.argv[1]?.includes('reply_sync_ghl')) {
  (async () => {
    const result = await syncRepliesToGHL();
    process.exit(result.errors > 0 ? 1 : 0);
  })().catch(err => {
    logger.error('Fatal error', { error: err.message });
    process.exit(1);
  });
}

export default syncRepliesToGHL;
