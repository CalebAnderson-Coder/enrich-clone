import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const dummyPhone = '+19998887777';

async function run() {
    console.log("🛠️ 1/2 Inyectando Lead 'Panadería El Sol' en la base de datos...");
    // Borramos primero por si se corrió antes
    await supabase.from('smart_agency_leads').delete().eq('phone', dummyPhone);

    const { error: insertError } = await supabase.from('smart_agency_leads').insert([{
        business_name: "Panadería El Sol (Prueba)",
        industry: "Retail / Alimentos",
        city: "Virtualización",
        phone: dummyPhone,
        pipeline_stage: "NEW_LEAD"
    }]);

    if(insertError) {
        console.error("Error inyectando el lead: ", insertError);
        return;
    }

    console.log("✅ Lead inyectado. Pipeline original: NEW_LEAD");
    console.log("\n📲 2/2 Simulando SMS entrante al Webhook de tu nueva Supabase Edge Function...");
    console.log(`Mensaje enviado: "¿Me puedes dar el enlace de pago de la página que me armaste?"`);
    
    const formData = new URLSearchParams();
    formData.append("From", dummyPhone);
    formData.append("Body", "¿Me puedes dar el enlace de pago de la página que me armaste?");
    
    const edgeFunctionUrl = 'https://pzxlgpnnizdambzepngf.supabase.co/functions/v1/twilio-webhook';
    
    try {
        const response = await fetch(edgeFunctionUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: formData.toString()
        });

        const xmlText = await response.text();
        console.log("\n🤖 RESPUESTA CRUDA DEL AGENTE AI (En formato XML de Twilio):");
        console.log("-----------------------------------------------------------------");
        console.log(xmlText);
        console.log("-----------------------------------------------------------------");
        
        // Vamos a revisar si la etapa en la base de datos cambió
        const { data: leadNow } = await supabase.from('smart_agency_leads').select('pipeline_stage').eq('phone', dummyPhone).single();
        console.log(`\nEstado actual del Pipeline en tu CRM BDD: ${leadNow?.pipeline_stage}`);
        console.log("\n🎉 SIMULACIÓN COMPLETADA CON ÉXITO.");
    } catch(err) {
         console.error("Fallo la llamada http al webhook: ", err);
    }
}

run();
