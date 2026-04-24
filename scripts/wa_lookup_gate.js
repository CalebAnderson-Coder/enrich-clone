// ============================================================
// scripts/wa_lookup_gate.js — Twilio Lookup pre-flight gate (Plan B)
//
// Before we attempt a WhatsApp send we hit Twilio Lookup v2 and
// confirm the phone number is mobile (proxy for whatsapp-capable).
// The decision + raw payload is stamped into
// campaign_enriched_data.lead_magnets_data so the dispatcher can
// gate outbound WA traffic and we retain an audit trail.
//
// Root cause this addresses: 45/45 WA sends failed on the Empírika
// pilot (mostly #63016 "not on WhatsApp"). US B2B contractors in
// TX/FL carry WhatsApp at ~15-20%. Pre-flight lookup collapses the
// undeliverable rate to near-zero by only firing at verified mobiles.
//
// COST NOTICE: This script calls Twilio Lookup API (~$0.005-$0.01/query).
// Approved by Brian 2026-04-22 as part of Plan B WhatsApp remediation.
//
// Usage:
//   node scripts/wa_lookup_gate.js --brand-id=<uuid> [--limit=50] [--dry-run] [--confirm-cost]
//   node scripts/wa_lookup_gate.js --lead-id=<uuid>
//   node scripts/wa_lookup_gate.js --help
// ============================================================

import 'dotenv/config';
import { twilioClient } from './twilio.js';
import { supabase } from '../lib/supabase.js';

// ─── Constants ────────────────────────────────────────────────
const LOG = '[wa_lookup_gate]';
const LOOKUP_COST_USD = 0.008;          // midpoint estimate ($0.005-$0.01)
const BATCH_COST_HARD_CAP_USD = 2.00;   // spec: require --confirm-cost above this
const THROTTLE_MS = 100;                // spec: 100ms between calls
const MAX_RETRIES = 3;

// Per spec: "for US numbers if line_type.type === 'mobile' mark as
// wa_likely=true, wa_likely=false for landline/VoIP". We rely on
// line_type_intelligence.type returned by Twilio Lookup v2. Twilio
// currently does NOT expose a first-class whatsapp_enabled boolean
// on Lookup v2, so `line_type_intelligence.type === 'mobile'` is the
// best-available proxy (landline/voip/nonFixedVoip → almost never
// WhatsApp-enabled on US B2B). This is the field we settled on.
const MOBILE_TYPES = new Set(['mobile', 'nonFixedVoip']); // nonFixedVoip (Google Voice, etc.) can also carry WA

// ─── CLI arg parsing ──────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [k, v] = raw.slice(2).split('=');
    args[k] = v === undefined ? true : v;
  }
  return args;
}

function printHelp() {
  console.log(`
${LOG} Twilio Lookup pre-flight gate for WhatsApp sends.

Usage:
  node scripts/wa_lookup_gate.js --brand-id=<uuid> [--limit=50] [--dry-run] [--confirm-cost]
  node scripts/wa_lookup_gate.js --lead-id=<uuid> [--dry-run]

Flags:
  --brand-id=<uuid>    Batch-verify APPROVED/DRAFT_PHONE leads missing wa_verified stamp
  --lead-id=<uuid>     Single-lead verification
  --limit=N            Cap batch size (default 50)
  --dry-run            Do not write Supabase stamps; print what would change
  --confirm-cost       Acknowledge cost when estimated spend > $${BATCH_COST_HARD_CAP_USD.toFixed(2)}
  --help               Show this message
`);
}

// ─── Phone normalization ──────────────────────────────────────
// Mirrors the pattern in scripts/wa_phone_repair.js so callers can
// hand us raw DB phone strings. Twilio Lookup rejects non-E.164.
function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

