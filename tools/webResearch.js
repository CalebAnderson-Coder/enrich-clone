// ============================================================
// tools/webResearch.js — Web research tools for agents
// Uses BrightData or Fetch for real-time web intelligence
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

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
      const token = process.env.BRIGHTDATA_API_TOKEN;
      
      if (!token) {
        return JSON.stringify({ error: "BRIGHTDATA_API_TOKEN is not set. Web search unavailable." });
      }

      console.log(`  🔍 [webResearch] Searching Google via Bright Data for: "${query}"`);
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
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Bright Data search failed (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const organic = data.organic || [];
      
      const results = organic.slice(0, num_results).map((item) => ({
        title: item.title || '',
        description: item.description || item.snippet || '',
        url: item.link || item.url || ''
      }));

      if (results.length === 0) {
        return JSON.stringify({ error: "No results found for query." });
      }

      return JSON.stringify({ results });
    } catch (err) {
      return `Search failed: ${err.message}`;
    }
  },
});

export const fetchPage = new Tool({
  name: 'fetch_webpage',
  description: 'Fetch and extract text content from a webpage URL. Returns the text content for analysis.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to fetch' },
    },
    required: ['url'],
  },
  fn: async (args) => {
    const { url } = args;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnrichBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      
      const html = await response.text();
      
      // Basic HTML to text extraction
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000); // Limit to avoid token overflow

      return text || 'Page content was empty or blocked.';
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
