import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await sb
  .from('campaign_enriched_data')
  .select('prospect_id, outreach_copy, status')
  .not('outreach_copy', 'is', null)
  .limit(5);

if (error) {
  console.log('ERR:', error.message);
} else {
  data.forEach((d, i) => {
    console.log(`\n--- Lead #${i + 1} (${d.status}) ---`);
    console.log(d.outreach_copy?.substring(0, 250) + '...');
  });
  console.log(`\n✅ Total con draft: verificando idioma...`);
  
  const { count } = await sb
    .from('campaign_enriched_data')
    .select('*', { count: 'exact', head: true })
    .not('outreach_copy', 'is', null);
  console.log(`📊 Total leads con outreach copy: ${count}`);
}
