require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const testPhone = process.argv[2];

if (!testPhone) {
    console.error("❌ Por favor, provee un número de teléfono. Ejemplo: node insert_test_lead.js +1234567890");
    process.exit(1);
}

async function run() {
    const { data, error } = await supabase.from('smart_agency_leads').insert([{
        business_name: "La Carnicería de Prueba",
        industry: "Retail / Alimentos",
        city: "Madrid",
        phone: testPhone,
        pipeline_stage: "NEW_LEAD"
    }]).select();

    if (error) {
        console.error("❌ Error al insertar el lead:", error);
    } else {
        console.log("✅ Lead de prueba insertado con éxito!");
        console.log("Datos:", data[0]);
    }
}

run();
