// ============================================================
// workers/ghl_reply_sync_cron.js — Sync replies to GHL
//
// Cron (each 5 min via Render schedule) that:
//   1. Reads outreach_events with event_type='replied' + NOT synced to GHL
//   2. For each reply: POST note to GHL contact + move to INTERESADO stage
//   3. Marks event with ghl_synced=true metadata
//   4. Handles retries on timeout/4xx (max 1 retry after 30s)
//
// Downstream: José sees leads in INTERESADO pipeline stage in GHL UI
//
// Run modes:
//   node workers/ghl_reply_sync_cron.js            # production cycle
//   node workers/ghl_reply_sync_cron.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SELF_CHECK = process.argv.includes('--self-check');

// GHL API config
const GHL_PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';                   // COLD LEADS
const GHL_STAGE_INTERESADO = process.env.GHL_STAGE_INTERESADO_ID || 'c1d2e758-5235-4469-b0b5-95d4fb06cdc4';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_BASE = 'https://services.leadconnectorhq.com';

// Prevent processing replies older than 24h
const MAX_REPLY_AGE_HOURS = 24;

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function ghlHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ── processOneReply ──────────────────────────────────────────

/**
 * Attempts to sync a single reply to GHL.
 *
 * 1. Create/update note on contact
 * 2. Move opportunity to INTERESADO stage
 * 3. Mark as synced in metadata
 *
 * Returns a result object — never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} event - outreach_events row
 * @returns {Promise<{action: string, [key: string]: any}>}
 */
async function processOneReply(supabase, event) {
  const headers = ghlHeaders();
  if (!headers) {
    logger.warn('ghl_reply_sync_cron: GHL_PRIVATE_TOKEN missing — skipping sync');
    return { action: 'skipped', reason: 'no_ghl_token' };
  }

  // 0. Safety check: skip very old replies (older than 24h)
  const replyAge = Date.now() - new Date(event.occurred_at).getTime();
  const maxAgeMs = MAX_REPLY_AGE_HOURS * 60 * 60 * 1000;
  if (replyAge > maxAgeMs) {
    logger.info('ghl_reply_sync_cron: reply too old, skipping', {
      event_id: event.id,
      age_hours: Math.round(replyAge / (60 * 60 * 1000)),
    });
    return { action: 'skipped', reason: 'reply_too_old' };
  }

  // 1. Fetch lead + GHL contact ID
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, business_name, email_address, ghl_contact_id')
    .eq('id', event.lead_id)
    .single();

  if (leadErr || !lead) {
    logger.warn('ghl_reply_sync_cron: lead not found', {
      lead_id: event.lead_id,
      event_id: event.id,
      err: leadErr?.message,
    });
    return { action: 'skipped', reason: 'lead_not_found' };
  }

  if (!lead.ghl_contact_id) {
    logger.info('ghl_reply_sync_cron: lead has no GHL contact ID', {
      lead_id: event.lead_id,
      event_id: event.id,
    });
    return { action: 'skipped', reason: 'no_ghl_contact_id' };
  }

  // 2. Extract reply message preview
  const replyPreview = (event.metadata?.body || 'Sin vista previa').substring(0, 500);
  const noteBody = `Respuesta del lead:\n\n${replyPreview}`;

  // 3. POST note to GHL (with retry on timeout/4xx)
  let noteCreated = false;
  let createNoteError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const noteRes = await fetch(
        `${GHL_BASE}/contacts/${lead.ghl_contact_id}/notes`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            value: noteBody,
          }),
          timeout: 10_000,
        }
      );

      if (noteRes.ok) {
        noteCreated = true;
        logger.info('ghl_reply_sync_cron: note created', {
          event_id: event.id,
          contact_id: lead.ghl_contact_id,
        });
        break;
      }

      if (noteRes.status >= 500 || noteRes.status === 408) {
        // Retryable error
        if (attempt === 0) {
          logger.warn('ghl_reply_sync_cron: note creation failed (retrying)', {
            event_id: event.id,
            status: noteRes.status,
          });
          await new Promise(r => setTimeout(r, 30_000)); // wait 30s
          continue;
        }
      }

      // Non-retryable or second attempt failed
      createNoteError = `Status ${noteRes.status}`;
      const errText = await noteRes.text().catch(() => '(no body)');
      logger.warn('ghl_reply_sync_cron: note creation failed', {
        event_id: event.id,
        status: noteRes.status,
        body: errText?.substring(0, 200),
      });
      break;
    } catch (err) {
      if (attempt === 0) {
        logger.warn('ghl_reply_sync_cron: note creation error (retrying)', {
          event_id: event.id,
          err: err.message,
        });
        await new Promise(r => setTimeout(r, 30_000)); // wait 30s
        continue;
      }
      createNoteError = err.message;
      logger.error('ghl_reply_sync_cron: note creation error', {
        event_id: event.id,
        err: err.message,
      });
      break;
    }
  }

  // If note failed, still try to move stage — don't fail entirely
  if (!noteCreated && createNoteError) {
    logger.warn('ghl_reply_sync_cron: note creation failed but continuing to move stage', {
      event_id: event.id,
      reason: createNoteError,
    });
  }

  // 4. Move opportunity to INTERESADO stage
  let stageMovedError = null;

  try {
    // Fetch opportunity ID for this contact (in GHL pipeline)
    const oppRes = await fetch(
      `${GHL_BASE}/opportunities?contactId=${lead.ghl_contact_id}&pipelineId=${GHL_PIPELINE_ID}`,
      {
        method: 'GET',
        headers,
        timeout: 10_000,
      }
    );

    if (!oppRes.ok) {
      stageMovedError = `Fetch opp failed: ${oppRes.status}`;
      logger.warn('ghl_reply_sync_cron: opportunity fetch failed', {
        event_id: event.id,
        contact_id: lead.ghl_contact_id,
        status: oppRes.status,
      });
    } else {
      const oppData = await oppRes.json();
      const opportunities = oppData.opportunities || [];

      if (opportunities.length === 0) {
        logger.info('ghl_reply_sync_cron: no opportunity found for contact (will not create)', {
          event_id: event.id,
          contact_id: lead.ghl_contact_id,
        });
      } else {
        const opp = opportunities[0];

        // Try to move to INTERESADO (with retry)
        let stageMoved = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const moveRes = await fetch(
              `${GHL_BASE}/opportunities/${opp.id}`,
              {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  pipelineStageId: GHL_STAGE_INTERESADO,
                }),
                timeout: 10_000,
              }
            );

            if (moveRes.ok) {
              stageMoved = true;
              logger.info('ghl_reply_sync_cron: moved to INTERESADO stage', {
                event_id: event.id,
                opp_id: opp.id,
              });
              break;
            }

            if (moveRes.status >= 500 || moveRes.status === 408) {
              if (attempt === 0) {
                logger.warn('ghl_reply_sync_cron: stage move failed (retrying)', {
                  event_id: event.id,
                  status: moveRes.status,
                });
                await new Promise(r => setTimeout(r, 30_000));
                continue;
              }
            }

            stageMovedError = `Status ${moveRes.status}`;
            const errText = await moveRes.text().catch(() => '(no body)');
            logger.warn('ghl_reply_sync_cron: stage move failed', {
              event_id: event.id,
              status: moveRes.status,
              body: errText?.substring(0, 200),
            });
            break;
          } catch (err) {
            if (attempt === 0) {
              logger.warn('ghl_reply_sync_cron: stage move error (retrying)', {
                event_id: event.id,
                err: err.message,
              });
              await new Promise(r => setTimeout(r, 30_000));
              continue;
            }
            stageMovedError = err.message;
            logger.error('ghl_reply_sync_cron: stage move error', {
              event_id: event.id,
              err: err.message,
            });
            break;
          }
        }

        if (!stageMoved && stageMovedError) {
          logger.warn('ghl_reply_sync_cron: could not move to INTERESADO', {
            event_id: event.id,
            reason: stageMovedError,
          });
        }
      }
    }
  } catch (err) {
    stageMovedError = err.message;
    logger.error('ghl_reply_sync_cron: unexpected error during stage move', {
      event_id: event.id,
      err: err.message,
    });
  }

  // 5. Mark event as synced (update metadata.ghl_synced)
  const success = noteCreated && !stageMovedError;
  const { error: updateErr } = await supabase
    .from('outreach_events')
    .update({
      metadata: {
        ...(event.metadata || {}),
        ghl_synced: success,
        ghl_sync_at: new Date().toISOString(),
        ghl_sync_error: !success ? (createNoteError || stageMovedError) : null,
      },
    })
    .eq('id', event.id);

  if (updateErr) {
    logger.warn('ghl_reply_sync_cron: failed to mark synced', {
      event_id: event.id,
      err: updateErr.message,
    });
  }

  return {
    action: 'synced',
    event_id: event.id,
    lead_id: event.lead_id,
    note_created: noteCreated,
    note_error: createNoteError,
    stage_error: stageMovedError,
  };
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * One full sync cycle: fetch unsynced replies → process each.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{total: number, synced: number, skipped: number, failed: number}>}
 */
