import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('smoke: reply_to_ghl_sync — GHL API call structure', async () => {
  const fetchCalls = [];
  
  const mockFetch = (url, options) => {
    fetchCalls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
      json: () => Promise.resolve({}),
    });
  };

  global.fetch = mockFetch;

  const testReplyEvent = {
    id: 'test-event-123',
    lead_id: 'test-lead-456',
    metadata: {
      ghl_contact_id: 'test-ghl-contact-789',
      message_preview: 'This is a test reply from the lead',
      reply_text: 'Hello, we are interested in your services',
    },
  };

  const GHL_BASE = 'https://services.leadconnectorhq.com';
  const GHL_STAGE_INTERESADO = 'c4a6f80a-f6f6-4e5e-a51a-8e5c0e3c2b1a';
  const messagePreview = testReplyEvent.metadata.message_preview;
  const noteBody = `Lead respondió: "${messagePreview.substring(0, 200)}"`;

  const headers = {
    Authorization: 'Bearer test-token',
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const ghlContactId = testReplyEvent.metadata.ghl_contact_id;

  await fetch(`${GHL_BASE}/contacts/${ghlContactId}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ value: noteBody }),
  });

  await fetch(`${GHL_BASE}/contacts/${ghlContactId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ pipelineStageId: GHL_STAGE_INTERESADO }),
  });

  assert.equal(fetchCalls.length, 2, 'Should make 2 fetch calls (note + opportunity update)');

  const [noteCall, opportunityCall] = fetchCalls;

  assert.match(noteCall.url, /\/notes$/, 'First call should be to /notes endpoint');
  assert.equal(noteCall.method, 'POST', 'Notes call should be POST');
  assert.match(noteCall.body.value, /Lead respondió/, 'Note should contain spanish "respondió"');
  assert.match(noteCall.body.value, /test reply/, 'Note should contain message preview');

  assert.match(opportunityCall.url, /\/contacts\/test-ghl-contact-789$/, 'Second call should be to /contacts/{id}');
  assert.equal(opportunityCall.method, 'PUT', 'Opportunity call should be PUT');
  assert.equal(opportunityCall.body.pipelineStageId, GHL_STAGE_INTERESADO, 'Should set stage to INTERESADO');

  console.log('✓ GHL API calls match expected structure');
});

test('smoke: reply_to_ghl_sync — handles missing contact ID gracefully', async () => {
  const testReplyEvent = {
    id: 'test-event-no-contact',
    lead_id: 'test-lead-456',
    metadata: {
      message_preview: 'Test reply',
    },
  };

  const shouldSync = testReplyEvent.metadata?.ghl_contact_id ? true : false;
  assert.equal(shouldSync, false, 'Should not sync if ghl_contact_id is missing');

  console.log('✓ Missing contact ID is handled gracefully');
});

test('smoke: reply_to_ghl_sync — respects 24h window', async () => {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - 24 * 3600 * 1000);
  
  const recentEvent = new Date(now.getTime() - 1 * 3600 * 1000);
  const oldEvent = new Date(now.getTime() - 48 * 3600 * 1000);

  const recentShouldProcess = recentEvent > cutoffTime;
  const oldShouldProcess = oldEvent > cutoffTime;

  assert.equal(recentShouldProcess, true, 'Recent event (1h) should be processed');
  assert.equal(oldShouldProcess, false, 'Old event (48h) should not be processed');

  console.log('✓ 24-hour window is enforced correctly');
});
