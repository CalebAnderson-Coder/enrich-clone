// ============================================================
// tools/brightDataGoogleMaps.js — Google Maps Lead Scraper via Bright Data
// Uses SERP API for Google Maps search results
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const BD_API = 'https://api.brightdata.com/serp/req';

/**
 * Call Bright Data SERP API for Google Maps results
 */
async function searchGoogleMaps(query, token, maxResults = 20) {
  const res = await fetch(BD_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      search_engine: 'google_maps',
      country: 'us',
      language: 'en',
      num: Math.min(maxResults, 100),
      zone: process.env.BRIGHTDATA_SERP_ZONE || 'serp_api1',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bright Data SERP failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Fallback removed to prevent fake lead creation. 
 * Gemini hallucinated businesses when the scraper failed.
 */
async function searchGoogleFallback(query, token, maxResults = 20) {
  throw new Error("Bright Data SERP API check failed (Check BRIGHTDATA_SERP_ZONE or API quota restrictions). Aborting to prevent fake data generation.");
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
    const token = process.env.BRIGHTDATA_API_TOKEN;

    console.log(`  🗺️  [GoogleMaps] Scraping: "${query}" (max ${maxResults})`);

    if (!token) {
      console.log(`  ⚠️  MOCK MODE — Set BRIGHTDATA_API_TOKEN for real scraping`);
      return JSON.stringify({
        mock: true,
        note: 'Set BRIGHTDATA_API_TOKEN in .env for real Google Maps scraping',
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
      let rawResults;

      // Try Google Maps SERP first
      try {
        rawResults = await searchGoogleMaps(query, token, maxResults);
      } catch (mapsErr) {
        console.log(`  ⚠️  Maps SERP failed, trying Google fallback: ${mapsErr.message}`);
        rawResults = await searchGoogleFallback(query, token, maxResults);
      }

      // Normalize results — Bright Data SERP returns different shapes
      const places = Array.isArray(rawResults)
        ? rawResults
        : rawResults?.organic || rawResults?.local_results || rawResults?.places || [];

      // Map and filter
      const leads = places
        .map(place => ({
          name: place.title || place.name || place.business_name || 'Unknown',
          address: place.address || place.snippet || '',
          phone: place.phone || place.phone_number || '',
          website: place.website || place.url || place.link || null,
          rating: parseFloat(place.rating) || 0,
          reviewCount: parseInt(place.reviews || place.review_count || place.reviews_count || 0, 10),
          googleMapsUrl: place.maps_url || place.place_url || place.link || '',
          categories: place.category ? [place.category] : (place.categories || []),
          imageUrl: place.thumbnail || place.image || null,
          openingHours: place.hours || place.opening_hours || null,
          placeId: place.place_id || place.data_id || null,
        }))
        .filter(lead => {
          return lead.reviewCount >= minReviews && lead.rating >= minRating;
        });

      console.log(`  ✅ [GoogleMaps] Found ${places.length} total → ${leads.length} passed filters`);

      return JSON.stringify({
        mock: false,
        query,
        totalScraped: places.length,
        totalQualified: leads.length,
        results: leads,
      });
    } catch (err) {
      console.error(`  ❌ [GoogleMaps] Error: ${err.message}`);
      return JSON.stringify({ error: err.message, query });
    }
  },
});
