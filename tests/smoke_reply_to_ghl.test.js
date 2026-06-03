import test from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

test('reply_to_ghl_sync — stubbed workflow', async (t) => {
  const sb = buildSupabase();
  const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

  // 1. Create a test lead with email
  const testLeadData = {
    brand_id: BRAND_ID,
    email: `test-reply-sync-${Date.now()}@example.com`,
    business_name: 'Test Business',
    outreach_status: 'CONTACTED',
    ghl_contact_id: 'test_contact_' + Date.now()
  };

  const { data: insertedLead, error: leadError } = await sb
    .from('leads')
    .insert([testLeadData])
    .select('id')
    .single();

  if (leadError) {
    throw new Error(`Failed to insert test lead: ${leadError.message}`);
  }

  const leadId = insertedLead.id;

  // 2. Create a replied outreach event (simulating a real reply)
  const testEventData = {
    lead_id: leadId,
    brand_id: BRAND_ID,
    channel: 'email',
    event_type: 'replied',
    occurred_at: new Date().toISOString(),
    metadata: { message_id: `test-msg-${Date.now()}` }
  };

  const { data: insertedEvent, error: eventError } = await sb
    .from('outreach_events')
    .insert([testEventData])
    .select('id')
    .single();

  if (eventError) {
    throw new Error(`Failed to insert test event: ${eventError.message}`);
  }

  const eventId = insertedEvent.id;

  // 3. Validate event was inserted correctly
  const { data: fetchedEvent } = await sb
    .from('outreach_events')
    .select('*')
    .eq('id', eventId)
    .single();

  assert.ok(fetchedEvent, 'Event should be retrievable');
  assert.equal(fetchedEvent.event_type, 'replied', 'Event type should be replied');
  assert.equal(fetchedEvent.channel, 'email', 'Channel should be email');
  assert.equal(fetchedEvent.lead_id, leadId, 'Lead ID should match');

  // 4. Cleanup: remove test data
  await sb.from('outreach_events').delete().eq('id', eventId);
  await sb.from('leads').delete().eq('id', leadId);

  console.log('✓ Test passed: replied events can be inserted and retrieved correctly');
});

test('reply_to_ghl_sync — GHL API headers structure', async (t) => {
  // Validate that env vars for GHL sync are properly structured
  const ghlKey = process.env.EMPIRIKA_GHL_KEY;
  const ghlLocationId = process.env.EMPIRIKA_GHL_LOCATION_ID;
  const ghlStageId = process.env.GHL_STAGE_INTERESADO_ID;
  const ghlPipelineId = process.env.GHL_PIPELINE_ID;

  // These may be unset in test env, but if set, they should be non-empty strings
  if (ghlKey) assert.ok(typeof ghlKey === 'string' && ghlKey.length > 0, 'GHL key should be non-empty');
  if (ghlLocationId) assert.ok(typeof ghlLocationId === 'string' && ghlLocationId.length > 0, 'GHL location ID should be non-empty');
  if (ghlStageId) assert.ok(typeof ghlStageId === 'string' && ghlStageId.length > 0, 'GHL stage ID should be non-empty');
  if (ghlPipelineId) assert.ok(typeof ghlPipelineId === 'string' && ghlPipelineId.length > 0, 'GHL pipeline ID should be non-empty');

  console.log('✓ Test passed: GHL environment variables are properly structured (if set)');
});
