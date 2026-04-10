// ============================================================
// tools/carlosKnowledge.js — Carlos Empirika's Brain (RAG)
// Seeds Instagram content into Supabase and allows semantic recall
// for generating hyper-personalized sales pitches.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { supabase } from '../lib/supabase.js';

// ── Topic classification logic ──────────────────────────────
function classifyTopics(caption = '', hashtags = []) {
  const text = `${caption} ${hashtags.join(' ')}`.toLowerCase();
  const topics = new Set();

  const rules = {
    web_design:       ['página web', 'pagina web', 'landing', 'webdesign', 'web design', 'diseño web', 'sitio web'],
    lead_generation:  ['leads', 'lead gen', 'funnel', 'embudo', 'captación', 'prospección', 'captar'],
    ads_paid_media:   ['ads', 'pauta', 'pautar', 'paid media', 'facebook ads', 'google ads', 'roas'],
    content_strategy: ['contenido', 'content', 'viral', 'reel', 'post', 'creación de contenido', 'creaciondecontenido'],
    automation:       ['automatización', 'automatizar', 'sistema', 'proceso', 'crm', 'workflow', 'automatico'],
    branding:         ['marca', 'branding', 'identidad', 'humanizar', 'brand'],
    sales:            ['ventas', 'vender', 'cierre', 'conversión', 'convertir', 'precio'],
    ai_technology:    ['ia', 'inteligencia artificial', 'ai', 'gemini', 'chatgpt', 'automatizacion ia'],
    mindset:          ['mentalidad', 'emprendimiento', 'criterio', 'crecimiento', 'escalar', 'negocio'],
    client_showcase:  ['renovamos', 'rediseñamos', 'hicimos', 'proyecto', 'cliente', 'transformamos'],
    social_media:     ['redes sociales', 'social media', 'instagram', 'community manager', 'tiktok'],
  };

  for (const [topic, keywords] of Object.entries(rules)) {
    if (keywords.some(kw => text.includes(kw))) {
      topics.add(topic);
    }
  }

  // Default fallback
  if (topics.size === 0) topics.add('general');

  return [...topics];
}

// ── Engagement scoring (without follower count, use ratio) ──
function computeEngagement(likes = 0, comments = 0) {
  // Weighted score: comments are worth 3x more than likes
  return (likes + comments * 3);
}

