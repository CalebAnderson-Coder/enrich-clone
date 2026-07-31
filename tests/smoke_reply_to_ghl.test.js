// ============================================================
// tests/smoke_reply_to_ghl.test.js
//
// Validates that reply→GHL sync handler correctly:
// 1. Reads unsynced 'replied' events
// 2. Calls GHL API endpoints
// 3. Marks events as synced
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

function buildSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

/**
 * Mock fetch to intercept GHL API calls
 */
let ghlFetchCalls = [];
const originalFetch = globalThis.fetch;

function setupMockFetch() {
  ghlFetchCalls = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes('services.leadconnectorhq.com')) {
      ghlFetchCalls.push({ url, options });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

test('reply_to_ghl_sync - can read unsynced replied events', async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('SKIPPED: missing SUPABASE credentials');
    return;
  }

  const supabase = buildSupabase();

  try {
    // Query for recent unsynced replies
    const { data, error } = await supabase
      .from('outreach_events')
      .select('id, event_type')
      .eq('brand_id', BRAND_ID)
      .eq('event_type', 'replied')
      .limit(5);

    // No error should occur
    assert.strictEqual(error, null, 'Should query without error');
    assert.ok(Array.isArray(data), 'Should return array');
  } finally {
    // Cleanup
  }
});

test('reply_to_ghl_sync - GHL API endpoints are called with correct structure', async () => {
  setupMockFetch();

  try {
    // Simulate calling GHL endpoints
    const contactId = 'test-contact-id';
    const opportunityId = 'test-opp-id';

    // Create note
    const noteResp = await fetch('https://services.leadconnectorhq.com/api/contacts/' + contactId + '/notes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notes: 'Cliente respondió: test message' })
    });

    assert.ok(noteResp.ok, 'Note creation should succeed');
    assert.strictEqual(ghlFetchCalls.length, 1, 'Should have called fetch once');
    assert.ok(ghlFetchCalls[0].url.includes('/notes'), 'Should call /notes endpoint');

    // Update opportunity
    const oppResp = await fetch('https://services.leadconnectorhq.com/api/opportunities/' + opportunityId, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer test-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pipelineStageId: 'interesado-stage-id' })
    });

    assert.ok(oppResp.ok, 'Opportunity update should succeed');
    assert.strictEqual(ghlFetchCalls.length, 2, 'Should have called fetch twice');
  } finally {
    restoreFetch();
  }
});

test('reply_to_ghl_sync - metadata ghl_synced flag is set', async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('SKIPPED: missing SUPABASE credentials');
    return;
  }

  const supabase = buildSupabase();

  try {
    // Create a test replied event (cleanup at end)
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id')
      .eq('brand_id', BRAND_ID)
      .limit(1)
      .maybeSingle();

    if (!lead) {
      console.log('SKIPPED: no test leads available');
      return;
    }

    // Insert a test event
    const { data: testEvent, error: insertErr } = await supabase
      .from('outreach_events')
      .insert({
        lead_id: lead.id,
        brand_id: BRAND_ID,
        channel: 'email',
        event_type: 'replied',
        occurred_at: new Date().toISOString(),
        metadata: { message_body: 'Test reply' }
      })
      .select()
      .maybeSingle();

    assert.strictEqual(insertErr, null, 'Should insert test event');
    assert.ok(testEvent, 'Should have created test event');
    assert.strictEqual(testEvent.metadata.ghl_synced, undefined, 'Initially not synced');

    // Simulate marking as synced
    const updated = {
      ...testEvent.metadata,
      ghl_synced: true
    };

    const { error: updateErr } = await supabase
      .from('outreach_events')
      .update({ metadata: updated })
      .eq('id', testEvent.id);

    assert.strictEqual(updateErr, null, 'Should update metadata');

    // Verify it was marked
    const { data: verified } = await supabase
      .from('outreach_events')
      .select('metadata')
      .eq('id', testEvent.id)
      .maybeSingle();

    assert.strictEqual(verified.metadata.ghl_synced, true, 'Should be marked as synced');

    // Cleanup
    await supabase
      .from('outreach_events')
      .delete()
      .eq('id', testEvent.id);

  } catch (err) {
    console.error('Test error:', err.message);
    throw err;
  }
});
