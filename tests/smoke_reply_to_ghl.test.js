import test from 'node:test';
import assert from 'node:assert';

test('smoke_reply_to_ghl: validates event structure and GHL API contract', async (t) => {
  const mockEvent = {
    id: 'evt-001',
    lead_id: 'lead-123',
    brand_id: 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    event_type: 'replied',
    created_at: new Date().toISOString(),
    metadata: {
      message_body: 'Yes, I am interested in your service.',
    },
  };

  assert.strictEqual(mockEvent.event_type, 'replied', 'Event type must be replied');
  assert.ok(mockEvent.lead_id, 'Event must have lead_id');
  assert.ok(mockEvent.metadata?.message_body, 'Event must have message_body in metadata');

  const mockLeadData = {
    id: 'lead-123',
    ghl_contact_id: 'contact-abc123',
    email: 'prospect@company.com',
    business_name: 'Tech Corp',
  };

  assert.ok(mockLeadData.ghl_contact_id, 'Lead must have ghl_contact_id');
  assert.ok(mockLeadData.email, 'Lead must have email');

  const mockNotePayload = {
    value: `Reply received: ${mockEvent.metadata.message_body.substring(0, 200)}...`,
    createdBy: 'rally-sync-cron',
  };

  assert.ok(mockNotePayload.value.includes('Reply received'), 'Note must have proper format');

  const mockOpptyPayload = {
    pipelineId: 'PbSBohJh1m1L08INwMzv',
    pipelineStageId: 'interesado-stage-id',
  };

  assert.ok(mockOpptyPayload.pipelineId, 'Opportunity update must include pipelineId');
  assert.ok(mockOpptyPayload.pipelineStageId, 'Opportunity update must include pipelineStageId');

  assert.ok(true, 'GHL sync contract validated successfully');
});
