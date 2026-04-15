const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  'https://wzdhxnnpupbybxzbdrna.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6ZGh4bm5wdXBieWJ4emJkcm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTU0NzQsImV4cCI6MjA5MTIzMTQ3NH0.DMQ8bcxA_Na1FQzTl2-qxNsjzsLNQShRewA2qm9Sb-0'
);

(async () => {
  // Get all prospects
  const { data: prospects } = await sb.from('prospects').select('*');
  // Get all campaign data
  const { data: campaigns } = await sb.from('campaign_enriched_data').select('*');
  
  // Manual join
  const joined = prospects.map(p => {
    const campData = campaigns.filter(c => c.prospect_id === p.id);
    return { ...p, campaign_enriched_data: campData };
  });
  
  // Stats
  let pendientes = 0, aprobados = 0, enviados = 0, rechazados = 0;
  joined.forEach(j => {
    const camp = j.campaign_enriched_data[0];
    if (!camp) { pendientes++; return; }
    if (camp.email_sent_at) { enviados++; return; }
    if (camp.outreach_status === 'APPROVED') { aprobados++; return; }
    if (camp.outreach_status === 'REJECTED') { rechazados++; return; }
    pendientes++;
  });
  
  console.log('=== REPORTE FINAL ===');
  console.log('Total prospects:', prospects.length);
  console.log('Total campaign records:', campaigns.length);
  console.log('');
  console.log('Prospects con campaign data:', joined.filter(j => j.campaign_enriched_data.length > 0).length);
  console.log('Prospects SIN campaign data:', joined.filter(j => j.campaign_enriched_data.length === 0).length);
  console.log('');
  console.log('--- Estado para pestañas ---');
  console.log('Pendientes (por aprobar):', pendientes);
  console.log('Aprobados:', aprobados);
  console.log('Enviados (email_sent_at):', enviados);
  console.log('Rechazados:', rechazados);
  console.log('');
  
  // Show raw_data.radar_parsed structure
  const sample = prospects[0];
  if (sample && sample.raw_data && sample.raw_data.radar_parsed) {
    console.log('=== radar_parsed keys ===');
    console.log(Object.keys(sample.raw_data.radar_parsed).join(', '));
    const rp = sample.raw_data.radar_parsed;
    console.log('business_name:', rp.business_name);
    console.log('category:', rp.category);
    console.log('address:', rp.address);
    console.log('city:', rp.city);
  }
  
  // Show which campaigns have valid outreach_copy for email
  let withCopy = 0;
  campaigns.forEach(c => {
    const copy = c.outreach_copy || '';
    if (copy.length > 80 && !copy.includes('Pendiente') && !copy.includes('max iterations')) {
      withCopy++;
    }
  });
  console.log('\nCampaigns con email draft valido:', withCopy, 'de', campaigns.length);
})();
