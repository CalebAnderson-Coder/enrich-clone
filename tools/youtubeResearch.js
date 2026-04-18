// ============================================================
// tools/youtubeResearch.js — Scrapling wrapper para YouTube search
//
// Uso: Agente Estratega (ciclo deep-weekly) pide los videos más
// recientes (último mes) para un niche/tema. Extrae videoId/título/
// canal/descripción parseando `ytInitialData` del HTML.
//
// Silent-fail: si el shape de YT cambia o si el fetch falla,
// devolvemos { results: [], note: 'youtube_parser_broken' } y seguimos.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { scraplingFetch } from './scrapling.js';

// sp=EgIIAw%3D%3D → filter: uploaded this month
const MONTH_FILTER = 'EgIIAw%3D%3D';

function extractYtInitialData(html) {
  if (!html) return null;
  // Most common form: `var ytInitialData = {...};`
  const m1 = html.match(/var ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (m1) {
    try { return JSON.parse(m1[1]); } catch {}
  }
  const m2 = html.match(/ytInitialData"?\]?\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (m2) {
    try { return JSON.parse(m2[1]); } catch {}
  }
  return null;
}

function walkContents(obj, out, limit) {
  if (!obj || out.length >= limit) return;
  if (Array.isArray(obj)) {
    for (const el of obj) walkContents(el, out, limit);
    return;
  }
  if (typeof obj === 'object') {
    // videoRenderer is the shape we want
    const vr = obj.videoRenderer;
    if (vr && vr.videoId) {
      const title =
        vr.title?.runs?.[0]?.text ||
        vr.title?.simpleText ||
        '';
      const channel =
        vr.ownerText?.runs?.[0]?.text ||
        vr.longBylineText?.runs?.[0]?.text ||
        '';
      const views =
        vr.viewCountText?.simpleText ||
        vr.shortViewCountText?.simpleText ||
        '';
      const publishedText =
        vr.publishedTimeText?.simpleText || '';
      const description =
        vr.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') ||
        vr.descriptionSnippet?.runs?.map(r => r.text).join('') ||
        '';
      out.push({
        videoId: vr.videoId,
        title,
        channel,
        views,
        publishedText,
        description: description.slice(0, 400),
      });
      if (out.length >= limit) return;
    }
    for (const k of Object.keys(obj)) {
      walkContents(obj[k], out, limit);
      if (out.length >= limit) return;
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} [opts.limit]
 * @returns {Promise<{ results: Array, note?: string }>}
 */
export async function researchYouTube({ query, limit = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'empty_query' };

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${MONTH_FILTER}`;
  const res = await scraplingFetch(url, { stealthy: true, timeoutMs: 40000 });

  if (!res.success) {
    return { results: [], note: `youtube_fetch_failed: ${res.error || 'unknown'}` };
  }

  const data = extractYtInitialData(res.html || '');
  if (!data) {
    return { results: [], note: 'youtube_parser_broken' };
  }

  const out = [];
  try {
    walkContents(data, out, limit);
  } catch {
    return { results: [], note: 'youtube_parser_broken' };
  }

  if (out.length === 0) {
    return { results: [], note: 'youtube_empty' };
  }
  return { results: out.slice(0, limit) };
}

// ── Tool wrapper ─────────────────────────────────────────────
export const researchYouTubeTool = new Tool({
  name: 'research_youtube',
  description: 'Investigar YouTube (videos subidos el último mes) para un query. Devuelve videoId/título/canal/descripción. Silent-fails si el shape cambia.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query de búsqueda (ej: "roofing marketing 2026")' },
      limit: { type: 'number', description: 'Max videos devueltos (default 10)' },
    },
    required: ['query'],
  },
  fn: async (args) => {
    try {
      const out = await researchYouTube(args || {});
      return JSON.stringify(out);
    } catch (err) {
      return JSON.stringify({ results: [], note: `error: ${err.message}` });
    }
  },
});
