// One-shot script: insert a synthetic verify_email_draft for the Verifier smoke test
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or service key');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const draft = `Hola Carlos,

Soy Angela de Empírika, una agencia digital especializada en empresas de HVAC en Miami.

Vi que su empresa ha crecido bastante en los últimos años y quería saber si están aprovechando al máximo Google Ads y SEO para capturar más leads en temporada alta.

Tenemos clientes en HVAC Miami que aumentaron sus llamadas en un 40% en 90 días.

¿Tendría 15 minutos el jueves por la mañana para conversar?

Saludos,
Angela`;

const { data, error } = await supabase
  .from('agent_messages')
  .insert({
    brand_id:   BRAND_ID,
    from_agent: 'test_runner',
    to_agent:   'Verifier',
    payload: {
      type:          'verify_email_draft',
      draft_text:    draft,
      lead_id:       'test-lead-phase63',
      lead_industry: 'HVAC',
      lead_city:     'Miami',
    },
    status: 'pending',
  })
  .select()
  .single();

if (error) {
  console.error('INSERT ERROR:', error.message);
  process.exit(1);
}
console.log('Inserted synthetic message — id:', data.id);
