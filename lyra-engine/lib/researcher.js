/**
 * Lyra — Researcher Module
 * Uses BrightData SERP API to find trending topics in AI/marketing.
 */

const SERP_QUERIES = [
  'AI agents marketing automation 2026',
  'TikTok AI tools viral content creators',
  'agentic AI B2B marketing trends',
  'autonomous marketing agents startups',
  'AI content creation tools trending',
];

/**
 * Pick 2 random queries from the pool to avoid repetitive content.
 */
function pickQueries(n = 2) {
  const shuffled = [...SERP_QUERIES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * Search BrightData SERP API and extract relevant snippets.
 * @returns {string} Combined research context for the drafter.
 */
export async function research() {
  const apiToken = process.env.BRIGHTDATA_API_TOKEN;
  if (!apiToken) {
    console.warn('[Lyra:Research] BRIGHTDATA_API_TOKEN missing — using fallback topics');
    return getFallbackContext();
  }

  const queries = pickQueries(2);
  const results = [];

  for (const query of queries) {
    try {
      console.log(`[Lyra:Research] Searching: "${query}"`);
      const res = await fetch('https://api.brightdata.com/serp/req', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          query,
          search_engine: 'google',
          num_results: 5,
          language: 'en',
        }),
      });

      if (!res.ok) {
        console.warn(`[Lyra:Research] SERP ${res.status}: ${await res.text()}`);
        continue;
      }

      const data = await res.json();
      const organic = data.organic || data.results || [];

      for (const item of organic.slice(0, 3)) {
        results.push({
          title: item.title || '',
          snippet: item.description || item.snippet || '',
          url: item.link || item.url || '',
        });
      }
    } catch (err) {
      console.warn(`[Lyra:Research] Error for "${query}":`, err.message);
    }
  }

  if (results.length === 0) {
    console.warn('[Lyra:Research] No SERP results — using fallback');
    return getFallbackContext();
  }

  const context = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`)
    .join('\n\n');

  console.log(`[Lyra:Research] Found ${results.length} results from ${queries.length} queries`);
  return context;
}

/**
 * Fallback context if BrightData fails — ensures we always publish something.
 */
function getFallbackContext() {
  const topics = [
    'Los agentes de IA autónomos están reemplazando equipos de marketing completos en startups.',
    'TikTok está impulsando un nuevo modelo de creación de contenido basado en IA generativa.',
    'Las empresas B2B que adoptan IA agéntica están viendo un 3x en productividad de contenido.',
    'El stack de marketing moderno: 3 humanos supervisando 20 agentes autónomos.',
    'Automatización de publicación multi-plataforma: de un draft a LinkedIn, Twitter y newsletter.',
  ];
  const picked = topics.sort(() => Math.random() - 0.5).slice(0, 3);
  return picked.map((t, i) => `[${i + 1}] ${t}`).join('\n\n');
}