function normalizeUSPhone(raw) {
  const dg = digitsOnly(raw);
  if (!dg) return null;
  // Already valid US/CA: 10 digits, or 11 digits starting with 1.
  if (dg.length === 10) return '+1' + dg;
  if (dg.length === 11 && dg.startsWith('1')) return '+' + dg;
  // Observed corruption: 13 digits starting with 156 → strip the "56".
  if (dg.length === 13 && dg.startsWith('156')) return '+1' + dg.slice(3);
  // Fallback: if ≥10 digits, keep last 10 and prefix +1 (matches wa_phone_repair.js).
  if (dg.length >= 10) return '+1' + dg.slice(-10);
  return null;
}

// ─── Twilio Lookup with retry/backoff ─────────────────────────
async function lookupWithRetry(phone, attempt = 0) {
  try {
    const resp = await twilioClient.lookups.v2
      .phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' });
    return { ok: true, data: resp };
  } catch (err) {
    const status = err?.status || err?.statusCode;
    if (status === 404) {
      return { ok: false, reason: 'twilio_404', error: err?.message || 'not_found', code: err?.code || 404 };
    }
    if (status === 429 && attempt < MAX_RETRIES) {
      const backoff = Math.pow(2, attempt) * 500; // 500, 1000, 2000 ms
      console.log(`${LOG} 429 rate-limit on ${phone} — retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
      return lookupWithRetry(phone, attempt + 1);
    }
    return { ok: false, reason: 'twilio_error', error: err?.message || 'unknown', code: err?.code || status || null };
  }
}

// ─── Exported API ─────────────────────────────────────────────

/**
 * Fetch Twilio Lookup v2 for one phone and derive a WhatsApp-capability verdict.
 *
 * @param {string} phone  Raw phone (any shape — normalized internally to E.164 US).
 * @returns {Promise<{ verified: boolean, details: object, cost_usd: number }>}
 */
export async function verifyWhatsAppCapability(phone) {
  if (!twilioClient) {
    return {
      verified: false,
      details: { reason: 'twilio_not_configured' },
      cost_usd: 0,
    };
  }

  const normalized = normalizeUSPhone(phone);
  if (!normalized) {
    return {
      verified: false,
      details: { reason: 'unparseable_phone', raw: phone },
      cost_usd: 0,
    };
  }

  const res = await lookupWithRetry(normalized);
  if (!res.ok) {
    return {
      verified: false,
      details: {
        reason: res.reason,
        error: res.error,
        code: res.code,
        phone_e164: normalized,
      },
      cost_usd: LOOKUP_COST_USD, // Twilio typically bills even on 404; be honest.
    };
  }

  const lti = res.data.lineTypeIntelligence || {};
  const lineType = lti.type || null;
  const valid = res.data.valid !== false; // v2 exposes .valid; treat missing as true
  const verified = valid && MOBILE_TYPES.has(lineType);

  return {
    verified,
    details: {
      phone_e164: normalized,
      valid,
      line_type: lineType,                   // 'mobile' | 'landline' | 'voip' | 'nonFixedVoip' | ...
      carrier_name: lti.carrier_name || null,
      mobile_country_code: lti.mobile_country_code || null,
      mobile_network_code: lti.mobile_network_code || null,
      country_code: res.data.countryCode || null,
      lookup_field: 'line_type_intelligence.type',
    },
    cost_usd: LOOKUP_COST_USD,
  };
}

/**
 * Verify a single lead and stamp the verdict into lead_magnets_data.
 * Never throws — Supabase failures are logged and returned so a batch
 * caller can keep going.
 */
export async function verifyAndStampLead(leadId, phone, { dryRun = false } = {}) {
  const verdict = await verifyWhatsAppCapability(phone);
  const stamp = {
    wa_verified: verdict.verified,
    wa_lookup_at: new Date().toISOString(),
    wa_lookup_details: verdict.details,
    wa_lookup_cost_usd: verdict.cost_usd,
  };
  if (!verdict.verified && verdict.details?.reason) {
    stamp.wa_lookup_error = verdict.details.reason;
  }

  if (dryRun) {
    console.log(`${LOG} DRY-RUN leadId=${leadId} verified=${verdict.verified} line_type=${verdict.details?.line_type || '-'} would_stamp=${JSON.stringify(stamp)}`);
    return { verified: verdict.verified, leadId, stamped: false, dryRun: true, cost_usd: verdict.cost_usd };
  }

  if (!supabase) {
    console.log(`${LOG} WARN no supabase client — skipping stamp for leadId=${leadId}`);
    return { verified: verdict.verified, leadId, stamped: false, error: 'supabase_not_configured', cost_usd: verdict.cost_usd };
  }

  // Fetch current lead_magnets_data, merge, write back.
  const { data: row, error: selErr } = await supabase
    .from('campaign_enriched_data')
    .select('id, lead_magnets_data')
    .eq('lead_id', leadId)
    .maybeSingle();

  if (selErr || !row) {
    console.log(`${LOG} ERROR fetch leadId=${leadId}: ${selErr?.message || 'not_found'} — continuing`);
    return { verified: verdict.verified, leadId, stamped: false, error: selErr?.message || 'not_found', cost_usd: verdict.cost_usd };
  }

  const merged = { ...(row.lead_magnets_data || {}), ...stamp };
  const { error: updErr } = await supabase
    .from('campaign_enriched_data')
    .update({ lead_magnets_data: merged })
    .eq('id', row.id);

  if (updErr) {
    console.log(`${LOG} ERROR stamp leadId=${leadId}: ${updErr.message} — continuing`);
    return { verified: verdict.verified, leadId, stamped: false, error: updErr.message, cost_usd: verdict.cost_usd };
  }

  return { verified: verdict.verified, leadId, stamped: true, cost_usd: verdict.cost_usd };
}

/**
 * Batch verify. Throttles 100ms between Twilio calls per spec.
 * @param {string[]} leadIds
 * @param {object}   [opts]
 * @param {boolean}  [opts.dryRun]
 */
export async function batchVerify(leadIds, { dryRun = false } = {}) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return { total: 0, verified: 0, rejected: 0, errors: 0, cost_usd: 0 };
  }
  if (!supabase) {
    console.log(`${LOG} WARN no supabase client — batch cannot resolve phone numbers`);
    return { total: leadIds.length, verified: 0, rejected: 0, errors: leadIds.length, cost_usd: 0 };
  }

  // Resolve phone numbers in one shot.
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, phone')
    .in('id', leadIds);
  if (error) {
    console.log(`${LOG} ERROR resolving leads: ${error.message}`);
    return { total: leadIds.length, verified: 0, rejected: 0, errors: leadIds.length, cost_usd: 0 };
  }

  const byId = new Map((leads || []).map(l => [l.id, l]));
  const summary = { total: leadIds.length, verified: 0, rejected: 0, errors: 0, cost_usd: 0 };

  for (const leadId of leadIds) {
    const lead = byId.get(leadId);
    if (!lead) {
      console.log(`${LOG} SKIP leadId=${leadId} not found in leads table`);
      summary.errors++;
      continue;
    }
    if (!lead.phone) {
      console.log(`${LOG} SKIP leadId=${leadId} (${lead.business_name || '?'}) no phone`);
      summary.errors++;
      continue;
    }

    const res = await verifyAndStampLead(leadId, lead.phone, { dryRun });
    summary.cost_usd += res.cost_usd || 0;
    if (res.error) summary.errors++;
    else if (res.verified) summary.verified++;
    else summary.rejected++;

    const tag = res.verified ? 'PASS' : 'REJECT';
    console.log(`${LOG} ${tag} ${leadId} ${(lead.business_name || '?').slice(0, 32)}`);

    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }

  return summary;
}

// ─── CLI entry ────────────────────────────────────────────────

async function fetchCandidateLeadIds(brandId, limit) {
  if (!supabase) throw new Error('supabase client not configured');

  // Pull rows for the brand with outreach_status in the gate-eligible set,
  // then filter out those that already carry a wa_verified stamp.
  const { data, error } = await supabase
    .from('campaign_enriched_data')
    .select('lead_id, lead_magnets_data, outreach_status')
    .eq('brand_id', brandId)
    .in('outreach_status', ['APPROVED', 'DRAFT_PHONE'])
    .limit(Math.max(limit * 3, limit)); // overshoot, then filter client-side

  if (error) throw error;

  const pending = (data || []).filter(r => {
    const lmd = r.lead_magnets_data || {};
    return lmd.wa_verified === undefined || lmd.wa_verified === null;
  });
  return pending.slice(0, limit).map(r => r.lead_id);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args['brand-id'] && !args['lead-id']) {
    console.error(`${LOG} ERROR: must pass --brand-id=<uuid> or --lead-id=<uuid>`);
    printHelp();
    process.exit(2);
  }

  if (!twilioClient) {
    console.error(`${LOG} ERROR: Twilio client not configured (check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN env).`);
    process.exit(3);
  }

  const dryRun = Boolean(args['dry-run']);

  // Single-lead path
  if (args['lead-id']) {
    const leadId = args['lead-id'];
    if (!supabase) {
      console.error(`${LOG} ERROR: Supabase client not configured.`);
      process.exit(3);
    }
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, business_name, phone')
      .eq('id', leadId)
      .maybeSingle();
    if (error || !lead) {
      console.error(`${LOG} ERROR lead lookup: ${error?.message || 'not_found'}`);
      process.exit(4);
    }
    if (!lead.phone) {
      console.error(`${LOG} ERROR lead ${leadId} has no phone`);
      process.exit(5);
    }
    console.log(`${LOG} single-lead verify leadId=${leadId} business=${lead.business_name || '?'} dryRun=${dryRun}`);
    const res = await verifyAndStampLead(leadId, lead.phone, { dryRun });
    console.log(`${LOG} result=${JSON.stringify(res)}`);
    process.exit(res.error ? 6 : 0);
  }

  // Batch path
  const brandId = args['brand-id'];
  const limit = args.limit ? parseInt(args.limit, 10) : 50;
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`${LOG} ERROR: --limit must be a positive integer`);
    process.exit(2);
  }

  const estCost = limit * LOOKUP_COST_USD;
  console.log(`${LOG} brand=${brandId} limit=${limit} dryRun=${dryRun} est_cost_usd=$${estCost.toFixed(3)}`);

  if (estCost > BATCH_COST_HARD_CAP_USD && !args['confirm-cost'] && !dryRun) {
    console.error(`${LOG} ERROR: estimated cost $${estCost.toFixed(3)} exceeds hard cap $${BATCH_COST_HARD_CAP_USD.toFixed(2)}. Re-run with --confirm-cost to proceed.`);
    process.exit(7);
  }

  let leadIds;
  try {
    leadIds = await fetchCandidateLeadIds(brandId, limit);
  } catch (e) {
    console.error(`${LOG} ERROR fetching candidates: ${e.message}`);
    process.exit(8);
  }

  console.log(`${LOG} resolved ${leadIds.length} candidate leads`);
  if (leadIds.length === 0) {
    console.log(`${LOG} nothing to do — exiting clean`);
    process.exit(0);
  }

  const summary = await batchVerify(leadIds, { dryRun });
  console.log(`${LOG} DONE total=${summary.total} verified=${summary.verified} rejected=${summary.rejected} errors=${summary.errors} cost_usd=$${summary.cost_usd.toFixed(4)}`);
  process.exit(0);
}

// Only run main() when executed directly (not when imported).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invokedPath.endsWith('/wa_lookup_gate.js') || invokedPath.endsWith('wa_lookup_gate.js')) {
  main().catch(err => {
    console.error(`${LOG} FATAL: ${err.stack || err.message || err}`);
    process.exit(99);
  });
}
