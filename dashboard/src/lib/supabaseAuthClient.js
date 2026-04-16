import { createClient } from '@supabase/supabase-js';

// Public anon key only — no service_role ever reaches the browser.
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.error('[supabaseAuthClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in the dashboard build env.');
}

export const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
