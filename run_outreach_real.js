import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { sendEmail } from './tools/email.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runRealOutreach() {
  console.log(`\n${CYAN}${BOLD}🚀 [Angela AI] Iniciando Secuencia REAL de Outreach & Sincronización GHL...${RESET}\n`);

  // Obtener prospectos que tengan copy generado. 
  // No filtramos por status SENT para re-enviar y forzar sync en esta prueba, o podrías agregar: .neq('outreach_status', 'SENT')
  const { data: campaignData, error } = await supabase
    .from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data')
    .not('lead_magnets_data', 'is', null)
    .limit(30);

  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }

  const leads = campaignData || [];
  console.log(`${YELLOW}📊 Encontrados ${leads.length} leads listos para enviar.${RESET}\n`);
  
  if (leads.length === 0) {
    console.log('No hay leads pendientes con copy generado.');
    return;
  }

  let count = 0;
  for (const lead of leads) {
    count++;
    
    // Obtenemos los campos del prospecto original
    const { data: prospect } = await supabase
      .from('prospects')
      .select('*')
      .eq('id', lead.prospect_id)
      .single();

    const bizName = prospect?.business_name || `Lead #${count}`;
    
    // Extraer correo de envío
    // Intentamos buscarlo en prospect o raw_data
    let realEmail = prospect?.email || prospect?.email_address;
    
    // Si no lo tenemos, pero tenemos el website, inferiremos el correo corporativo (ej: info@dominio.com)
    if (!realEmail && prospect?.website) {
      try {
        const urlParams = new URL(prospect.website);
        let domain = urlParams.hostname.replace('www.', '');
        realEmail = `info@${domain}`;
      } catch (e) {
        // Fallback or bad url
      }
    }

    const emailTo = realEmail || process.env.SMTP_USER;

    console.log(`${BOLD}[${count}/${leads.length}]${RESET} Procesando ${CYAN}${bizName}${RESET}...`);

    let subject = lead.lead_magnets_data?.angela_email_subject || 'Propuesta de Mejora Digital';
    let html_body = lead.lead_magnets_data?.angela_email_body || 'Hola, adjunto una mejora digital...';

    // Formatear body mínimo en html si viene en texto simple
    html_body = `<p>${html_body.replace(/\n/g, '<br/>')}</p>`;

    console.log(`  ${YELLOW}➔${RESET} Emitiendo correo a: ${CYAN}${emailTo}${RESET}`);
    
    const sendResultStr = await sendEmail.fn({
      to: emailTo,
      subject: subject,
      html_body: html_body
    });

    const sendResult = JSON.parse(sendResultStr);

    if (sendResult.status === 'sent' || sendResult.status === 'mock_sent') {
      console.log(`  ${GREEN}✓${RESET} Correo enviado (${sendResult.status}). Id: ${sendResult.email_id || 'mock'}`);
      
      const { syncToGHL } = await import('./tools/email.js');
      const prospectData = prospect || { business_name: bizName };
      await syncToGHL(emailTo, prospectData);

      // Si inferimos el correo, actualizamos el prospect/lead en la BD también para que no se pierda
      if (emailTo !== prospect?.email) {
          await supabase.from('prospects').update({ email: emailTo }).eq('id', prospect.id);
      }

      // 3. Mark as SENT in dashboard and link GHL tag
      await supabase
        .from('campaign_enriched_data')
        .update({ outreach_status: 'SENT', ghl_tag: 'lead-automatizado', email_sent_at: new Date().toISOString() })
        .eq('id', lead.id);

      console.log(`  ${MAGENTA}✓${RESET} Sincronizado en GHL y Dashboard (SENT).`);

    } else {
      console.error(`  ${MAGENTA}X${RESET} Error enviando correo:`, sendResult.error);
    }

    await delay(1000); // esperar 1 sec entre correos
  }

  console.log(`\n${CYAN}${BOLD}✅ CAMPAÑA REAL COMPLETADA EXITOSAMENTE${RESET}`);
  console.log(`Se enviaron los correos, y el trigger de post-envío procesó las sincronizaciones.\n`);
}

runRealOutreach().catch(console.error);
