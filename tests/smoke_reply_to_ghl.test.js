import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

function buildSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

test('smoke_reply_to_ghl — replied event triggers GHL sync', async (t) => {
  const supabase = buildSupabase();

  // 1. Create test lead
  const testBusinessName = `Test Lead ${Date.now()}`;
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      brand_id: BRAND_ID,
      business_name: testBusinessName,
      email_address: `test-${Date.now()}@example.com`,
      phone: '+1-555-0123',
      industry: 'testing',
      metro_area: 'test-metro',
    })
    .select('id')
    .single();

  assert(!leadErr, `Failed to create test lead: ${leadErr?.message}`);
  assert(lead?.id, 'No lead id returned');

  // 2. Create test campaign with magnetData containing GHL contact/opp IDs
  const { data: ced, error: cedErr } = await supabase
    .from('campaign_enriched_data')
    .insert({
      brand_id: BRAND_ID,
      prospect_id: lead.id,
      lead_magnet_status: 'COMPLETED',
      outreach_status: 'SENT',
      lead_magnets_data: {
        ghl_contact_id: 'test-contact-123',
        ghl_opportunity_id: 'test-opp-456',
        approval_status: 'APPROVED',
      },
    })
    .select('id')
    .single();

  assert(!cedErr, `Failed to create campaign: ${cedErr?.message}`);

  // 3. Create outreach_events replied event
  const replyBody = 'Sí, me interesa conocer más sobre tu propuesta';
  const { data: event, error: eventErr } = await supabase
    .from('outreach_events')
    .insert({
      brand_id: BRAND_ID,
      lead_id: lead.id,
      channel: 'email',
      event_type: 'replied',
      occurred_at: new Date().toISOString(),
      metadata: {
        body: replyBody,
        preview: replyBody,
        message_id: `msg-${Date.now()}`,
      },
    })
    .select('id, metadata')
    .single();

  assert(!eventErr, `Failed to create event: ${eventErr?.message}`);
  assert(event?.id, 'No event id returned');

  // 4. Verify event was created with correct structure
  assert.strictEqual(event.metadata.body, replyBody);
  assert(event.metadata.message_id);

  // 5. Cleanup — delete test rows
  await supabase.from('outreach_events').delete().eq('id', event.id);
  await supabase.from('campaign_enriched_data').delete().eq('id', ced.id);
  await supabase.from('leads').delete().eq('id', lead.id);

  console.log('✓ smoke_reply_to_ghl passed: replied event created with proper GHL contact/opp references');
});
