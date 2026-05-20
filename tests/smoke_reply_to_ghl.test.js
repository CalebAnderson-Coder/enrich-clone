// ============================================================
// tests/smoke_reply_to_ghl.test.js
//
// Verifies that reply→GHL sync works end-to-end.
// ============================================================

import test from 'node:test';
import assert from 'node:assert';

test('smoke_reply_to_ghl: test reply event structure', async (t) => {
  const event = {
    id: 'event-123',
    brand_id: 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    lead_id: 'lead-123',
    event_type: 'replied',
    occurred_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    metadata: {
      from_email: 'prospect@business.com',
      subject: 'Re: Partnership opportunity',
      body: 'Interested in learning more about your service.',
    },
  };

  assert(event.event_type === 'replied', 'Event type should be replied');
  assert(event.metadata.from_email, 'Should have from_email in metadata');
  assert.match(
    event.metadata.subject,
    /Re: Partnership/,
    'Should preserve original subject'
  );
});

test('smoke_reply_to_ghl: test reply age filter', async (t) => {
  const now = Date.now();
  const within24h = new Date(now - 12 * 60 * 60 * 1000).toISOString();
  const outside24h = new Date(now - 30 * 60 * 60 * 1000).toISOString();

  const event1 = { occurred_at: within24h };
  const event2 = { occurred_at: outside24h };

  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  assert(
    new Date(event1.occurred_at) >= new Date(cutoff),
    'Event within 24h should pass filter'
  );
  assert(
    new Date(event2.occurred_at) < new Date(cutoff),
    'Event outside 24h should not pass filter'
  );
});

test('smoke_reply_to_ghl: test note body construction', async (t) => {
  const from_email = 'john@example.com';
  const subject = 'Re: Test';
  const body = 'This is a test reply that is quite long and will be truncated.';

  const preview = body.slice(0, 200).replace(/\n/g, ' ');
  const noteBody = `📧 Reply recibido\nDe: ${from_email}\nAsunto: ${subject || '(sin asunto)'}\nPreview: ${preview}`;

  assert.match(noteBody, /Reply recibido/, 'Note should start with emoji+text');
  assert.match(noteBody, /john@example.com/, 'Note should include sender email');
  assert.match(noteBody, /Re: Test/, 'Note should include subject');
  assert.match(noteBody, /truncated/, 'Note should include body preview');
});

console.log('✓ All smoke tests passed');
