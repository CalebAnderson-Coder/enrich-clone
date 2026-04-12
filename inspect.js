require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkData() {
  const { data, error } = await supabase.from('leads').select('*').limit(5);
  console.log("Error:", error);
  console.log("Data count:", data ? data.length : 0);
  if (data && data.length > 0) {
    console.log("Sample lead:", JSON.stringify(data[0], null, 2));
  }
}
checkData();
