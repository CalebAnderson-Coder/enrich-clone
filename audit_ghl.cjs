const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: prospects } = await sb.from('prospects').select('id, business_name, raw_data');
  const { data: campaigns } = await sb.from('campaign_enriched_data')
    .select('id, prospect_id, lead_magnets_data, outreach_status');

  console.log('=== PRE-SEND READINESS CHECK ===\n');
  
  let ready = 0, noEmail = 0, noCopy = 0, noCampaign = 0;

  for (const p of prospects) {
    const email = p.raw_data?.extracted_email;
    const camp = campaigns.find(c => c.prospect_id === p.id);
    const hasSubject = camp?.lead_magnets_data?.angela_email_subject;
    const hasBody = camp?.lead_magnets_data?.angela_email_body;

    if (!email) {
      console.log(`❌ ${p.business_name.padEnd(40)} — NO EMAIL`);
      noEmail++;
    } else if (!camp) {
      console.log(`❌ ${p.business_name.padEnd(40)} — NO CAMPAIGN RECORD`);
      noCampaign++;
    } else if (!hasSubject || !hasBody) {
      console.log(`❌ ${p.business_name.padEnd(40)} — NO ANGELA COPY (status: ${camp.outreach_status})`);
      noCopy++;
    } else {
      console.log(`✅ ${p.business_name.padEnd(40)} → ${email} | Subject: "${hasSubject.substring(0, 50)}..."`);
      ready++;
    }
  }

  console.log(`\n📊 SUMMARY:`);
  console.log(`  ✅ Ready to send: ${ready}`);
  console.log(`  ❌ No email: ${noEmail}`);
  console.log(`  ❌ No campaign: ${noCampaign}`);
  console.log(`  ❌ No Angela copy: ${noCopy}`);
})();
