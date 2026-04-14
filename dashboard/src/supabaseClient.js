import { createClient } from '@supabase/supabase-js';

// Usar variables de entorno de Vite o valores predeterminados (fallback para producción en Render sin config)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://wzdhxnnpupbybxzbdrna.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6ZGh4bm5wdXBieWJ4emJkcm5hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY1NTQ3NCwiZXhwIjoyMDkxMjMxNDc0fQ.JTvIL7jaW83j5P0x4C3SiIBUP7yyGi5_UBNZNhFaJF4';


export const supabase = (supabaseUrl && supabaseAnonKey) ? createClient(supabaseUrl, supabaseAnonKey) : null;
