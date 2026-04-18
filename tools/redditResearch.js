// ============================================================
// tools/redditResearch.js — Scrapling wrapper para old.reddit.com search
//
// Uso: Agente Estratega lo llama en el ciclo deep-weekly para detectar
// señales comunitarias (quejas, tácticas, casos de uso) relevantes al
// combo niche×metro. Nunca se usa en outreach.
//
// Silent-fail contract: si Reddit bloquea con 403/429 tras retry
// stealthy, devolvemos { results: [], note: 'reddit_unavailable' }.
// El loop del Estratega NUNCA debe romperse por esto.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { scraplingFetch } from './scrapling.js';

const DEFAULT_SUBS = ['smallbusiness', 'Entrepreneur', 'contractors', 'roofing', 'plumbing'];

function looksBlocked(status, text) {
  if (status === 403 || status === 429) return true;
  if (typeof text === 'string' && /blocked|too many requests|captcha/i.test(text.slice(0, 500))) return true;
  return false;
}

/**
 * Fetch top posts del último mes matching `query` dentro de cada sub.
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {string[]} [opts.subs]
 * @param {number} [opts.limit]
 * @returns {Promise<{ results: Array, note?: string }>}
 */
export async function researchReddit({
  query,
  subs = DEFAULT_SUBS,
  limit = 10,
  fetchImpl = scraplingFetch,   // inyectable para tests
} = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'empty_query' };

  const collected = [];
  let allBlocked = true;

  for (const sub of subs) {
    const url = `https://old.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&sort=top&t=month&limit=${limit}`;

    let res = await fetchImpl(url, { stealthy: false, timeoutMs: 15000 });

    if (!res.success || looksBlocked(res.status, res.text)) {
      // One retry with stealth
      const retry = await fetchImpl(url, { stealthy: true, timeoutMs: 30000 });
      if (retry.success && !looksBlocked(retry.status, retry.text)) {
        res = retry;
      } else {
        // skip this sub silently, move on
        continue;
      }
    }

    allBlocked = false;

    try {
      // The .text extractor strips tags; we need the raw JSON from .html or a
      // JSON body. Scrapling returns .html even for JSON responses (the raw
      // payload lives there). Try html first, fallback to text.
      const raw = res.html || res.text || '';
      // When JSON is served, html_to_text in the sidecar may have stripped it
      // into a single-line string — we try both.
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      if (!parsed) {
        // Some servers wrap JSON in a <pre> when served as text/html; strip.
        const cleaned = String(raw).replace(/^\s+|\s+$/g, '');
        try { parsed = JSON.parse(cleaned); } catch {}
      }
      if (!parsed || !parsed.data || !Array.isArray(parsed.data.children)) continue;

      for (const child of parsed.data.children) {
        const d = child?.data;
        if (!d) continue;
        collected.push({
          subreddit:    d.subreddit || sub,
          title:        d.title || '',
          selftext:     (d.selftext || '').slice(0, 800),
          score:        Number.isFinite(d.score) ? d.score : 0,
          num_comments: Number.isFinite(d.num_comments) ? d.num_comments : 0,
          permalink:    d.permalink ? `https://reddit.com${d.permalink}` : null,
          created_utc:  d.created_utc || null,
          post_id:      d.id || null,
        });
      }
    } catch {
      // parse failure on a single sub — keep going, silent.
    }
  }

  if (allBlocked && collected.length === 0) {
    return { results: [], note: 'reddit_unavailable' };
  }

  // cap total results so large prompts don't balloon
  return { results: collected.slice(0, limit * subs.length) };
}

// ── Tool wrapper (for Agent use) ─────────────────────────────
export const researchRedditTool = new Tool({
  name: 'research_reddit',
  description: 'Investigar old.reddit.com (top del último mes) para detectar tácticas, quejas y señales de mercado en subreddits de contratistas y smallbusiness. Silent-fails si Reddit bloquea.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Término de búsqueda (ej: "roofing Miami lead generation")' },
      subs:  { type: 'array',  items: { type: 'string' }, description: 'Subreddits a investigar (default: smallbusiness, Entrepreneur, contractors, roofing, plumbing)' },
      limit: { type: 'number', description: 'Posts por sub (default 10)' },
    },
    required: ['query'],
  },
  fn: async (args) => {
    try {
      const out = await researchReddit(args || {});
      return JSON.stringify(out);
    } catch (err) {
      return JSON.stringify({ results: [], note: `error: ${err.message}` });
    }
  },
});
