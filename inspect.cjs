require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Using anon key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkData() {
  const { data, error } = await supabase.from('leads').select('*').limit(5);
  console.log("Error using anon key:", error);
  console.log("Data count using anon key:", data ? data.length : 0);
}
checkData();
