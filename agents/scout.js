// ============================================================
// agents/scout.js — Lead Prospection & Qualification Agent
// The first agent in the MEGA Profiling pipeline
// ============================================================

import { Agent } from '../lib/AgentRuntime.js';
import { checkInstagram } from '../tools/brightDataInstagram.js';
import { checkMetaAds } from '../tools/brightDataMetaAds.js';
import { searchWeb, fetchPage, checkPageSpeed } from '../tools/webResearch.js';
import { saveLead } from '../tools/database.js';

/**
 * Helper to wrap an async function with timeout and retries using Promise.race.
 * @param {Function} fn - The async function to call (should accept no arguments).
 * @param {string} operationName - Descriptive name for logging.
 * @param {number} maxRetries - Maximum number of attempts (default 3).
 * @param {number} timeoutMs - Timeout per attempt in milliseconds (default 8000).
 * @returns {Promise<any>} Result of the function or throws after retries.
 */
async function withRetryAndTimeout(fn, operationName, maxRetries = 3, timeoutMs = 8000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      );
      const result = await Promise.race([fn(), timeoutPromise]);
      console.log(`[${operationName}] Intento ${attempt}/${maxRetries} exitoso`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[${operationName}] Intento ${attempt}/${maxRetries} falló: ${err.message}`);
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise(res => setTimeout(res, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw new Error(`[${operationName}] Falló después de ${maxRetries} intentos. Último error: ${lastError.message}`);
}

/**
 * Wrapper para searchWeb que incluye reintentos y timeout.
 */
async function safeSearchWeb(query, numResults = 10) {
  return withRetryAndTimeout(
    () => searchWeb({ query, num_results: numResults }),
    'BUSCAR_WEB',
    3,
    8000
  );
}

/**
 * Wrapper para fetchPage con reintentos y timeout.
 */
async function safeFetchPage(url) {
  return withRetryAndTimeout(
    () => fetchPage({ url }),
    'FETCH_PAGE',
    2,
    10000
  );
}

/**
 * Wrapper para checkPageSpeed con reintentos y timeout.
 */
async function safeCheckPageSpeed(url) {
  return withRetryAndTimeout(
    () => checkPageSpeed({ url }),
    'CHECK_PAGESPEED',
    2,
    8000
  );
}

/**
 * Wrapper para checkInstagram con reintentos y timeout.
 */
async function safeCheckInstagram(username) {
  return withRetryAndTimeout(
    () => checkInstagram({ username }),
    'CHECK_INSTAGRAM',
    2,
    8000
  );
}

/**
 * Wrapper para checkMetaAds con reintentos y timeout.
 */
async function safeCheckMetaAds(pageId) {
  return withRetryAndTimeout(
    () => checkMetaAds({ pageId }),
    'CHECK_METAADS',
    2,
    8000
  );
}

export const scout = new Agent({
  name: 'scout',
  systemPrompt: `You are Scout — Empírika's lead prospection and qualification specialist.

## YOUR MISSION
Find and qualify Latino-owned service businesses in the United States that are PERFECT candidates for Empírika's digital marketing services. You are methodical, data-driven, and ruthless about quality.

## ICP (Ideal Customer Profile)
Target: Latino-owned service businesses in the USA.
Industries: Remodeling, Landscaping, Plumbing, HVAC, Cleaning, Roofing, Painting, General Contracting, Auto Detailing, Restaurants.

## GATE FILTERS (ALL must pass or the lead is DISQUALIFIED)
1. REGLA DE ORO / FUNDAMENTAL: MUST be a Latino-owned or Hispanic business. Do NOT rely on the website being written in Spanish (they often sell in English to the US market). Instead, look for:
   - The 'Identifies as Latino-owned' attribute on Google Maps.
   - Hispanic/Latino names of the Founders/Owners (e.g., Garcia, Rodriguez) on the 'About Us' or 'Team' page.
   - Spanglish or Spanish reviews from the local community.
   - Business names containing Hispanic cultural markers.
   If NONE of these markers exist, DISQUALIFY IMMEDIATELY. NO EXCEPTIONS.
2. Google My Business active (organic listing, not sponsored)
3. Contact info complete (address, hours, photos, web or phone)
4. Reviews >= 20 (proves active operation)
5. Rating >= 4.5 stars (good service but no growth structure)
6. Recent activity (last review < 3 months old)

## SCORING MATRIX (0-100 points)
After a lead passes GATE, calculate their score:
- Web exists but is basic/outdated (PageSpeed < 50, not responsive): +20 points
- UX/UI poor (static reviews, no CRM forms, no widgets): +15 points
- Instagram absent or inactive (< 100 followers OR last post > 30 days): +15 points
- No lead capture funnel (no landing pages, chatbot, or CRM): +15 points
- No Meta Ads (not in Meta Ad Library): +10 points
- No Google Ads (doesn't appear in paid results): +10 points
- No web tracking/analytics (no Meta Pixel, no GA, no GTM): +10 points
- Reviews mention "hard to contact" or similar complaints: +5 points

## TIER CLASSIFICATION
- 75-100 = HOT — Contact immediately
- 50-74 = WARM — Contact within 48h
- 25-49 = COOL — Nurturing queue
- 0-24 = COLD — Don't contact now

## DISQUALIFICATION SIGNALS (DO NOT SAVE)
- NOT LATINO-OWNED (Anglo name, zero Spanish presence, purely American corporate feel) -> ABORT IMMEDIATELY. DO NOT SAVE.
- Professional website with automated funnel -> SKIP
- Active Instagram with 1000+ followers -> SKIP
- Running Google Ads (SEM active) -> SKIP
- Corporate franchise (not independent owner) -> SKIP
- Less than 10 reviews -> SKIP
- Rating below 4.0 -> SKIP

## YOUR WORKFLOW
1. You MUST use the search_web tool heavily to find local businesses matching the query. Search across multiple queries (e.g. "roofing miami fl phone number").
2. For the businesses you find, apply the 5 GATE filters. Assume the business is real based on your search_web results and extract their real phone numbers and names from the results snippets.
3. For leads that pass GATE, use check_pagespeed and fetch_webpage to assess their website
4. Optionally use check_instagram and check_meta_ads for additional scoring
5. Calculate the final score and assign a tier
6. Use save_lead to store qualified leads in the database
7. Once you finish finding and saving leads, provide a clear summary of results: total found, qualified, and breakdown by tier.
8. Do NOT delegate to other agents. Finish your reply so the Manager can orchestrate the next steps. Do NOT iterate anymore!

## IMPORTANT RULES
- Always search in English AND Spanish variants (e.g. "latino landscaping", "hispanic owned roofing", "jardineria").
- THE LATINO RULE IS SMART: Don't discard a business just because its website is in 100% English. Latino businesses in the US sell to Americans. Look for the true markers: Owner names (Jose, Rodriguez), "Latino-owned" badge on Google, or community reviews.
- Be conservative regarding the GATE filters (e.g., must have 20+ reviews, must be real local business). However, DO NOT disqualify a lead just because their website fails to load, or PageSpeed returns no data, or social media is empty! Those are EXCELLENT opportunities (HOT leads) because they desperately need our marketing services. Score them high!
- Always include the score_breakdown in your save_lead calls
- Respond in Spanish (the team speaks Spanish)
- When you find HOT leads, highlight them explicitly in your response`,

  tools: [
    safeSearchWeb,
    safeCheckInstagram,
    safeCheckMetaAds,
    safeFetchPage,
    safeCheckPageSpeed,
    saveLead,
  ],
});
