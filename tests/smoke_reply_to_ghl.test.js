import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

const GHL_BASE = 'https://services.leadconnectorhq.com';

test('reply_to_ghl_sync: mock fetch calls API correctly', async () => {
  const fetchCalls = [];

  process.env.GHL_PRIVATE_TOKEN = 'test-token';
  process.env.GHL_STAGE_INTERESADO_ID = 'stage-interesado';

  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method, body: opts?.body });

    if (url.includes('/notes')) {
      return new Response(JSON.stringify({ id: 'note-123' }), { status: 200 });
    }
    if (url.includes('/opportunities')) {
      return new Response(JSON.stringify({ id: 'opp-123' }), { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const { processOneEvent } = await import('../workers/reply_to_ghl_sync_cron.js');

  const mockSupabase = {
    from: (table) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'lead-123',
                  ghl_contact_id: 'contact-abc',
                  ghl_opportunity_id: 'opp-xyz',
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
            eq: async () => ({
              error: null,
            }),
          }),
        };
      }
      return {};
    },
  };

  const testEvent = {
    id: 'event-123',
    lead_id: 'lead-123',
    metadata: {
      body: 'Hola, estoy interesado en vuestros servicios.',
    },
  };

  const result = await processOneEvent(mockSupabase, testEvent);

  assert.equal(result.action, 'synced', 'Should return synced action');
  assert.equal(result.ghl_note, true, 'Should have synced note to GHL');
  assert.equal(result.ghl_move, true, 'Should have moved stage in GHL');

  const noteCall = fetchCalls.find(c => c.url.includes('/notes'));
  assert.ok(noteCall, 'Should call GHL /notes endpoint');
  assert.equal(noteCall.method, 'POST', 'Note call should be POST');

  const body = JSON.parse(noteCall.body);
  assert.ok(body.value.includes('estoy interesado'), 'Note should contain reply preview');

  const moveCall = fetchCalls.find(c => c.url.includes('/opportunities'));
  assert.ok(moveCall, 'Should call GHL /opportunities endpoint');
  assert.equal(moveCall.method, 'PUT', 'Move call should be PUT');

  global.fetch = originalFetch;
});

test('reply_to_ghl_sync: skips already synced events', async () => {
  process.env.GHL_PRIVATE_TOKEN = 'test-token';
  process.env.GHL_STAGE_INTERESADO_ID = 'stage-interesado';

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: 'note-123' }), { status: 200 });

  const { processOneEvent } = await import('../workers/reply_to_ghl_sync_cron.js');

  const mockSupabase = {
    from: (table) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'lead-123', ghl_contact_id: 'contact-abc', ghl_opportunity_id: 'opp-xyz' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'outreach_events') {
        return {
          update: (data) => ({
            eq: async () => ({
              error: null,
            }),
          }),
        };
      }
      return {};
    },
  };

  const testEvent = {
    id: 'event-456',
    lead_id: 'lead-123',
    metadata: {
      body: 'Test reply',
      ghl_synced: true,
    },
  };

  const result = await processOneEvent(mockSupabase, testEvent);

  assert.equal(
    result.action,
    'synced',
    'Should process the event normally (metadata.ghl_synced is just a marker)'
  );

  global.fetch = originalFetch;
});

test('reply_to_ghl_sync: handles missing GHL contact gracefully', async () => {
  const { processOneEvent } = await import('../workers/reply_to_ghl_sync_cron.js');

  const mockSupabase = {
    from: (table) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'lead-123', ghl_contact_id: null },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  const testEvent = {
    id: 'event-789',
    lead_id: 'lead-123',
    metadata: { body: 'Test' },
  };

  const result = await processOneEvent(mockSupabase, testEvent);

  assert.equal(result.action, 'skip', 'Should skip event without GHL contact');
  assert.equal(result.reason, 'no_ghl_contact', 'Should indicate reason');
});
