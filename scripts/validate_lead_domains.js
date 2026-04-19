// ============================================================
// scripts/validate_lead_domains.js
// Nightly job: scan all leads, null-out websites that don't resolve.
// Preserves phone / google_maps_url / socials — only the ghost URL dies.
// ============================================================
// Usage:
//   node scripts/validate_lead_domains.js                 # scan all brands, dry-run
//   node scripts/validate_lead_domains.js --apply         # apply UPDATE statements
//   node scripts/validate_lead_domains.js --brand=<uuid>  # limit to one brand
// ============================================================

import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { isDomainReachable } from '../lib/domainValidator.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const brandArg = argv.find(a => a.startsWith('--brand='));
const BRAND = brandArg ? brandArg.split('=')[1] : null;
const CONCURRENCY = 8;

async function main() {
  if (!supabase) {
    console.error('Supabase not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  let q = supabase.from('leads').select('id, brand_id, business_name, website').not('website', 'is', null);
  if (BRAND) q = q.eq('brand_id', BRAND);

  const { data, error } = await q;
  if (error) { console.error('Fetch error:', error.message); process.exit(1); }

  console.log(`Fetched ${data.length} leads with website (brand=${BRAND || 'ALL'}, mode=${APPLY ? 'APPLY' : 'DRY-RUN'})`);

  const unreachable = [];
  for (let i = 0; i < data.length; i += CONCURRENCY) {
    const batch = data.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (lead) => {
      const r = await isDomainReachable(lead.website, 6000);
      if (!r.reachable) {
        unreachable.push({ ...lead, _err: r.error || `HTTP ${r.statusCode}` });
        console.log(`  GHOST  ${lead.business_name} | ${lead.website} | ${r.error || r.statusCode}`);
      }
    }));
    process.stdout.write(`  ...scanned ${Math.min(i + CONCURRENCY, data.length)}/${data.length}\r`);
  }

  console.log(`\n\nSummary: ${unreachable.length}/${data.length} websites unreachable.`);

  if (!APPLY) {
    console.log('Dry-run — no updates applied. Rerun with --apply to null these websites.');
    return;
  }

  if (unreachable.length === 0) return;

  const ids = unreachable.map(u => u.id);
  const { error: updErr, count } = await supabase
    .from('leads')
    .update({ website: null, has_website: false }, { count: 'exact' })
    .in('id', ids);

  if (updErr) { console.error('Update error:', updErr.message); process.exit(1); }
  console.log(`Nulled website on ${count ?? ids.length} leads.`);
}

main().catch(err => { console.error(err); process.exit(1); });