async function runCycle(supabase) {
  logger.info('ghl_reply_sync_cron: cycle start');

  // Fetch unsynced replied events from the last 24h
  const sinceTime = new Date(Date.now() - MAX_REPLY_AGE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: events, error: fetchErr } = await supabase
    .from('outreach_events')
    .select('*')
    .eq('brand_id', BRAND_ID)
    .eq('event_type', 'replied')
    .gte('occurred_at', sinceTime)
    .order('occurred_at', { ascending: false });

  if (fetchErr) {
    logger.error('ghl_reply_sync_cron: fetch failed', { err: fetchErr.message });
    return { total: 0, synced: 0, skipped: 0, failed: 0 };
  }

  // Filter: only unsynced events
  const unsynced = (events || []).filter(ev => !ev.metadata?.ghl_synced);
  logger.info('ghl_reply_sync_cron: found events', {
    total_replied: (events || []).length,
    unsynced: unsynced.length,
  });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of unsynced) {
    const outcome = await processOneReply(supabase, event);
    switch (outcome.action) {
      case 'synced':
        // Check if it actually succeeded
        if (!outcome.note_error && !outcome.stage_error) {
          synced++;
        } else {
          failed++;
        }
        break;
      case 'skipped':
        skipped++;
        break;
      default:
        failed++;
    }
  }

  logger.info('ghl_reply_sync_cron: cycle done', {
    total_unsynced: unsynced.length,
    synced,
    skipped,
    failed,
  });

  return { total: unsynced.length, synced, skipped, failed };
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  logger.info('ghl_reply_sync_cron starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  await runCycle(supabase);

  if (SELF_CHECK) {
    logger.info('ghl_reply_sync_cron: self-check OK, exiting');
    process.exit(0);
  }
  // Not self-check: single pass then exit
}

// ── Entry point ──────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('ghl_reply_sync_cron fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneReply };
