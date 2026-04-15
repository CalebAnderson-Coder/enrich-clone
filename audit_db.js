import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Get all campaigns with real drafts
const { data: realCamps } = await sb
  .from('campaign_enriched_data')
  .select('prospect_id, outreach_copy, outreach_status, status, radiography_technical, attack_angle')
  .neq('outreach_copy', 'Pendiente de revisión.')
  .not('outreach_copy', 'ilike', '%[Awaiting%')
  .not('outreach_copy', 'is', null)
  .neq('outreach_copy', '');

console.log(`Campaigns with real drafts: ${realCamps.length}`);

// Get the leads for these campaign IDs
const campIds = realCamps.map(c => c.prospect_id);
const { data: leadsWithDraft } = await sb
  .from('leads')
  .select('id, business_name, metro_area, industry, phone, email, website, google_maps_url, facebook_url, instagram_url, rating, review_count, created_at')
  .in('id', campIds);

console.log(`Leads matched: ${leadsWithDraft.length}`);
leadsWithDraft.forEach((l, i) => {
  const camp = realCamps.find(c => c.prospect_id === l.id);
  const isEnglish = camp?.outreach_copy && (/^Subject:/i.test(camp.outreach_copy) && !/Hola|Estimado|asunto/i.test(camp.outreach_copy.substring(0, 100)));
  console.log(`${i+1}. ${l.business_name} | ${l.metro_area} | English: ${isEnglish} | ${camp?.outreach_status}`);
});

// Count English vs Spanish
const englishDrafts = realCamps.filter(c => {
  return c.outreach_copy && /^Subject:/i.test(c.outreach_copy) && !/Hola|Estimado/i.test(c.outreach_copy.substring(0, 80));
});
const spanishDrafts = realCamps.filter(c => {
  return c.outreach_copy && /Hola|Estimado/i.test(c.outreach_copy.substring(0, 80));
});
console.log(`\nEnglish drafts: ${englishDrafts.length}`);
console.log(`Spanish drafts: ${spanishDrafts.length}`);

// Sample english draft
const eng = englishDrafts[0];
if (eng) {
  console.log('\n=== SAMPLE ENGLISH DRAFT ===');
  console.log(eng.outreach_copy.substring(0, 400));
}
