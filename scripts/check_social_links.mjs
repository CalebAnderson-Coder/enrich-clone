import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await sb.from('prospects').select('business_name, mega_profile, raw_data').limit(4);
if (error) { console.error(error); process.exit(1); }

for (const r of data) {
  console.log('\n=== ' + r.business_name + ' ===');
  const mega = JSON.stringify(r.mega_profile || {});
  const raw = JSON.stringify(r.raw_data || {});
  const combined = mega + raw;
  // extract key:URL pairs
  const regex = /"([^"]+)":\s*"(https?:\/\/[^"]+)"/g;
  let m;
  let found = false;
  while ((m = regex.exec(combined)) !== null) {
    console.log(`  ${m[1]}: ${m[2]}`);
    found = true;
  }
  if (!found) console.log('  (no URLs found in mega_profile or raw_data)');
}
