// ============================================================
// Frontend Supabase Client — Direct cloud reads (Option A)
// No backend needed for data visualization
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://wzdhxnnpupbybxzbdrna.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6ZGh4bm5wdXBieWJ4emJkcm5hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY1NTQ3NCwiZXhwIjoyMDkxMjMxNDc0fQ.JTvIL7jaW83j5P0x4C3SiIBUP7yyGi5_UBNZNhFaJF4'; // Forced bypass for internal RLS

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
