// ============================================================
// tools/webResearch.js — Web research tools for agents
// Search chain: BrightData → DuckDuckGo. Gemini grounding is DISABLED
// because it hallucinated URLs (2026-04-17 incident: 26 ghost domains
// in Supabase, 10 pushed to GHL as fake contacts).
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { scraplingFetch } from './scrapling.js';

// DISABLED: Gemini grounding fallback was the root cause of the 2026-04-17
// ghost-domain incident. The model hallucinated URLs matching the pattern
// "<latino-surname><niche><city>.com" that didn't resolve in DNS. We keep
// the function body removed intentionally — do not restore without adding
// a post-response DNS reachability filter to every returned URL.

export const searchWeb = new Tool({
  name: 'search_web',
  description: 'Search the web for information. Returns top search results with titles, descriptions, and URLs. Use for competitor research, trending topics, industry news.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      num_results: { type: 'number', description: 'Number of results (default 5)' },
    },
    required: ['query'],
  },
  fn: async (args) => {
    const { query, num_results = 5 } = args;
    
    try {
      // Strategy 1: Try Bright Data SERP API
      const token = process.env.BRIGHTDATA_API_TOKEN;
      if (token) {
        try {
          console.log(`  🔍 [webResearch] Searching via Bright Data for: "${query}"`);
          const response = await fetch('https://api.brightdata.com/serp/req', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              query: query,
              search_engine: 'google',
              country: 'us',
              language: 'en',
              num: Math.min(num_results, 20),
              zone: process.env.BRIGHTDATA_SERP_ZONE || 'serp_api1',
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            const organic = data.organic || [];
            const results = organic.slice(0, num_results).map((item) => ({
              title: item.title || '',
              description: item.description || item.snippet || '',
              url: item.link || item.url || ''
            }));
            if (results.length > 0) {
              console.log(`  ✅ [webResearch] Bright Data returned ${results.length} results`);
              return JSON.stringify({ results });
            }
          }
          console.log(`  ⚠️ [webResearch] Bright Data returned no results, falling back to DuckDuckGo...`);
        } catch (bdErr) {
          console.log(`  ⚠️ [webResearch] Bright Data failed: ${bdErr.message}, falling back...`);
        }
      }

      // Strategy 2: DuckDuckGo HTML fallback (no API key needed)
      console.log(`  🦆 [webResearch] Searching via DuckDuckGo for: "${query}"`);
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const ddgResponse = await fetch(ddgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (ddgResponse.ok) {
          const html = await ddgResponse.text();
          
          const results = [];
          const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;
          let match;
          while ((match = resultPattern.exec(html)) !== null && results.length < num_results) {
            let url = match[1];
            const uddgMatch = url.match(/uddg=([^&]+)/);
            if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
            const title = match[2].replace(/<[^>]+>/g, '').trim();
            const description = match[3].replace(/<[^>]+>/g, '').trim();
            if (title && url) results.push({ title, description, url });
          }
          
          if (results.length === 0) {
            const linkPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            while ((match = linkPattern.exec(html)) !== null && results.length < num_results) {
              let url = match[1];
              const uddgMatch = url.match(/uddg=([^&]+)/);
              if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
              const title = match[2].replace(/<[^>]+>/g, '').trim();
              if (title && url && url.startsWith('http')) results.push({ title, description: '', url });
            }
          }

          if (results.length > 0) {
            console.log(`  ✅ [webResearch] DuckDuckGo returned ${results.length} results`);
            return JSON.stringify({ results });
          }
        }
      } catch (ddgErr) {
        console.log(`  ⚠️ [webResearch] DuckDuckGo failed: ${ddgErr.message}`);
      }

      // Strategy 3 (Gemini grounding) REMOVED — see header comment.
      // When Bright Data + DDG both fail, we return an explicit error so
      // downstream agents do NOT invent URLs to fill the gap.
      return JSON.stringify({
        error: 'SEARCH_UNAVAILABLE',
        detail: 'Bright Data + DuckDuckGo both failed. Gemini fallback disabled to prevent URL hallucination. Agent MUST NOT fabricate results — skip this query.',
        query,
      });

    } catch (err) {
      return `Search failed: ${err.message}`;
    }
  },
});

export const fetchPage = new Tool({
  name: 'fetch_webpage',
  description: 'Fetch and extract text content from a webpage URL using Scrapling (stealth-capable local scraper). Returns cleaned page text for analysis. Use stealthy=true for sites behind Cloudflare/WAF.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to fetch' },
      stealthy: { type: 'boolean', description: 'Use headless browser + stealth patches for WAF-protected sites (slower). Default false.' },
    },
    required: ['url'],
  },
  fn: async (args) => {
    let { url, stealthy = false } = args;

    try {
      url = String(url || '').trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      try { new URL(url); } catch { return `Error: URL inválida proporcionada (${url}).`; }

      console.log(`  🌐 [webResearch] Scraping via Scrapling (${stealthy ? 'stealthy' : 'fast'}): ${url}`);

      const result = await scraplingFetch(url, { stealthy, timeoutMs: stealthy ? 45000 : 20000 });

      if (!result.success) {
        // If fast mode failed with what looks like a WAF block, retry stealthy once.
        const looksBlocked = /403|503|cloudflare|captcha|blocked/i.test(result.error || '');
        if (!stealthy && looksBlocked) {
          console.log(`  🛡️ [webResearch] Retrying stealthy after WAF-like error: ${result.error}`);
          const retry = await scraplingFetch(url, { stealthy: true, timeoutMs: 45000 });
          if (retry.success) return (retry.text || '').slice(0, 8000);
          return `Scrapling failed (fast + stealthy): ${retry.error || 'unknown'}`;
        }
        return `Scrapling error: ${result.error || 'unknown'}`;
      }

      const text = (result.text || '').trim();
      if (!text) return 'Page content could not be extracted (empty text).';
      return text.slice(0, 8000);
    } catch (err) {
      return `Failed to fetch ${url}: ${err.message}`;
    }
  },
});

export const checkPageSpeed = new Tool({
  name: 'check_pagespeed',
  description: 'Run a Google PageSpeed Insights audit on a URL. Returns performance scores and Core Web Vitals.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to audit' },
      strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Device type (default: mobile)' },
    },
    required: ['url'],
  },
  fn: async (args) => {
    const { url, strategy = 'mobile' } = args;

    try {
      const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      const lighthouse = data.lighthouseResult;
      if (!lighthouse) return 'PageSpeed API returned no data.';

      const categories = lighthouse.categories || {};
      const audits = lighthouse.audits || {};

      return JSON.stringify({
        performance_score: Math.round((categories.performance?.score || 0) * 100),
        seo_score: Math.round((categories.seo?.score || 0) * 100),
        accessibility_score: Math.round((categories.accessibility?.score || 0) * 100),
        best_practices_score: Math.round((categories['best-practices']?.score || 0) * 100),
        core_web_vitals: {
          lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
          fid: audits['max-potential-fid']?.displayValue || 'N/A',
          cls: audits['cumulative-layout-shift']?.displayValue || 'N/A',
          ttfb: audits['server-response-time']?.displayValue || 'N/A',
        },
        strategy,
      });
    } catch (err) {
      return `PageSpeed check failed: ${err.message}`;
    }
  },
});
