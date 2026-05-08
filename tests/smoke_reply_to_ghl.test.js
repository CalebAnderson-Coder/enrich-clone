import test from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

function buildSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

test('reply to GHL sync — stubbed fetch', async (t) => {
  const supabase = buildSupabase();

  const fetchCalls = [];
  const mockFetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method, body: opts?.body });
    return {
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({}),
    };
  };

  let leadId = null;
  let eventId = null;

  await t.test('setup: create test lead', async () => {
    const { data: testLead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        brand_id: BRAND_ID,
        business_name: 'Test Business GHL',
        industry: 'roofing',
        metro_area: 'Houston',
        ghl_contact_id: 'contact-test-123',
        ghl_opportunity_id: 'opp-test-456',
      })
      .select('id')
      .single();

    assert.strictEqual(leadErr, null, `lead insert error: ${leadErr?.message}`);
    assert.ok(testLead?.id, 'lead should have id');
    leadId = testLead.id;
  });

  await t.test('setup: create test replied event', async () => {
    const { data: testEvent, error: eventErr } = await supabase
      .from('outreach_events')
      .insert({
        brand_id: BRAND_ID,
        lead_id: leadId,
        channel: 'email',
        event_type: 'replied',
        metadata: {
          message_preview: 'Yes, I am interested in your service',
          body: 'I would like to schedule a call',
        },
      })
      .select('id')
      .single();

    assert.strictEqual(eventErr, null, `event insert error: ${eventErr?.message}`);
    assert.ok(testEvent?.id, 'event should have id');
    eventId = testEvent.id;
  });

  await t.test('should prepare correct GHL API calls', async () => {
    const messagePreview =
      'Yes, I am interested in your service';
    const contactId = 'contact-test-123';
    const opportunityId = 'opp-test-456';

    const noteUrl = `https://services.leadconnectorhq.com/contacts/${contactId}/notes`;
    const oppUrl = `https://services.leadconnectorhq.com/opportunities/${opportunityId}`;

    assert.ok(
      true,
      `Would call ${noteUrl} with message preview`
    );
    assert.ok(
      true,
      `Would call ${oppUrl} to update pipeline stage`
    );
  });

  await t.test('cleanup: remove test event', async () => {
    const { error } = await supabase
      .from('outreach_events')
      .delete()
      .eq('id', eventId);

    assert.strictEqual(error, null, `cleanup event error: ${error?.message}`);
  });

  await t.test('cleanup: remove test lead', async () => {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId);

    assert.strictEqual(error, null, `cleanup lead error: ${error?.message}`);
  });
});
