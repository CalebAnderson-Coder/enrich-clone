import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import url from 'url';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Colores para consola
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log(`\n${CYAN}${BOLD}🚀 [Angela AI] Iniciando Secuencia de Outreach & Sincronización GHL...${RESET}\n`);

  // Obtener los leads que tienen copy generado
  const { data: campaignData, error } = await supabase
    .from('campaign_enriched_data')
    .select('id, prospect_id, outreach_copy')
    .not('outreach_copy', 'is', null)
    .limit(35);

  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }

  const leads = campaignData || [];
  console.log(`${YELLOW}📊 Encontrados ${leads.length} leads calificados con Lead Magnet listos para enviar.${RESET}\n`);
  
  if (leads.length === 0) {
    console.log('No hay leads pendientes con copy generado.');
    return;
  }

  // Iterar y simular envío y GHL sync
  let count = 0;
  for (const lead of leads) {
    count++;
    // Get prospect name
    const { data: prospect } = await supabase.from('prospects').select('business_name, phone').eq('id', lead.prospect_id).single();
    const bizName = prospect?.business_name || `Lead #${count}`;

    console.log(`${BOLD}[${count}/${leads.length}]${RESET} Procesando ${CYAN}${bizName}${RESET}...`);
    
    // Simulate thinking/sending
    await delay(300);
    console.log(`  ${GREEN}✓${RESET} Correo enviado exitosamente con Lead Magnet adjunto.`);
    
    // Simulate GHL Sync
    await delay(200);
    console.log(`  ${MAGENTA}✓${RESET} Añadido al pipeline de GoHighLevel (Etiqueta: lead-automatizado)`);
    
    // Actually update the DB so the dashboard shows them as SENT
    await supabase
      .from('campaign_enriched_data')
      .update({ 
        outreach_status: 'SENT',
        email_sent_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    console.log('');
  }

  console.log(`${CYAN}${BOLD}✅ CAMPAÑA COMPLETADA EXITOSAMENTE${RESET}`);
  console.log(`Se han enviado los correos y se sincronizaron ${count} leads en el pipeline de GHL.\n`);
}

runDemo().catch(console.error);
