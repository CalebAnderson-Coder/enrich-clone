import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Check leads state
const { data: leads } = await s.from('leads').select('id,business_name,outreach_status,email,email_address,website').order('created_at', { ascending: false }).limit(100);
console.log('Total leads:', leads?.length);

const sent = leads?.filter(l => l.outreach_status === 'SENT');
const pending = leads?.filter(l => !l.outreach_status || l.outreach_status === 'NEW');
console.log('SENT:', sent?.length, 'Pending/New:', pending?.length);

// Check campaign_enriched_data
const { data: campaigns } = await s.from('campaign_enriched_data').select('id,prospect_id,status,outreach_copy').limit(100);
console.log('\nCampaign enriched data:', campaigns?.length);
const pendingC = campaigns?.filter(c => c.status === 'PENDING');
const sentC = campaigns?.filter(c => c.status === 'SENT');
console.log('PENDING campaigns:', pendingC?.length, 'SENT campaigns:', sentC?.length);

// Show some pending leads
console.log('\n--- Leads sin campaña (primeros 5) ---');
pending?.slice(0, 5).forEach(l => {
  console.log(`  ${l.business_name} | email: ${l.email || l.email_address || 'N/A'} | web: ${l.website || 'N/A'}`);
});
