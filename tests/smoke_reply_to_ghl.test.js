import assert from 'assert';
import { syncReplyToGHL, runCycle } from '../workers/reply_ghl_sync_cron.js';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function test() {
  const supabase = buildSupabase();

  console.log('✓ Testing reply_to_ghl flow...');

  const testLeadId = '550e8400-e29b-41d4-a716-446655440001';
  const testEventId = '550e8400-e29b-41d4-a716-446655440002';

  const { data: insertedEvent, error: insertError } = await supabase
    .from('outreach_events')
    .insert({
      id: testEventId,
      brand_id: BRAND_ID,
      lead_id: testLeadId,
      channel: 'email',
      event_type: 'replied',
      message_id: `test-msg-${Date.now()}@empirika.test`,
      occurred_at: new Date().toISOString(),
      metadata: {
        ghl_contact_id: 'test-contact-123',
        ghl_opportunity_id: 'test-opp-123',
        subject: 'Test Reply',
        body: 'This is a test reply',
        from_email: 'prospect@example.com',
      },
    })
    .select();

  if (insertError && !insertError.message.includes('duplicate')) {
    console.error('❌ Failed to insert test event:', insertError);
    process.exit(1);
  }

  console.log('✓ Test event inserted');

  const testEvent = {
    id: testEventId,
    lead_id: testLeadId,
    metadata: {
      ghl_contact_id: 'test-contact-123',
      ghl_opportunity_id: 'test-opp-123',
      subject: 'Test Reply',
      body: 'This is a test reply',
    },
  };

  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    callCount++;
    console.log(`  → fetch() call #${callCount}: ${options?.method || 'GET'} ${url}`);

    if (url.includes('/contacts/test-contact-123/notes')) {
      assert(options.method === 'POST', 'Expected POST for notes endpoint');
      assert(options.headers['Authorization']?.includes('Bearer'), 'Expected Authorization header');
      const body = JSON.parse(options.body);
      assert(body.body, 'Expected body field in request');
      console.log('    ✓ Notes POST call is correct');
      return new Response(JSON.stringify({ id: 'note-123' }), { status: 201 });
    }

    if (url.includes('/opportunities/test-opp-123')) {
      assert(options.method === 'PUT', 'Expected PUT for opportunities endpoint');
      const body = JSON.parse(options.body);
      assert(body.pipelineStageId, 'Expected pipelineStageId in request');
      console.log('    ✓ Opportunity PUT call is correct');
      return new Response(JSON.stringify({ id: 'opp-123' }), { status: 200 });
    }

    return originalFetch(url, options);
  };

  const result = await syncReplyToGHL(supabase, testEvent);
  globalThis.fetch = originalFetch;

  assert(callCount >= 2, `Expected at least 2 fetch calls, got ${callCount}`);
  assert(result.action === 'synced', `Expected 'synced' action, got '${result.action}'`);

  console.log('✓ syncReplyToGHL verified: calls made correctly');

  const { data: updatedEvent, error: fetchError } = await supabase
    .from('outreach_events')
    .select('metadata')
    .eq('id', testEventId)
    .single();

  if (!fetchError && updatedEvent) {
    assert(updatedEvent.metadata.ghl_synced === true, 'Expected ghl_synced to be true');
    assert(updatedEvent.metadata.ghl_synced_at, 'Expected ghl_synced_at to be set');
    console.log('✓ Event metadata marked as synced');
  }

  const { error: deleteError } = await supabase
    .from('outreach_events')
    .delete()
    .eq('id', testEventId);

  if (deleteError && !deleteError.message.includes('not found')) {
    console.error('❌ Failed to cleanup test event:', deleteError);
  } else {
    console.log('✓ Test event cleaned up');
  }

  console.log('\n✅ All tests passed!');
  process.exit(0);
}

test().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
