// scripts/check_schema.js — Check actual columns in Supabase leads table
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

// Try inserting a minimal lead to see what columns are accepted
async function checkSchema() {
  // Method 1: Try to read columns via information_schema (requires service role)
  const { data, error } = await supabase
    .rpc('get_table_columns', { table_name_param: 'leads' });
  
  if (error) {
    console.log("RPC not available, trying direct select...");
    // Method 2: Just select * limit 1 and see what columns come back
    const { data: rows, error: err2 } = await supabase.from('leads').select('*').limit(1);
    if (err2) {
      console.error("Error selecting from leads:", err2);
    } else if (rows && rows.length > 0) {
      console.log("Columns in 'leads' table:", Object.keys(rows[0]));
    } else {
      console.log("Table 'leads' exists but is empty. Trying empty insert to discover columns...");
      // Method 3: Insert empty and read the error
      const { error: err3 } = await supabase.from('leads').insert([{ business_name: '__SCHEMA_CHECK__' }]).select();
      if (err3) {
        console.log("Insert error (expected):", err3);
      } else {
        console.log("Insert succeeded — cleaning up...");
        await supabase.from('leads').delete().eq('business_name', '__SCHEMA_CHECK__');
      }
    }
  } else {
    console.log("Columns:", data);
  }

  // Also check campaign_enriched_data
  const { data: campRows, error: campErr } = await supabase.from('campaign_enriched_data').select('*').limit(1);
  if (campErr) {
    console.error("Error selecting from campaign_enriched_data:", campErr);
  } else if (campRows && campRows.length > 0) {
    console.log("Columns in 'campaign_enriched_data':", Object.keys(campRows[0]));
  } else {
    console.log("campaign_enriched_data is empty");
  }
}

checkSchema();
