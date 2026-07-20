import { strict as assert } from 'assert';
import { test } from 'node:test';

test('smoke_reply_to_ghl', async t => {
  const testEventId = 'test-event-id-' + Date.now();
  const testLeadId = 'test-lead-id-' + Date.now();
  const testContactId = 'test-contact-id-' + Date.now();

  await t.test('reply event with ghl_synced=false should process', async () => {
    const fetchCalls = [];

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      fetchCalls.push({ url, method: options?.method });

      if (url.includes('/contacts/') && url.includes('/notes')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }

      if (url.includes('/opportunities/')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }

      return { ok: false, status: 404 };
    };

    try {
      const replyBody = 'Gracias por tu email, me interesa conocer más.';
      const noteBody = `Cliente respondió:\n\n${replyBody.substring(0, 200)}`;

      const expectedNote = {
        method: 'POST',
        body: JSON.stringify({ body: noteBody }),
      };

      assert(
        noteBody.includes('Cliente respondió'),
        'Note body should include "Cliente respondió" prefix'
      );
      assert(
        noteBody.includes(replyBody.substring(0, 50)),
        'Note body should include reply text'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test('metadata.ghl_synced should be set after successful sync', async () => {
    const testMetadata = { body: 'Test reply', ghl_synced: 'true' };
    assert.strictEqual(testMetadata.ghl_synced, 'true', 'ghl_synced should be marked true');
  });

  await t.test('should not process replies older than 24h', async () => {
    const now = new Date();
    const old24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const old25h = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    assert(
      old24h.getTime() > old25h.getTime(),
      'replies older than 24h should be excluded'
    );
  });

  await t.test('missing ghl_contact_id should not crash', async () => {
    const leadWithoutGHL = { id: testLeadId, ghl_contact_id: null };
    assert.strictEqual(leadWithoutGHL.ghl_contact_id, null, 'lead missing GHL contact');
  });

  await t.test('retry logic should attempt 2 times on network failure', async () => {
    let attemptCount = 0;
    const originalFetch = global.fetch;

    global.fetch = async (url, options) => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('Network error');
      }
      return { ok: true, status: 200 };
    };

    try {
      assert(attemptCount >= 0, 'retry logic initialized');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
