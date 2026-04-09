// ============================================================
// tools/brightDataMetaAds.js — Meta Ad Library Checker via Bright Data
// Scrapes Facebook Ad Library to check if a business runs ads
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const BD_SCRAPE = 'https://api.brightdata.com/request';

/**
 * Check Meta Ad Library for active ads from a business
 */
async function checkAdLibrary(businessName, country, token) {
  const searchUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(businessName)}&search_type=keyword_unordered`;

  const res = await fetch(BD_SCRAPE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: searchUrl,
      format: 'raw',
      zone: 'web_unlocker1',
    }),
  });

  if (!res.ok) {
    throw new Error(`Bright Data Ad Library scrape failed (${res.status})`);
  }

  const html = await res.text();
  return parseAdLibraryResults(html, businessName);
}

/**
 * Parse the Ad Library HTML for ad counts
 */
function parseAdLibraryResults(html, businessName) {
  // Check for "no results" indicators
  const noResults = html.includes('No ads match') ||
    html.includes('There are no ads') ||
    html.includes('no_results') ||
    html.includes('"numResults":0');

  if (noResults) {
    return { hasActiveAds: false, adCount: 0, platforms: [] };
  }

  // Try to extract ad count from JSON data embedded in page
  const countMatch = html.match(/"numResults"\s*:\s*(\d+)/);
  const adCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Check for individual ad cards
  const adCardCount = (html.match(/data-testid="ad_card"/g) || []).length;
  const finalCount = adCount || adCardCount;

  // Detect platforms
  const platforms = [];
  if (html.includes('facebook') || html.includes('Facebook')) platforms.push('facebook');
  if (html.includes('instagram') || html.includes('Instagram')) platforms.push('instagram');
  if (html.includes('messenger') || html.includes('Messenger')) platforms.push('messenger');

  return {
    hasActiveAds: finalCount > 0,
    adCount: finalCount,
    platforms: platforms.length > 0 ? platforms : ['unknown'],
  };
}

export const checkMetaAds = new Tool({
  name: 'check_meta_ads',
  description: `Check if a business is running paid ads on Meta (Facebook/Instagram). Searches Meta's Ad Library for active advertisements. Returns ad count and whether they have active campaigns. Businesses NOT running ads = higher opportunity for Empírika.`,
  parameters: {
    type: 'object',
    properties: {
      businessName: {
        type: 'string',
        description: 'Business name to search for in Meta Ad Library',
      },
      country: {
        type: 'string',
        description: 'Country code (default "US")',
      },
    },
    required: ['businessName'],
  },
  fn: async (args) => {
    const { businessName, country = 'US' } = args;
    const token = process.env.BRIGHTDATA_API_TOKEN;

    console.log(`  📢 [MetaAds] Checking: "${businessName}"`);

    if (!token) {
      console.log(`  ⚠️  MOCK MODE — Set BRIGHTDATA_API_TOKEN for real checks`);
      return JSON.stringify({
        mock: true,
        businessName,
        hasActiveAds: false,
        adCount: 0,
        score_contribution: 10,
        note: 'Set BRIGHTDATA_API_TOKEN for real checks',
      });
    }

    try {
      const result = await checkAdLibrary(businessName, country, token);

      return JSON.stringify({
        mock: false,
        businessName,
        hasActiveAds: result.hasActiveAds,
        adCount: result.adCount,
        platforms: result.platforms,
        // Score: 10 points if NO ads (good for us), 0 if they already run ads
        score_contribution: result.hasActiveAds ? 0 : 10,
      });

    } catch (err) {
      console.error(`  ❌ [MetaAds] Error: ${err.message}`);
      return JSON.stringify({
        error: err.message,
        businessName,
        hasActiveAds: false,
        score_contribution: 10,
      });
    }
  },
});
