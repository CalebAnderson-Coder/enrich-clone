import { test } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';
import { processReplyEvent, findContactByLeadId, postNoteToGHL, updateOpportunityStage } from '../workers/reply_to_ghl_sync.js';

const MOCK_LEAD_ID = '00000000-0000-0000-0000-000000000001';
const MOCK_CONTACT_ID = 'contact-123';
const MOCK_OPP_ID = 'opp-456';

test('smoke: reply_to_ghl_sync — mock fetch stubbed', async (t) => {
  const originalFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method || 'GET' });

    if (url.includes('/contacts/') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ id: MOCK_CONTACT_ID }) };
    }
    if (url.includes('/opportunities/') && opts?.method === 'PUT') {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/contacts/?')) {
      return {
        ok: true,
        json: async () => ({
          contacts: [{ id: MOCK_CONTACT_ID, email: 'test@example.com', defaultOpportunityId: MOCK_OPP_ID }],
        }),
      };
    }

    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  try {
    const noteRes = await postNoteToGHL(MOCK_CONTACT_ID, 'Test note');
    assert.strictEqual(noteRes.ok, true, 'postNoteToGHL should succeed with mock fetch');

    const oppRes = await updateOpportunityStage(MOCK_OPP_ID, 'stage-123');
    assert.strictEqual(oppRes.ok, true, 'updateOpportunityStage should succeed with mock fetch');

    assert(fetchCalls.some(c => c.url.includes('/notes') && c.method === 'POST'), 'should call /notes endpoint');
    assert(fetchCalls.some(c => c.url.includes('/opportunities/') && c.method === 'PUT'), 'should call /opportunities endpoint');

    console.log('✓ reply_to_ghl_sync mock test passed');
    console.log(`  Fetch calls made: ${fetchCalls.length}`);
  } finally {
    global.fetch = originalFetch;
  }
});

test('smoke: reply_to_ghl_sync — processReplyEvent flow', async (t) => {
  const originalFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method || 'GET' });
    if (url.includes('/contacts/?')) {
      return {
        ok: true,
        json: async () => ({
          contacts: [{ id: MOCK_CONTACT_ID, email: 'test@example.com', defaultOpportunityId: MOCK_OPP_ID }],
        }),
      };
    }
    if (url.includes('/contacts/') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/opportunities/') && opts?.method === 'PUT') {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  try {
    let updateCalled = false;
    const mockSupabase = {
      from: (table) => ({
        select: (cols) => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'leads') {
                return { data: { email_address: 'test@example.com' }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        update: (data) => {
          updateCalled = true;
          return {
            eq: () => ({
              catch: async (fn) => fn(null),
            }),
          };
        }),
      }),
    };

    const mockEvent = {
      id: 'event-123',
      lead_id: MOCK_LEAD_ID,
      event_type: 'replied',
      occurred_at: new Date().toISOString(),
      metadata: { preview: 'Lead message preview' },
    };

    await processReplyEvent(mockSupabase, mockEvent);

    assert(updateCalled, 'should call supabase.update to mark event as synced');
    assert(fetchCalls.length > 0, 'should make fetch calls to GHL API');

    console.log('✓ processReplyEvent mock test passed');
    console.log(`  Updates: ${updateCalled ? 'yes' : 'no'}`);
  } finally {
    global.fetch = originalFetch;
  }
});
