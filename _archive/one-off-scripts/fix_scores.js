import { supabase } from './supabaseUtils.js';

async function fix() {
  console.log("Fixing DB...");
  const { data, error } = await supabase
    .from('leads')
    .update({ qualification_score: 85, lead_tier: 'HOT' })
    .eq('qualification_score', 0);
    
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Updated rows.");
  }
}

fix();
