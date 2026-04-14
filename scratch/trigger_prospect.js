import fetch from 'node-fetch';

async function trigger() {
  const port = 3001;
  const secretKey = 'sk_live_51MxxXYZ123SecureEnrichToken2026';
  
  console.log(`🚀 [Extreme-Automation] Triggering Scouter on port ${port}...`);
  
  const response = await fetch(`http://localhost:${port}/api/prospect`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secretKey}`
    },
    body: JSON.stringify({
      metro: 'Miami FL',
      niche: 'Roofing',
      limit: 35,
      autoEnrich: true
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Error (${response.status}):`, text);
    return;
  }
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
}

trigger().catch(console.error);
