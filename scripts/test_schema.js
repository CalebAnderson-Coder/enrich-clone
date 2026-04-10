import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function test() {
  const { data, error } = await supabase.from('leads').select('*').limit(1);
  if (error) {
    console.error("API error:", error);
  } else {
    console.log("Leads API columns:", data.length > 0 ? Object.keys(data[0]) : "No rows");
  }
}
test();
