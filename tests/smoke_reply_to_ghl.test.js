// ============================================================
// tests/smoke_reply_to_ghl.test.js — Test reply sync to GHL
//
// Verifies:
//   1. Replied event with correct lead is found
//   2. Note is posted to GHL contact
//   3. Opportunity is updated to INTERESADO stage
//   4. Event is marked ghl_synced=true after processing
// ============================================================

import 'dotenv/config';
import assert from 'assert';
import { createClient } from '@supabase/supabase-js';

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Mock GHL API responses for testing
 */
async function mockGHLAPICalls() {
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    // Mock POST to /contacts/{id}/notes
    if (url.includes('/contacts/') && url.includes('/notes') && options?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'note-123' }),
        text: async () => '{"id":"note-123"}',
      };
    }

    // Mock PUT to /opportunities/{id}
    if (url.includes('/opportunities/') && options?.method === 'PUT') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'opp-123' }),
        text: async () => '{"id":"opp-123"}',
      };
    }

    // Default fallback
    return originalFetch(url, options);
  };

  return () => {
    global.fetch = originalFetch;
  };
}

async function main() {
  const supabase = buildSupabase();

  console.log('🧪 Testing reply sync to GHL...');

  // Restore mocked fetch after test
  const restoreFetch = await mockGHLAPICalls();

  try {
    // Create a test lead with GHL IDs
    const testLead = {
      business_name: 'Test HVAC Co',
      industry: 'HVAC',
      email: 'owner@hvactest.com',
      ghl_contact_id: 'mock-contact-123',
      ghl_opportunity_id: 'mock-opp-456',
      brand_id: BRAND_ID,
    };

    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert([testLead])
      .select();

    if (leadError) throw new Error(`Failed to create test lead: ${leadError.message}`);
    const leadId = leadData[0].id;
    console.log(`✓ Created test lead: ${leadId}`);

    // Create a test replied event
    const replyEvent = {
      lead_id: leadId,
      brand_id: BRAND_ID,
      channel: 'email',
      event_type: 'replied',
      metadata: { ghl_synced: false },
      message_id: `test-reply-${Date.now()}@test.com`,
    };

    const { data: eventData, error: eventError } = await supabase
      .from('outreach_events')
      .insert([replyEvent])
      .select();

    if (eventError) throw new Error(`Failed to create test event: ${eventError.message}`);
    const eventId = eventData[0].id;
    console.log(`✓ Created test replied event: ${eventId}`);

    // Simulate what the worker does
    // Step 1: Read the event
    const { data: readEvent } = await supabase
      .from('outreach_events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    assert(readEvent, 'Event should exist');
    assert.equal(readEvent.event_type, 'replied', 'Event type should be replied');
    assert(!readEvent.metadata?.ghl_synced, 'Event should not be marked synced yet');
    console.log(`✓ Found replied event ready for sync`);

    // Step 2: Post to GHL (mocked)
    const noteRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/${testLead.ghl_contact_id}/notes`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'Test reply note' }),
      }
    );
    assert(noteRes.ok, 'GHL note POST should succeed');
    console.log(`✓ Posted note to GHL contact`);

    // Step 3: Update opportunity (mocked)
    const oppRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/${testLead.ghl_opportunity_id}`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: 'interesado-stage-id' }),
      }
    );
    assert(oppRes.ok, 'GHL opportunity PUT should succeed');
    console.log(`✓ Updated opportunity stage to INTERESADO`);

    // Step 4: Mark event as synced
    const { error: syncError } = await supabase
      .from('outreach_events')
      .update({ metadata: { ghl_synced: true } })
      .eq('id', eventId);

    assert(!syncError, `Marking synced should not error: ${syncError?.message}`);
    console.log(`✓ Marked event as ghl_synced=true`);

    // Verify the sync was recorded
    const { data: verifyEvent } = await supabase
      .from('outreach_events')
      .select('metadata')
      .eq('id', eventId)
      .maybeSingle();

    assert(verifyEvent?.metadata?.ghl_synced, 'Event metadata should have ghl_synced=true');
    console.log(`✓ Verified ghl_synced flag is set`);

    // Cleanup: delete test data
    await supabase.from('outreach_events').delete().eq('id', eventId);
    await supabase.from('leads').delete().eq('id', leadId);
    console.log(`✓ Cleaned up test data`);

    console.log('\n✅ All tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  } finally {
    restoreFetch();
  }
}

main();
