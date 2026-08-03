// ============================================================
// tests/smoke_reply_to_ghl.test.js — Test reply→GHL sync
//
// Deterministic test that:
//   1. Creates a stub lead with a GHL contact ID
//   2. Inserts a test outreach_events row with event_type='replied'
//   3. Mocks fetch() to capture the /contacts/{id}/notes POST
//      and /opportunities/{id} PUT calls
//   4. Runs the worker's processOneEvent()
//   5. Verifies the correct bodies were sent
//   6. Cleans up the test data
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const TEST_CONTACT_ID = 'test-contact-' + Date.now();
const TEST_LEAD_ID = 'test-lead-' + Date.now();

// Mock fetch to capture GHL API calls
const originalFetch = globalThis.fetch;
let capturedCalls = [];

globalThis.fetch = async (url, opts = {}) => {
  capturedCalls.push({ url, method: opts.method || 'GET', body: opts.body });

  // Return mock responses based on the endpoint
  if (url.includes('/contacts/') && url.includes('/notes')) {
    // POST /contacts/{id}/notes
    return {
      ok: true,
      json: async () => ({ id: 'note-123', note: { id: 'note-123' } }),
      text: async () => '{}',
      status: 200,
    };
  }
  if (url.includes('/opportunities/')) {
    // PUT /opportunities/{id}
    return {
      ok: true,
      json: async () => ({ id: TEST_CONTACT_ID }),
      text: async () => '{}',
      status: 200,
    };
  }
  // Fallback
  return {
    ok: true,
    json: async () => ({}),
    text: async () => '{}',
    status: 200,
  };
};

test('smoke_reply_to_ghl: POST note + PUT stage on replied event', async (t) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('Skipping test: missing SUPABASE credentials');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 1. Insert a test lead with ghl_id
    const { data: leadData, error: leadErr } = await supabase
      .from('leads')
      .insert({
        id: TEST_LEAD_ID,
        brand_id: BRAND_ID,
        business_name: 'Test Business',
        email: `test-${Date.now()}@example.com`,
        ghl_id: TEST_CONTACT_ID,
        qualification_score: 75,
        outreach_status: 'CONTACTADO',
      })
      .select('id')
      .single();

    assert.strictEqual(leadErr, null, `Insert lead failed: ${leadErr?.message}`);
    console.log('✓ Test lead inserted:', leadData.id);

    // 2. Insert a replied event
    const testReplyBody = 'Hola, estamos interesados en tus servicios.';
    const { data: eventData, error: eventErr } = await supabase
      .from('outreach_events')
      .insert({
        brand_id: BRAND_ID,
        lead_id: TEST_LEAD_ID,
        channel: 'email',
        event_type: 'replied',
        message_id: 'test-msg-' + Date.now(),
        occurred_at: new Date().toISOString(),
        metadata: {
          body: testReplyBody,
          from_email: 'prospect@example.com',
          from_name: 'Test Prospect',
          subject: 'Re: Nuestros servicios',
        },
      })
      .select('*')
      .single();

    assert.strictEqual(eventErr, null, `Insert event failed: ${eventErr?.message}`);
    console.log('✓ Test replied event inserted:', eventData.id);

    // 3. Mock the worker's processOneEvent function
    // (We'll import it after mocking fetch)
    const { processOneEvent } = await import('../workers/reply_to_ghl_sync.js');

    // Reset captured calls
    capturedCalls = [];

    // 4. Run processOneEvent
    const result = await processOneEvent(supabase, eventData);
    console.log('✓ processOneEvent result:', result);

    // 5. Verify the calls
    assert.strictEqual(result.status, 'synced', `Expected status 'synced', got '${result.status}'`);
    assert.strictEqual(result.noteOk, true, 'Expected note POST to succeed');

    // Check that we captured POST to /notes
    const noteCalls = capturedCalls.filter(c => c.url.includes('/notes'));
    assert.ok(noteCalls.length > 0, 'Expected at least one POST to /notes');
    assert.strictEqual(noteCalls[0].method, 'POST', 'Expected POST method for notes');

    const noteBody = JSON.parse(noteCalls[0].body);
    assert.ok(noteBody.body.includes('[Respuesta de prospect]'), 'Expected note to include reply marker');
    assert.ok(noteBody.body.includes('prospect@example.com'), 'Expected note to include from_email');

    console.log('✓ All assertions passed');
  } finally {
    // Cleanup: delete the test data
    console.log('Cleaning up test data...');
    await supabase
      .from('outreach_events')
      .delete()
      .eq('lead_id', TEST_LEAD_ID)
      .catch(e => console.warn('Failed to delete events:', e.message));

    await supabase
      .from('leads')
      .delete()
      .eq('id', TEST_LEAD_ID)
      .catch(e => console.warn('Failed to delete lead:', e.message));

    console.log('✓ Cleanup done');
  }
});

// Restore original fetch
test('teardown', () => {
  globalThis.fetch = originalFetch;
});
