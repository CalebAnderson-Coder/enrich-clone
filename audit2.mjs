import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Join prospects + campaign data
const { data, error } = await sb
  .from('prospects')
  .select(`
    id, business_name, city, niche_id, created_at,
    campaign_enriched_data (
      id, status, outreach_status,
      radiography_technical, attack_angle, outreach_copy,
      lead_magnet_status, lead_magnets_data
    )
  `)
  .order('created_at', { ascending: false });

if (error) { console.error('Error:', error.message); process.exit(1); }

console.log('Total prospects in DB:', data.length);
console.log('');

data.forEach((p, i) => {
  const camp = p.campaign_enriched_data?.[0];
  const status = camp?.outreach_status || camp?.status || 'NO CAMPAIGN';
  const hasAnalysis = camp?.radiography_technical ? '✅' : '❌';
  const hasCopy = camp?.outreach_copy ? '✅' : '❌';
  const hasMagnet = camp?.lead_magnet_status === 'done' ? '✅' : '❌';
  console.log(`[${i+1}] ${p.business_name} | ${p.city} | campaigns:${p.campaign_enriched_data?.length||0} | outreach_status:${status} | analysis:${hasAnalysis} copy:${hasCopy} magnet:${hasMagnet}`);
});

// What the /api/leads endpoint likely filters by
const withCampaign = data.filter(p => p.campaign_enriched_data?.length > 0);
const pending = data.filter(p => p.campaign_enriched_data?.[0]?.outreach_status === 'PENDING' || p.campaign_enriched_data?.[0]?.status === 'PENDING');
console.log('\n--- SUMMARY ---');
console.log('With campaign data:', withCampaign.length);
console.log('Status PENDING:', pending.length);
