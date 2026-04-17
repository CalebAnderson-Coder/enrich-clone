// ============================================================
// scripts/ghl_backfill_draft_phone.js
// One-off backfill: pushes every existing DRAFT_PHONE lead
// for brand Empírika into GHL as Contact + Opportunity in
// COLD LEADS | GOOGLE MY BUSINESS pipeline, stage NUEVO.
//
// Idempotent: skips leads where lead_magnets_data.ghl_contact_id
// is already set.
//
// Usage:
//   node scripts/ghl_backfill_draft_phone.js           # canary (3) then pause
//   node scripts/ghl_backfill_draft_phone.js --all     # full batch
//   node scripts/ghl_backfill_draft_phone.js --resume  # skip canary, continue
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { pushDraftPhoneToGHL } from '../tools/email.js';
import { logger } from '../lib/logger.js';

dotenv.config();

const BRAND_ID = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = new Set(process.argv.slice(2));
const RUN_ALL    = args.has('--all');
const RUN_RESUME = args.has('--resume');
const CANARY_SIZE = 3;
const DELAY_MS = 600; // polite pacing between GHL API calls

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDraftPhoneLeads() {
  const { data, error } = await sb
    .from('campaign_enriched_data')
    .select(`
      id,
      prospect_id,
      lead_magnets_data,
      leads!inner (
        id,
        business_name,
        industry,
        metro_area,
        email_address,
        phone,
        instagram_url,
        facebook_url,
        website,
        qualification_score,
        rating,
        review_count
      )
    `)
    .eq('brand_id', BRAND_ID)
    .eq('outreach_status', 'DRAFT_PHONE')
    .order('id', { ascending: true });

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return data || [];
}

async function pushOne(record) {
  const lead = record.leads;
  const magnetData = record.lead_magnets_data || {};

  if (magnetData.ghl_contact_id) {
    return { skipped: true, reason: 'already_synced', contactId: magnetData.ghl_contact_id };
  }

  const result = await pushDraftPhoneToGHL(lead, {
    callScript: magnetData.call_script || null,
    whatsapp:   magnetData.whatsapp_draft || null,
  });

  if (result.contactId) {
    magnetData.ghl_contact_id     = result.contactId;
    magnetData.ghl_opportunity_id = result.opportunityId || null;
    magnetData.ghl_synced_at      = new Date().toISOString();
    delete magnetData.ghl_sync_error;
  } else {
    magnetData.ghl_sync_error = result.error || 'unknown';
  }

  const { error: updateErr } = await sb
    .from('campaign_enriched_data')
    .update({ lead_magnets_data: magnetData })
    .eq('id', record.id);
  if (updateErr) {
    return { error: `supabase_update_${updateErr.code || 'err'}`, detail: updateErr.message };
  }

  return result;
}

function printSummary(results, label) {
  const ok   = results.filter(r => r.contactId).length;
  const skip = results.filter(r => r.skipped).length;
  const err  = results.filter(r => r.error).length;
  console.log(`\n── ${label} ──`);
  console.log(`  ✅ Synced:  ${ok}`);
  console.log(`  ⏭️  Skipped: ${skip}`);
  console.log(`  ❌ Errors:  ${err}`);
}

(async () => {
  console.log('🚀 GHL Backfill — DRAFT_PHONE → COLD LEADS pipeline\n');
  console.log(`  brand_id   = ${BRAND_ID}`);
  console.log(`  mode       = ${RUN_ALL ? 'ALL' : RUN_RESUME ? 'RESUME (no canary)' : 'CANARY + PAUSE'}\n`);

  const records = await fetchDraftPhoneLeads();
  const pending = records.filter(r => !r.lead_magnets_data?.ghl_contact_id);

  console.log(`📊 Found ${records.length} DRAFT_PHONE leads · ${pending.length} pending sync · ${records.length - pending.length} already synced\n`);

  if (pending.length === 0) {
    console.log('✅ Nothing to do. All DRAFT_PHONE leads already have ghl_contact_id.');
    process.exit(0);
  }

  // ── CANARY ──
  let start = 0;
  if (!RUN_ALL && !RUN_RESUME) {
    const canary = pending.slice(0, CANARY_SIZE);
    console.log(`🐤 Canary pass — syncing ${canary.length} leads:\n`);
    const canaryResults = [];
    for (let i = 0; i < canary.length; i++) {
      const r = canary[i];
      console.log(`[${i + 1}/${canary.length}] ${r.leads.business_name} (${r.leads.phone || 'no-phone'})`);
      const out = await pushOne(r);
      canaryResults.push(out);
      if (out.contactId) {
        console.log(`   ✅ contact=${out.contactId} opportunity=${out.opportunityId || '-'}`);
      } else if (out.skipped) {
        console.log(`   ⏭️  skipped: ${out.reason}`);
      } else {
        console.log(`   ❌ ${out.error}: ${JSON.stringify(out.detail).slice(0, 200)}`);
      }
      await sleep(DELAY_MS);
    }
    printSummary(canaryResults, 'CANARY RESULT');
    console.log(`\n🛑 Paused after canary. Verify in GHL dashboard, then run with --resume or --all.`);
    process.exit(0);
  }

  // ── RESUME / ALL ──
  if (RUN_RESUME) start = CANARY_SIZE; // skip the canary we already ran
  const target = pending.slice(start);
  console.log(`⚡ Processing ${target.length} leads (DELAY ${DELAY_MS}ms each)\n`);

  const results = [];
  for (let i = 0; i < target.length; i++) {
    const r = target[i];
    console.log(`[${i + 1}/${target.length}] ${r.leads.business_name}`);
    const out = await pushOne(r);
    results.push(out);
    if (out.contactId) {
      console.log(`   ✅ contact=${out.contactId}`);
    } else if (out.skipped) {
      console.log(`   ⏭️  ${out.reason}`);
    } else {
      console.log(`   ❌ ${out.error}`);
    }
    await sleep(DELAY_MS);
  }

  printSummary(results, 'FINAL RESULT');
  process.exit(results.filter(r => r.error).length > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err.message);
  logger.error('Backfill fatal', { error: err.message });
  process.exit(1);
});
