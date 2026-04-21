// ============================================================
// scripts/ghl_backfill_contactado.js
// One-off backfill: migrates every SENT email-path lead into
// GHL pipeline stage CONTACTADO.
//
// For each campaign_enriched_data row WHERE outreach_status='SENT'
// and lead_magnets_data.ghl_moved_to_contactado_at IS NULL:
//   1. If no ghl_opportunity_id → pushEmailPathToGHL (creates
//      contact + opportunity in COLD LEADS / NUEVO).
//   2. moveOpportunityToStage(opportunityId, CONTACTADO).
//   3. Persist ghl_stage='CONTACTADO' + ghl_moved_to_contactado_at
//      into lead_magnets_data.
//
// Idempotent: re-running skips leads already stamped.
//
// Usage:
//   node scripts/ghl_backfill_contactado.js          # canary (3) then pause
//   node scripts/ghl_backfill_contactado.js --all    # full batch
//   node scripts/ghl_backfill_contactado.js --resume # skip canary
//   node scripts/ghl_backfill_contactado.js --dry    # read-only report
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { pushEmailPathToGHL, moveOpportunityToStage } from '../tools/email.js';

dotenv.config();

const BRAND_ID     = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STAGE_CONTACTADO = process.env.GHL_STAGE_CONTACTADO_ID || 'c1d2e758-5235-4469-b0b5-95d4fb06cdc4';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = new Set(process.argv.slice(2));
const RUN_ALL    = args.has('--all');
const RUN_RESUME = args.has('--resume');
const DRY        = args.has('--dry');
const CANARY_SIZE = 3;
const DELAY_MS    = 350;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchSentLeads() {
  const { data, error } = await sb
    .from('campaign_enriched_data')
    .select(`
      id,
      prospect_id,
      lead_magnets_data,
      outreach_status,
      leads!inner (
        id,
        business_name,
        industry,
        metro_area,
        email_address,
        phone,
        website,
        qualification_score,
        brand_id
      )
    `)
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'SENT');

  if (error) throw error;

  // Filter: skip rows already stamped as moved to CONTACTADO.
  return (data || []).filter(row => {
    const md = row.lead_magnets_data || {};
    return !md.ghl_moved_to_contactado_at;
  });
}

async function processLead(row) {
  const lead = row.leads;
  const magnetData = { ...(row.lead_magnets_data || {}) };
  const business = lead?.business_name || '(sin nombre)';

  let opportunityId = magnetData.ghl_opportunity_id || null;

  // 1. Ensure opportunity exists.
  if (!opportunityId) {
    if (DRY) {
      console.log(`  [DRY] would create opp for "${business}"`);
    } else {
      const push = await pushEmailPathToGHL(lead);
      if (push.opportunityId) {
        opportunityId = push.opportunityId;
        magnetData.ghl_contact_id     = push.contactId;
        magnetData.ghl_opportunity_id = push.opportunityId;
        magnetData.ghl_synced_at      = new Date().toISOString();
        if (push.duplicate) magnetData.ghl_linked_to_existing = true;
        console.log(`  ✓ opp created: ${opportunityId}${push.duplicate ? ' (dup contact)' : ''}`);
      } else {
        magnetData.ghl_sync_error = push.error || 'unknown';
        console.log(`  ✗ opp create failed: ${push.error} ${JSON.stringify(push.detail || '').slice(0, 120)}`);
        if (!DRY) {
          await sb
            .from('campaign_enriched_data')
            .update({ lead_magnets_data: magnetData })
            .eq('id', row.id);
        }
        return { ok: false, reason: 'opp_create_failed' };
      }
    }
  }

  if (!opportunityId && !DRY) return { ok: false, reason: 'no_opportunity_id' };

  // 2. Move stage NUEVO → CONTACTADO.
  if (DRY) {
    console.log(`  [DRY] would move opp ${opportunityId || '(new)'} → CONTACTADO for "${business}"`);
    return { ok: true, dry: true };
  }

  const mv = await moveOpportunityToStage(opportunityId, STAGE_CONTACTADO);
  if (mv.ok) {
    magnetData.ghl_stage                  = 'CONTACTADO';
    magnetData.ghl_moved_to_contactado_at = new Date().toISOString();
    console.log(`  ✓ ${business} → CONTACTADO`);
  } else {
    magnetData.ghl_stage_move_error = mv.error;
    console.log(`  ✗ stage move failed: ${mv.error} ${(mv.detail || '').slice(0, 120)}`);
  }

  // 3. Persist.
  const { error: upErr } = await sb
    .from('campaign_enriched_data')
    .update({ lead_magnets_data: magnetData })
    .eq('id', row.id);
  if (upErr) console.log(`  ! persist error: ${upErr.message}`);

  return mv.ok ? { ok: true } : { ok: false, reason: mv.error };
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  GHL CONTACTADO Backfill');
  console.log(`  Brand: ${BRAND_ID}`);
  console.log(`  Mode:  ${DRY ? 'DRY-RUN' : (RUN_ALL || RUN_RESUME ? 'FULL' : `CANARY (${CANARY_SIZE})`)}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const todo = await fetchSentLeads();
  console.log(`→ ${todo.length} SENT leads pending stage migration\n`);
  if (todo.length === 0) return;

  const batch = (RUN_ALL || RUN_RESUME || DRY)
    ? todo
    : todo.slice(0, CANARY_SIZE);

  let ok = 0, fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const biz = row.leads?.business_name || '(sin nombre)';
    console.log(`[${i + 1}/${batch.length}] ${biz}`);
    try {
      const r = await processLead(row);
      if (r.ok) ok++; else fail++;
    } catch (err) {
      fail++;
      console.log(`  ! exception: ${err.message}`);
    }
    if (i < batch.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  DONE — ok: ${ok}  fail: ${fail}  of ${batch.length}`);
  if (!RUN_ALL && !RUN_RESUME && !DRY && todo.length > batch.length) {
    console.log(`  Canary complete. Re-run with --all to process the remaining ${todo.length - batch.length}.`);
  }
  console.log('═══════════════════════════════════════════════════════');
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
