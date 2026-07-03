import { test } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { runCycle, syncReply, getPendingReplies } from '../workers/ghl_reply_sync_cron.js';

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

test('ghl_reply_sync_cron', async (t) => {
  const supabase = buildSupabase();
  const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
  const TEST_SUFFIX = `test_${Date.now()}`;

  await t.test('pending replies query returns empty or valid replies', async () => {
    const replies = await getPendingReplies(supabase);
    assert(Array.isArray(replies), 'getPendingReplies should return array');
  });

  await t.test('sync cycle completes without fatal error', async () => {
    const result = await runCycle();
    assert(typeof result === 'object', 'runCycle should return object');
    assert(typeof result.synced === 'number', 'result.synced should be number');
    assert(typeof result.skipped === 'number', 'result.skipped should be number');
    assert(typeof result.errors === 'number', 'result.errors should be number');
  });

  await t.test('test event with missing GHL IDs is skipped', async () => {
    const testLead = {
      business_name: `Test Lead ${TEST_SUFFIX}`,
      email_address: `test_${TEST_SUFFIX}@example.com`,
      brand_id: BRAND_ID,
    };

    const { data: leadData, error: leadErr } = await supabase
      .from('leads')
      .insert([testLead])
      .select('id')
      .single();

    if (leadErr) {
      console.warn('Could not create test lead (DB constraint), skipping event test');
      return;
    }

    const testEvent = {
      lead_id: leadData.id,
      brand_id: BRAND_ID,
      channel: 'email',
      event_type: 'replied',
      metadata: {
        reply_body: 'Test reply from customer',
      },
      occurred_at: new Date().toISOString(),
    };

    const { data: eventData, error: eventErr } = await supabase
      .from('outreach_events')
      .insert([testEvent])
      .select('id, metadata, leads:lead_id(id, ghl_contact_id, ghl_opportunity_id)')
      .single();

    if (eventErr) {
      console.warn('Could not create test event', eventErr.message);
      return;
    }

    const event = {
      id: eventData.id,
      lead_id: eventData.lead_id,
      metadata: eventData.metadata,
      leads: eventData.leads,
    };

    const result = await syncReply(supabase, event);
    assert.strictEqual(result.success, false, 'sync should fail without GHL IDs');
    assert.strictEqual(result.reason, 'missing_ghl_ids', 'reason should be missing_ghl_ids');

    await supabase
      .from('outreach_events')
      .delete()
      .eq('id', eventData.id);

    await supabase
      .from('leads')
      .delete()
      .eq('id', leadData.id);
  });
});
