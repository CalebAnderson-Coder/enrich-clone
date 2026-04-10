// scripts/test_fk_fixed.js — Verify FK works by inserting a test campaign record
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function test() {
  // 1. Get a real lead ID from the last batch
  const { data: leads, error: e1 } = await supabase
    .from('leads')
    .select('id, business_name, metro_area')
    .eq('metro_area', 'Desconocido')
    .limit(5);

  if (e1) { console.error('Error fetching leads:', e1); return; }
  
  console.log(`Found ${leads?.length || 0} leads from Orlando campaign:`);
  leads?.forEach(l => console.log(`  • ${l.business_name} (${l.id})`));

  if (!leads || leads.length === 0) {
    console.log('No leads found — nothing to test');
    return;
  }

  // 2. Try inserting a campaign record with FK to leads
  const testLead = leads[0];
  const { data: camp, error: e2 } = await supabase
    .from('campaign_enriched_data')
    .insert([{
      prospect_id: testLead.id,
      radiography_technical: 'FK TEST — Verificación de que la FK apunta a leads correctamente',
      attack_angle: 'Test angle',
      outreach_copy: 'Test copy',
      status: 'TEST'
    }])
    .select();

  if (e2) {
    console.error('❌ FK STILL BROKEN:', e2);
  } else {
    console.log(`✅ FK WORKS! Campaign record created: ${camp[0].id}`);
    // Clean up test record
    await supabase.from('campaign_enriched_data').delete().eq('id', camp[0].id);
    console.log('🧹 Test record cleaned up');
  }

  // 3. Count total leads from Orlando
  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });
  console.log(`\n📊 Total leads in database: ${count}`);
}

test();
