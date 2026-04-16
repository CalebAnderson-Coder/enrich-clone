import { supabase } from './supabaseUtils.js';

async function fixMapsLinks() {
  const { data: leads, error } = await supabase.from('leads').select('id, business_name, city, metro_area, google_maps_url').not('google_maps_url', 'is', null);
  
  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }

  let fixedCount = 0;
  for (const lead of leads) {
    if (lead.google_maps_url && lead.google_maps_url.includes('maps.app.goo.gl')) {
      const location = lead.metro_area || lead.city || '';
      const query = encodeURIComponent(`${lead.business_name} ${location}`.trim());
      const safeMapsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
      
      console.log(`Fixing: ${lead.business_name} -> ${safeMapsUrl}`);
      
      await supabase.from('leads').update({
        google_maps_url: safeMapsUrl
      }).eq('id', lead.id);
      
      fixedCount++;
    }
  }
  console.log(`✅ Fixed ${fixedCount} hallucinated Google Maps links!`);
}

fixMapsLinks();
