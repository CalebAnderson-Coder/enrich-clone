import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.from('agent_misions').insert([
        {
            instruction: 'Crea un archivo llamado hola_mundo.txt que diga "Hola, Claw funciona correctamente" en el directorio raíz.',
            status: 'PENDING'
        }
    ]).select();

    if (error) {
        console.error('Error inserting test mission:', error);
    } else {
        console.log('Inserted test mission successfully:', data[0].id);
    }
}
run();
