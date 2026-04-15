// scrape_emails.cjs — Firecrawl email extractor for all 23 prospects
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Extract emails from text using regex
function extractEmails(text) {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = text.match(emailRegex) || [];
  return [...new Set(found)].filter(e => 
    !e.includes('example.com') && 
    !e.includes('sentry') &&
    !e.includes('wix') &&
    !e.includes('schema.org') &&
    !e.includes('.png') &&
    !e.includes('.jpg') &&
    !e.includes('.svg') &&
    !e.endsWith('.webp') &&
    !e.includes('googleapis') &&
    !e.includes('wordpress') &&
    !e.includes('gravatar') &&
    !e.includes('cloudflare') &&
    !e.includes('webpack') &&
    !e.includes('babel') &&
    !e.includes('2x') &&
    e.length < 60 && e.length > 5
  );
}

async function scrapeWithFirecrawl(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: false,
      timeout: 15000
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  return data?.data?.markdown || '';
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('🔥 Firecrawl Email Extractor — 23 prospects\n');

  // 1. Get all prospects (without email column since it doesn't exist)
  const { data: prospects, error } = await sb.from('prospects')
    .select('id, business_name, website, phone, raw_data');
  if (error) { console.error('DB Error:', error); return; }

  console.log(`Found ${prospects.length} prospects\n`);

  const results = [];
  let foundReal = 0, inferred = 0, failed = 0;

  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    
    // Check if we already have email in raw_data
    const existingEmail = p.raw_data?.extracted_email;
    if (existingEmail) {
      console.log(`[${i+1}/${prospects.length}] ${p.business_name} — already has: ${existingEmail}`);
      results.push({ id: p.id, name: p.business_name, email: existingEmail, source: 'existing' });
      foundReal++;
      continue;
    }

    if (!p.website) {
      console.log(`[${i+1}/${prospects.length}] ${p.business_name} — NO website`);
      results.push({ id: p.id, name: p.business_name, email: null, source: 'no_website' });
      failed++;
      continue;
    }

    console.log(`[${i+1}/${prospects.length}] ${p.business_name} — scraping ${p.website}...`);
    
    try {
      // Scrape homepage
      const markdown = await scrapeWithFirecrawl(p.website);
      let emails = extractEmails(markdown);

      // If no emails on homepage, try /contact
      if (emails.length === 0) {
        const contactUrl = p.website.replace(/\/$/, '') + '/contact';
        console.log(`  → Trying /contact...`);
        try {
          const contactMd = await scrapeWithFirecrawl(contactUrl);
          emails = extractEmails(contactMd);
        } catch (e) {
          // Try /contact-us
          try {
            const contactUs = p.website.replace(/\/$/, '') + '/contact-us';
            console.log(`  → Trying /contact-us...`);
            const cuMd = await scrapeWithFirecrawl(contactUs);
            emails = extractEmails(cuMd);
          } catch (e2) {
            // silence
          }
        }
      }

      if (emails.length > 0) {
        // Pick best email
        const bestEmail = emails.find(e => /^(info|contact|hello|office|admin|sales|service)@/i.test(e)) || emails[0];
        console.log(`  ✅ FOUND: ${bestEmail} (all: ${emails.join(', ')})`);
        results.push({ id: p.id, name: p.business_name, email: bestEmail, allEmails: emails, source: 'firecrawl' });
        foundReal++;
      } else {
        // Fallback: infer info@domain
        const domain = new URL(p.website).hostname.replace('www.', '');
        const inferredEmail = `info@${domain}`;
        console.log(`  ⚠️  No email found → inferred: ${inferredEmail}`);
        results.push({ id: p.id, name: p.business_name, email: inferredEmail, source: 'inferred' });
        inferred++;
      }
    } catch (err) {
      console.error(`  ❌ Firecrawl error: ${err.message.substring(0, 100)}`);
      try {
        const domain = new URL(p.website).hostname.replace('www.', '');
        const inferredEmail = `info@${domain}`;
        console.log(`  ⚠️  Fallback inferred: ${inferredEmail}`);
        results.push({ id: p.id, name: p.business_name, email: inferredEmail, source: 'inferred' });
        inferred++;
      } catch (e) {
        results.push({ id: p.id, name: p.business_name, email: null, source: 'error' });
        failed++;
      }
    }

    await delay(600);
  }

  // 2. Summary
  console.log('\n========================================');
  console.log('📊 RESULTS');
  console.log('========================================\n');

  for (const r of results) {
    const emoji = r.source === 'firecrawl' ? '✅' : r.source === 'inferred' ? '⚠️' : r.source === 'existing' ? '📌' : '❌';
    console.log(`${emoji} ${r.name.padEnd(40)} → ${r.email || 'NONE'} [${r.source}]`);
  }

  console.log(`\n✅ Real emails (Firecrawl): ${foundReal}`);
  console.log(`⚠️  Inferred (info@domain): ${inferred}`);
  console.log(`❌ Failed: ${failed}`);

  // 3. Save to Supabase (store in raw_data.extracted_email)
  console.log('\n--- SAVING TO SUPABASE ---\n');
  let updated = 0;
  for (const r of results) {
    if (r.email) {
      const currentRaw = prospects.find(p => p.id === r.id)?.raw_data || {};
      currentRaw.extracted_email = r.email;
      currentRaw.email_source = r.source;
      if (r.allEmails) currentRaw.all_emails = r.allEmails;

      const { error: updateErr } = await sb.from('prospects')
        .update({ raw_data: currentRaw })
        .eq('id', r.id);
      
      if (updateErr) {
        console.error(`  ❌ ${r.name}: ${updateErr.message}`);
      } else {
        console.log(`  ✅ ${r.name} → ${r.email}`);
        updated++;
      }
    }
  }

  console.log(`\n🎯 Updated ${updated}/${prospects.length} prospects with email addresses.`);
})();
