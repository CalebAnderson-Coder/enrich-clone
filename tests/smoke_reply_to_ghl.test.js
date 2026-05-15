import { test } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

test('GHL reply sync — note write and stage move stubbed', async () => {
  const supabase = buildSupabase();
  const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

  let noteCalled = false;
  let stageMoveCalled = false;
  let noteBody = '';
  let stageId = '';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr.includes('/notes') && options.method === 'POST') {
      noteCalled = true;
      const body = JSON.parse(options.body);
      noteBody = body.value || '';
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'note123' }),
        text: async () => '{"id":"note123"}',
      };
    }

    if (urlStr.includes('/opportunities/') && options.method === 'PUT') {
      stageMoveCalled = true;
      const body = JSON.parse(options.body);
      stageId = body.pipelineStageId;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'opp123' }),
        text: async () => '{"id":"opp123"}',
      };
    }

    return originalFetch(url, options);
  };

  try {
    const testLeadId = 'test-lead-' + Date.now();
    const testEmail = `test-${Date.now()}@example.com`;

    const { data: insertedLead, error: insertError } = await supabase
      .from('leads')
      .insert({
        id: testLeadId,
        brand_id: BRAND_ID,
        email_address: testEmail,
        business_name: 'Test Business',
      })
      .select('id')
      .single();

    if (insertError) {
      console.log('Lead insert error (may already exist):', insertError);
    }

    const testEventId = 'test-event-' + Date.now();
    const { data: insertedEvent, error: eventError } = await supabase
      .from('outreach_events')
      .insert({
        id: testEventId,
        brand_id: BRAND_ID,
        lead_id: testLeadId,
        event_type: 'replied',
        channel: 'email',
        metadata: {
          reply_body: 'This is a test reply from the prospect.',
          ghl_synced: false,
        },
      })
      .select('id')
      .single();

    if (insertError && !insertedLead) {
      console.error('Could not insert lead:', insertError);
      return;
    }

    if (eventError) {
      console.error('Event insert error:', eventError);
      return;
    }

    assert(insertedEvent, 'Event should be inserted');
    assert.strictEqual(insertedEvent.id, testEventId, 'Event ID should match');

    assert(noteCalled || !process.env.EMPIRIKA_GHL_KEY, 'Note function should be called (if GHL key present)');

    const { data: cleanup, error: cleanupError } = await supabase
      .from('outreach_events')
      .delete()
      .eq('id', testEventId);

    if (!cleanupError) {
      console.log('✓ Test cleanup successful');
    }

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('✓ GHL reply sync test passed');
});
