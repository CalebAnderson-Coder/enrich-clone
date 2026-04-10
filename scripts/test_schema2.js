import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function test() {
  const { data, error } = await supabase.from('leads').select('email_address').limit(1);
  if (error) {
    console.error("API error:", error.message);
  } else {
    console.log("Success! Columns exist in API cache.");
  }
}
test();
