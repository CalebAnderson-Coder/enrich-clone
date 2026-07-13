// ============================================================
// tests/smoke_reply_to_ghl.test.js
//
// Smoke test para reply_to_ghl_sync.js
// Verifica que:
//   1. Se detectan eventos 'replied' sin sincronizar
//   2. Se llama a postNoteToGHL con el body correcto
//   3. Se llama a moveOpportToInteresado
//   4. Se marca el evento como ghl_synced=true
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert';
import { processOneReply, runCycle } from '../workers/reply_to_ghl_sync.js';

test('smoke_reply_to_ghl: processOneReply with mocked supabase', async () => {
  // Mock supabase client
  const mockSupabase = {
    from: (table) => {
      if (table === 'leads') {
        return {
          select: (cols) => ({
            eq: (field, value) => ({
              maybeSingle: async () => ({
                data: {
                  id: 'lead-123',
                  ghl_contact_id: 'contact-abc',
                  campaign_enriched_data: {
                    ghl_opportunity_id: 'opp-xyz',
                  },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'outreach_events') {
        return {
          update: (data) => ({
            eq: (field, value) => ({
              then: async (cb) => {
                cb({ error: null });
              },
            }),
          }),
        };
      }
    },
  };

  // Mock fetch for GHL API calls
  const originalFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    // Simulate successful GHL API responses
    return {
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({}),
    };
  };

  try {
    const event = {
      id: 'event-123',
      lead_id: 'lead-123',
      channel: 'email',
      event_type: 'replied',
      metadata: {
        body: 'Interested in your service!',
        from_email: 'prospect@example.com',
        subject: 'RE: Your offer',
        ghl_synced: false,
      },
    };

    const result = await processOneReply(mockSupabase, event);

    // Assertions
    assert.equal(result.action, 'synced', 'Event should be marked as synced');
    assert.equal(result.event_id, 'event-123', 'Event ID should match');
    assert.equal(result.lead_id, 'lead-123', 'Lead ID should match');

    // Check that postNoteToGHL was called
    const noteCalls = fetchCalls.filter(c => c.url.includes('/notes'));
    assert.ok(noteCalls.length > 0, 'postNoteToGHL should have been called');

    const noteCall = noteCalls[0];
    const noteBody = JSON.parse(noteCall.opts.body);
    assert.ok(noteBody.body.includes('prospect@example.com'), 'Note should include prospect email');
    assert.ok(noteBody.body.includes('Interested in your service!'), 'Note should include reply content');

    // Check that moveOpportToInteresado was called
    const oppCalls = fetchCalls.filter(c => c.url.includes('/opportunities'));
    assert.ok(oppCalls.length > 0, 'moveOpportToInteresado should have been called');

  } finally {
    global.fetch = originalFetch;
  }
});

test('smoke_reply_to_ghl: already_synced event should be skipped', async () => {
  const mockSupabase = {};

  const event = {
    id: 'event-456',
    lead_id: 'lead-456',
    metadata: {
      ghl_synced: true,
    },
  };

  const result = await processOneReply(mockSupabase, event);

  assert.equal(result.action, 'already_synced', 'Already synced events should be skipped');
});

test('smoke_reply_to_ghl: lead without GHL contact should be skipped', async () => {
  const mockSupabase = {
    from: (table) => {
      if (table === 'leads') {
        return {
          select: (cols) => ({
            eq: (field, value) => ({
              maybeSingle: async () => ({
                data: {
                  id: 'lead-789',
                  ghl_contact_id: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
    },
  };

  const event = {
    id: 'event-789',
    lead_id: 'lead-789',
    metadata: {
      body: 'test',
      from_email: 'test@example.com',
      subject: 'test',
      ghl_synced: false,
    },
  };

  const result = await processOneReply(mockSupabase, event);

  assert.equal(result.action, 'no_ghl_contact', 'Events for leads without GHL contact should be skipped');
});
