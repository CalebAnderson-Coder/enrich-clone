import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, count, error } = await sb
  .from('prospects')
  .select('id, business_name, city, niche_id, qualification_score, outreach_status, email, analysis_summary, lead_magnet_path', { count: 'exact' });

console.log('\n══════════════════════════════════════');
console.log('  AUDIT: prospects table');
console.log('══════════════════════════════════════');
console.log('TOTAL prospects:', count);
if (error) console.error('Error:', error.message);

if (data) {
  const byStatus = data.reduce((acc, p) => {
    const k = p.outreach_status || 'none';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  console.log('Por outreach_status:', JSON.stringify(byStatus, null, 2));

  const conAnalisis = data.filter(p => p.analysis_summary).length;
  const conEmail = data.filter(p => p.email).length;
  const conMagnet = data.filter(p => p.lead_magnet_path).length;
  console.log(`Con analysis_summary: ${conAnalisis}`);
  console.log(`Con email: ${conEmail}`);
  console.log(`Con lead_magnet: ${conMagnet}`);
  
  console.log('\nPrimeros 5:');
  data.slice(0, 5).forEach(p => console.log(`  - [${p.id}] ${p.business_name} | ${p.city} | status:${p.outreach_status}`));
}

// Also check campaign_enriched_data
const { count: campCount } = await sb.from('campaign_enriched_data').select('id', { count: 'exact', head: true });
console.log('\nTOTAL campaign_enriched_data:', campCount);
