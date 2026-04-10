import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function test() {
  const { data, error } = await supabase.from('leads').select('business_name').limit(1);
  if (error) {
    console.error("API error getting business_name:", error.message);
  } else {
    console.log("Success getting business_name. Now trying email_address...");
    const { data: d2, error: e2 } = await supabase.from('leads').select('email_address').limit(1);
    if (e2) {
      console.error("API error getting email_address:", e2.message);
    } else {
      console.log("Success getting email_address!");
    }
  }
}
test();
