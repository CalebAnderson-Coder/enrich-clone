import fs from 'fs';

async function extractBrand() {
  const url = 'https://api.firecrawl.dev/v1/scrape';
  const apiKey = 'fc-eac1599ed25044feb68df593f82e6a32';
  
  const payload = {
    url: 'https://empirikagroup.com/',
    formats: ['extract'],
    extract: {
      prompt: "Extract all brand identity information: Primary and secondary colors (in HEX), fonts/typography used, logo URLs (including svgs or imgs of the logo), button colors, background colors, the exact slogan or tagline, and overall design style for Empirika Group. Return as a detailed description."
    }
  };

  console.log("Scraping Empireika Group for brand assets via Firecrawl...");

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    console.log("--- RESULT ---");
    console.dir(result, { depth: null });
  } catch (err) {
    console.error(err);
  }
}

extractBrand();
