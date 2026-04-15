// fix_ghl_phones.cjs — Fix existing GHL contacts: add +1 prefix to all US phone numbers
// Usage: node fix_ghl_phones.cjs
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const GHL_KEY = 'pit-5914c096-4b40-48ae-82b5-018862f5ee8f';
const GHL_LOCATION = 'uQPxZOmT4zVlMHfOGRw2';

function normalizeUSPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (raw.startsWith('+1')) return '+1' + digits.replace(/^1/, '');
  return '+1' + digits;
}

function needsFix(phone) {
  if (!phone) return false;
  // Already correct format: +1XXXXXXXXXX
  if (/^\+1\d{10}$/.test(phone)) return false;
  return true;
}

async function ghlGet(endpoint) {
  const res = await fetch(`https://services.leadconnectorhq.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${GHL_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL GET ${res.status}: ${text}`);
  }
  return res.json();
}

async function ghlPut(endpoint, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${endpoint}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GHL_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL PUT ${res.status}: ${text}`);
  }
  return res.json();
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  GHL PHONE FIX — Adding +1 to all US contacts    ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Step 1: Fetch all contacts from this location using search
  let allContacts = [];
  let nextPageUrl = null;
  let page = 1;

  // First request
  console.log(`📥 Fetching contacts (page ${page})...`);
  try {
    const data = await ghlGet(`/contacts/?locationId=${GHL_LOCATION}&limit=100`);
    const contacts = data.contacts || [];
    allContacts = allContacts.concat(contacts);
    nextPageUrl = data.meta?.nextPageUrl || null;
    
    // Follow pagination
    while (nextPageUrl) {
      page++;
      await delay(500);
      console.log(`📥 Fetching contacts (page ${page})...`);
      
      // Extract the path from nextPageUrl
      const urlObj = new URL(nextPageUrl);
      const pathAndQuery = urlObj.pathname + urlObj.search;
      
      const nextData = await ghlGet(pathAndQuery);
      const nextContacts = nextData.contacts || [];
      allContacts = allContacts.concat(nextContacts);
      nextPageUrl = nextData.meta?.nextPageUrl || null;
      
      if (nextContacts.length === 0) break;
    }
  } catch (err) {
    console.error('❌ Error fetching contacts:', err.message);
  }

  console.log(`\n📊 Total contacts in GHL: ${allContacts.length}\n`);

  // Step 2: Filter ONLY Empírika engine contacts (tagged), then check phones
  const empirikaContacts = allContacts.filter(c => {
    const tags = c.tags || [];
    return tags.includes('lead-automatizado') || tags.includes('empirika-engine') || tags.includes('google-maps');
  });
  console.log(`  🏷️  Empírika tagged contacts: ${empirikaContacts.length} (filtering out personal contacts)`);

  const toFix = empirikaContacts.filter(c => c.phone && needsFix(c.phone));
  const alreadyOk = empirikaContacts.filter(c => c.phone && !needsFix(c.phone));
  const noPhone = empirikaContacts.filter(c => !c.phone);

  console.log(`  ✅ Already correct (+1):  ${alreadyOk.length}`);
  console.log(`  🔧 Need +1 fix:          ${toFix.length}`);
  console.log(`  ⬜ No phone number:       ${noPhone.length}`);
  console.log();

  if (toFix.length === 0) {
    console.log('✅ All phones already have +1 prefix! Nothing to fix.\n');
    return;
  }

  // Step 3: Fix each contact
  let fixed = 0, errors = 0;

  for (const contact of toFix) {
    const oldPhone = contact.phone;
    const newPhone = normalizeUSPhone(oldPhone);
    const name = contact.firstName || contact.companyName || contact.id;

    if (!newPhone) {
      console.log(`  ⏭️  ${name} — phone "${oldPhone}" can't be normalized, skipping`);
      continue;
    }

    try {
      await ghlPut(`/contacts/${contact.id}`, {
        phone: newPhone
      });
      console.log(`  ✅ ${String(name).padEnd(40)} ${oldPhone} → ${newPhone}`);
      fixed++;
    } catch (err) {
      console.error(`  ❌ ${String(name).padEnd(40)} Error: ${err.message.substring(0, 80)}`);
      errors++;
    }

    await delay(300); // Rate limit protection
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log(`║  ✅ ${fixed} contacts updated with +1 prefix`);
  if (errors > 0)
  console.log(`║  ❌ ${errors} failed (see above)`);
  console.log('╚═══════════════════════════════════════════════════╝\n');
})();
