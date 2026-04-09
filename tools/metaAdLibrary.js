// ============================================================
// tools/metaAdLibrary.js — Meta Ad Library Checker via Apify
// Actor: whoareyouanas/meta-ad-scraper ($0.01/ad)
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const APIFY_BASE = 'https://api.apify.com/v2';

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
    const token = process.env.APIFY_API_TOKEN;

    console.log(`  📢 [MetaAds] Checking: "${businessName}"`);

    if (!token) {
      console.log(`  ⚠️  MOCK MODE — Set APIFY_API_TOKEN for real Meta Ad Library checks`);
      return JSON.stringify({
        mock: true,
        businessName,
        hasActiveAds: false,
        adCount: 0,
        score_contribution: 10, // No ads = opportunity
        note: 'Set APIFY_API_TOKEN for real checks',
      });
    }

    try {
      const runRes = await fetch(
        `${APIFY_BASE}/acts/whoareyouanas~meta-ad-scraper/runs?token=${token}&waitForFinish=60`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQuery: businessName,
            countryCode: country,
            adActiveStatus: 'active',
            maxAds: 5, // Just check if any exist
          }),
        }
      );

      if (!runRes.ok) {
        throw new Error(`Apify Meta Ad Library call failed: ${runRes.status}`);
      }

      const runData = await runRes.json();
      const datasetId = runData.data?.defaultDatasetId;

      if (datasetId) {
        const dataRes = await fetch(
          `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json&limit=10`
        );
        const ads = await dataRes.json();

        const hasActiveAds = ads.length > 0;

        return JSON.stringify({
          mock: false,
          businessName,
          hasActiveAds,
          adCount: ads.length,
          platforms: [...new Set(ads.map(a => a.platform || 'unknown'))],
          // Score: 10 points if NO ads (good for us), 0 if they already run ads
          score_contribution: hasActiveAds ? 0 : 10,
        });
      }

      return JSON.stringify({
        mock: false,
        businessName,
        hasActiveAds: false,
        adCount: 0,
        score_contribution: 10,
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
