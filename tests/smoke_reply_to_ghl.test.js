// ============================================================
// tests/smoke_reply_to_ghl.test.js
//
// Test that reply_to_ghl_sync correctly:
//  1. Makes fetch calls to GHL API with correct endpoints
//  2. Handles missing GHL IDs gracefully
// ============================================================

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { processOneReply } from '../workers/reply_to_ghl_sync.js';

describe('reply_to_ghl_sync', () => {
  test('processOneReply makes correct GHL API calls', async () => {
    const callLog = [];

    // Mock fetch
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      callLog.push({ url, method: options.method, body: JSON.parse(options.body || '{}') });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'note-id' }),
      };
    };

    try {
      // Mock Supabase
      const mockSupabase = {
        from: (table) => {
          if (table === 'leads') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'lead-123',
                      ghl_contact_id: 'contact-ghl-123',
                      ghl_opportunity_id: 'opp-ghl-456',
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }

          if (table === 'outreach_events') {
            return {
              update: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          }

          return {};
        },
      };

      const eventRow = {
        id: 'event-123',
        lead_id: 'lead-123',
        metadata: { body: 'Test reply message' },
      };

      const result = await processOneReply(mockSupabase, eventRow);

      // Verify result
      assert.equal(result.action, 'synced', 'Should mark as synced');
      assert.equal(result.event_id, 'event-123');

      // Verify API calls
      assert.ok(callLog.length >= 2, 'Should make at least 2 API calls');

      const notesCall = callLog.find(c => c.url.includes('/notes'));
      const stageCall = callLog.find(c => c.url.includes('/opportunities'));

      assert.ok(notesCall, 'Should POST to /notes');
      assert.ok(stageCall, 'Should PUT to /opportunities');
      assert.ok(notesCall.body.body, 'Note should have body');
      assert.ok(stageCall.body.pipelineStageId, 'Stage call should set pipelineStageId');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('processOneReply handles missing GHL IDs gracefully', async () => {
    const mockSupabase = {
      from: (table) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'lead-456',
                    ghl_contact_id: null,
                    ghl_opportunity_id: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const eventRow = {
      id: 'event-456',
      lead_id: 'lead-456',
      metadata: { body: 'Test' },
    };

    const result = await processOneReply(mockSupabase, eventRow);

    assert.equal(result.action, 'missing_ghl_ids', 'Should skip if GHL IDs missing');
  });

  test('processOneReply handles lead not found', async () => {
    const mockSupabase = {
      from: (table) => {
        if (table === 'leads') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'not found' },
                }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const eventRow = {
      id: 'event-789',
      lead_id: 'lead-nonexistent',
      metadata: { body: 'Test' },
    };

    const result = await processOneReply(mockSupabase, eventRow);

    assert.equal(result.action, 'lead_not_found', 'Should handle missing lead');
  });
});
