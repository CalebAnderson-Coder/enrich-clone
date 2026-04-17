// ============================================================
// tools/apifyGoogleMaps.js — Google Maps Lead Scraper via Apify
// Actor: compass~crawler-google-places ($0.004/place FREE tier)
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const APIFY_BASE = 'https://api.apify.com/v2';

/**
 * Call an Apify actor and wait for results
 */
async function runApifyActor(actorId, input, token) {
  if (!token) {
    throw new Error('APIFY_API_TOKEN not configured. Get one at https://apify.com/sign-up');
  }

  // Start the actor run
  const startRes = await fetch(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token}&waitForFinish=120`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Apify actor start failed (${startRes.status}): ${errText}`);
  }

  const runData = await startRes.json();
  const datasetId = runData.data?.defaultDatasetId;

  if (!datasetId) {
    throw new Error('No dataset returned from Apify run');
  }

  // Fetch results from dataset
  const dataRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json&limit=100`
  );

  if (!dataRes.ok) {
    throw new Error(`Failed to fetch Apify dataset: ${dataRes.status}`);
  }

  return await dataRes.json();
}

export const scrapeGoogleMaps = new Tool({
  name: 'scrape_google_maps',
  description: `Search Google Maps for businesses matching a query in a specific location. Returns business name, address, phone, website, rating, review count, and Google Maps URL. Use for lead prospection of Latino-owned service businesses in US metro areas.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for Google Maps (e.g. "latino landscaping Miami FL" or "remodelacion Houston TX")',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to scrape (default 20, max 100)',
      },
      minReviews: {
        type: 'number',
        description: 'Minimum number of reviews to filter by (default 20)',
      },
      minRating: {
        type: 'number',
        description: 'Minimum star rating to filter by (default 4.5)',
      },
    },
    required: ['query'],
  },
  fn: async (args) => {
    const { query, maxResults = 20, minReviews = 20, minRating = 4.5 } = args;
    const token = process.env.APIFY_API_TOKEN;

    console.log(`  🗺️  [GoogleMaps] Scraping: "${query}" (max ${maxResults})`);

    if (!token) {
      // Development mock mode
      console.log(`  ⚠️  MOCK MODE — Set APIFY_API_TOKEN for real scraping`);
      return JSON.stringify({
        mock: true,
        note: 'Set APIFY_API_TOKEN in .env for real Google Maps scraping',
        results: [
          {
            name: `Mock: Miguel's Landscaping`,
            address: '1234 NW 5th St, Miami, FL 33125',
            phone: '+1-305-555-0123',
            website: 'http://miguelslandscaping.com',
            rating: 4.8,
            reviewCount: 67,
            googleMapsUrl: 'https://maps.google.com/?cid=mock123',
            lastReviewDate: new Date().toISOString(),
          },
          {
            name: `Mock: Rodriguez Home Remodeling`,
            address: '5678 SW 8th St, Miami, FL 33144',
            phone: '+1-305-555-0456',
            website: null,
            rating: 4.6,
            reviewCount: 34,
            googleMapsUrl: 'https://maps.google.com/?cid=mock456',
            lastReviewDate: new Date().toISOString(),
          },
        ],
      });
    }

    try {
      const results = await runApifyActor('compass~crawler-google-places', {
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: Math.max(1, Math.floor(Number(maxResults) || 20)),
        language: 'en',
        reviewsSort: 'newest',
        maxReviews: 5, // Just enough to check recency
        skipClosedPlaces: true,
        scrapeReviewerName: false,
        // Filters
        minScore: Number(minRating) || 4.0,
      }, token);

      // Normalize and filter results
      const leads = results
        .filter(place => {
          const reviews = place.totalScore ? place.reviewsCount || 0 : 0;
          return reviews >= minReviews && (place.totalScore || 0) >= minRating;
        })
        .map(place => ({
          name: place.title || place.name || 'Unknown',
          address: place.address || '',
          phone: place.phone || '',
          website: place.website || place.url || null,
          rating: place.totalScore || 0,
          reviewCount: place.reviewsCount || 0,
          googleMapsUrl: place.url || place.googleUrl || '',
          categories: place.categories || [],
          imageUrl: place.imageUrl || null,
          openingHours: place.openingHours || null,
          lastReviewDate: place.reviews?.[0]?.publishAt || null,
          placeId: place.placeId || null,
        }));

      console.log(`  ✅ [GoogleMaps] Found ${results.length} total → ${leads.length} passed filters`);

      return JSON.stringify({
        mock: false,
        query,
        totalScraped: results.length,
        totalQualified: leads.length,
        results: leads,
      });
    } catch (err) {
      console.error(`  ❌ [GoogleMaps] Error: ${err.message}`);
      return JSON.stringify({ error: err.message, query });
    }
  },
});
