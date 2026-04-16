import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WEBHOOK = 'https://pzxlgpnnizdambzepngf.supabase.co/functions/v1/twilio-webhook';
const PHONE = '+19998887777';

async function sendSms(message) {
    const form = new URLSearchParams();
    form.append("From", PHONE);
    form.append("Body", message);
    const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const xml = await r.text();
    const match = xml.match(/<Message>(.*?)<\/Message>/s);
    return match ? match[1] : "(sin respuesta)";
}

async function run() {
    // Reset lead
    await supabase.from('smart_agency_leads').delete().eq('phone', PHONE);
    await supabase.from('smart_agency_leads').insert([{
        business_name: "Panadería El Sol",
        industry: "Alimentos",
        city: "Madrid",
        phone: PHONE,
        pipeline_stage: "NEW_LEAD"
    }]);
    console.log("✅ Lead inyectado.\n");

    const tests = [
        { label: "🔗 TEST 1 — Pedir la demo", msg: "Oye quiero ver la página que me hicieron" },
        { label: "💳 TEST 2 — Intención de pago", msg: "Me convenciste, quiero pagar ya, dame el link" },
        { label: "📅 TEST 3 — Pedir reunión", msg: "Prefiero hablar por zoom, me agendas una llamada?" },
    ];

    for (const t of tests) {
        console.log(t.label);
        console.log(`   → Cliente: "${t.msg}"`);
        const reply = await sendSms(t.msg);
        console.log(`   ← Agente: "${reply}"`);
        console.log("");
    }

    // Check final pipeline stage
    const { data } = await supabase.from('smart_agency_leads').select('pipeline_stage').eq('phone', PHONE).single();
    console.log(`📊 Pipeline final en CRM: ${data?.pipeline_stage}`);
}

run();
