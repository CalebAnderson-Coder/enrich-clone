// Check status of the synthetic Verifier test messages
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: msgs } = await supabase
  .from('agent_messages')
  .select('id,status,result,error,from_agent,to_agent,payload,created_at')
  .in('id', [34, 35])
  .order('id');

for (const msg of (msgs ?? [])) {
  console.log(`\nMessage ${msg.id} | status: ${msg.status}`);
  console.log('  result:', JSON.stringify(msg.result));
  console.log('  error:', msg.error);
}

// Check agent_state for the last_verdict
const { data: states } = await supabase
  .from('agent_state')
  .select('key,value,updated_at')
  .eq('agent_name', 'Verifier')
  .eq('brand_id', BRAND_ID)
  .like('key', 'last_verdict%');

console.log('\nVerifier state (last_verdict entries):', JSON.stringify(states, null, 2));