// ============================================================
// Tool 1: Seed the knowledge base from Apify datasets
// ============================================================
export const seedCarlosKnowledge = new Tool({
  name: 'seed_carlos_knowledge',
  description: `Seeds Carlos Empirika's knowledge base with Instagram posts and reels scraped from @empirikagroup. 
  Call this tool once to populate the database with real content that Carlos can recall for personalized pitches.
  Input should be a JSON array of Instagram posts/reels from Apify.`,
  parameters: {
    type: 'object',
    properties: {
      posts_json: {
        type: 'string',
        description: 'JSON array of Instagram posts/reels with caption, hashtags, likesCount, commentsCount, type, timestamp fields',
      },
      source_type: {
        type: 'string',
        description: 'Source type: "instagram_post" or "instagram_reel"',
        enum: ['instagram_post', 'instagram_reel'],
      },
    },
    required: ['posts_json', 'source_type'],
  },
  fn: async (args) => {
    const { posts_json, source_type } = args;

    let posts;
    try {
      posts = JSON.parse(posts_json);
      if (!Array.isArray(posts)) throw new Error('Expected array');
    } catch (err) {
      return JSON.stringify({ error: `Invalid JSON: ${err.message}` });
    }

    const records = posts
      .filter(p => p.caption) // Only posts with content
      .map(p => ({
        source_type,
        caption: p.caption,
        transcription: null, // Placeholder for future audio transcription
        hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
        topic_tags: classifyTopics(p.caption, p.hashtags || []),
        likes_count: p.likesCount || 0,
        comments_count: p.commentsCount || 0,
        engagement_score: computeEngagement(p.likesCount || 0, p.commentsCount || 0),
        post_date: p.timestamp ? new Date(p.timestamp).toISOString() : null,
        source_url: p.videoUrl || null,
        raw_data: p,
      }));

    if (!supabase) {
      console.log(`  🧠 [Knowledge-MOCK] Would seed ${records.length} ${source_type} records`);
      return JSON.stringify({ success: true, seeded: records.length, mode: 'mock' });
    }

    try {
      const { data, error } = await supabase
        .from('carlos_knowledge')
        .upsert(records, { onConflict: 'source_url', ignoreDuplicates: true })
        .select('id');

      if (error) throw error;

      console.log(`  🧠 [Knowledge] Seeded ${data.length} ${source_type} records into carlos_knowledge`);
      return JSON.stringify({ success: true, seeded: data.length, source_type });
    } catch (err) {
      console.error(`  ❌ [Knowledge] Seed error: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  },
});

// ============================================================
// Tool 2: Recall relevant knowledge for a given lead/industry
// ============================================================
export const recallCarlosKnowledge = new Tool({
  name: 'recall_carlos_knowledge',
  description: `ALWAYS call this tool FIRST before crafting any pitch or attack angle.
  Recalls Carlos Empirika's real Instagram content (posts/reels) relevant to a lead's industry or pain point.
  Use this to find proof points, analogies, and Carlos's own words to make pitches hyper-authentic.
  
  Examples:
  - industry="landscaping" → finds content about businesses that rely on word-of-mouth
  - industry="web design" → finds posts about websites that don't convert
  - pain="no system" → finds content about automation and systematization`,
  parameters: {
    type: 'object',
    properties: {
      industry: {
        type: 'string',
        description: 'Lead industry or niche (e.g. "landscaping", "roofing", "cleaning")',
      },
      pain_points: {
        type: 'string',
        description: 'Comma-separated pain points or keywords to search for (e.g. "website,referrals,ads")',
      },
      topics: {
        type: 'string',
        description: 'Specific topics to filter by (comma-separated): web_design, lead_generation, ads_paid_media, automation, branding, sales, mindset, client_showcase',
      },
      limit: {
        type: 'number',
        description: 'Max number of knowledge pieces to return (default: 5)',
      },
    },
    required: ['industry'],
  },
  fn: async (args) => {
    const { industry, pain_points = '', topics = '', limit = 5 } = args;

    // Build topic filter array from inputs
    const requestedTopics = topics
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Map industry to relevant topics automatically
    const industryTopicMap = {
      landscaping:  ['web_design', 'lead_generation', 'mindset'],
      roofing:      ['web_design', 'lead_generation', 'ads_paid_media'],
      cleaning:     ['web_design', 'automation', 'social_media'],
      plumbing:     ['web_design', 'lead_generation', 'branding'],
      hvac:         ['web_design', 'ads_paid_media', 'automation'],
      remodeling:   ['web_design', 'client_showcase', 'branding'],
      restaurant:   ['social_media', 'branding', 'content_strategy'],
      salon:        ['social_media', 'branding', 'content_strategy'],
      default:      ['web_design', 'lead_generation', 'mindset'],
    };

    const industryKey = Object.keys(industryTopicMap).find(k =>
      industry.toLowerCase().includes(k)
    ) || 'default';

    const targetTopics = requestedTopics.length > 0
      ? requestedTopics
      : industryTopicMap[industryKey];

    if (!supabase) {
      return JSON.stringify({
        note: 'Running in mock mode — knowledge base not available',
        mock_insight: `Post de ejemplo: "¿Tu negocio funciona… o depende de ti para funcionar? Los negocios que escalan construyen sistemas: embudos que captan, educan, filtran y convierten sin necesidad de estar activos todo el tiempo." — Carlos Empirika`,
        topics_searched: targetTopics,
      });
    }

    try {
      // Query by topic tags (array overlap)
      const { data, error } = await supabase
        .from('carlos_knowledge')
        .select('caption, topic_tags, engagement_score, post_date, source_type')
        .overlaps('topic_tags', targetTopics)
        .order('engagement_score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      if (!data || data.length === 0) {
        // Fallback: return highest-engagement posts regardless of topic
        const { data: fallback, error: fbErr } = await supabase
          .from('carlos_knowledge')
          .select('caption, topic_tags, engagement_score, post_date, source_type')
          .order('engagement_score', { ascending: false })
          .limit(limit);

        if (fbErr) throw fbErr;
        return JSON.stringify({
          industry,
          topics_searched: targetTopics,
          results: fallback || [],
          note: 'Returned top-engagement posts (no exact topic match)',
        });
      }

      return JSON.stringify({
        industry,
        topics_searched: targetTopics,
        results: data,
        instruction: 'Use these real posts from Carlos to echo his exact language and proof points in your pitch. Quote directly when powerful.',
      });
    } catch (err) {
      console.error(`  ❌ [Knowledge] Recall error: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  },
});
