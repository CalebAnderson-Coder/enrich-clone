import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const leadId = 'a4cd9fda-9bfe-42a0-8bea-02e2ecc6e875';

const { data: camp } = await supabase
  .from('campaign_enriched_data')
  .select('outreach_copy')
  .eq('lead_id', leadId)
  .single();

if (camp?.outreach_copy) {
  // Replace "Hola" with "Hi" to enforce English-only rule
  const fixed = camp.outreach_copy.replace(/^Hola /gm, 'Hi ');
  const { error } = await supabase
    .from('campaign_enriched_data')
    .update({ outreach_copy: fixed })
    .eq('lead_id', leadId);
  console.log(error ? 'Error: ' + error.message : `Fixed! Replaced "Hola" with "Hi" for Garcia Landscaping (Orlando)`);
} else {
  console.log('Lead not found in campaign data');
}
