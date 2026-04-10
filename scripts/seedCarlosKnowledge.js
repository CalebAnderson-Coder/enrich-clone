// ============================================================
// scripts/seedCarlosKnowledge.js
// Descarga los 99 posts + 48 reels de Apify y los inserta
// en la tabla carlos_knowledge de Supabase.
//
// Uso: node scripts/seedCarlosKnowledge.js
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Apify Dataset IDs ──────────────────────────────────────
const POSTS_DATASET_ID  = 'awUh1sQdsapcLSiO9';
const REELS_DATASET_ID  = 'oCP8UzhYPxnopPjeO';
const APIFY_TOKEN       = process.env.APIFY_API_TOKEN;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!APIFY_TOKEN)  { console.error('❌ APIFY_API_TOKEN not set in .env'); process.exit(1); }
if (!SUPABASE_URL) { console.error('❌ SUPABASE_URL not set in .env'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('❌ SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY not set in .env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Topic classifier (mirrors carlosKnowledge.js) ─────────
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

  if (topics.size === 0) topics.add('general');
  return [...topics];
}

function computeEngagement(likes = 0, comments = 0) {
  return (likes + comments * 3);
}

// ── Fetch from Apify ──────────────────────────────────────
async function fetchApifyDataset(datasetId, limit = 500) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?limit=${limit}&token=${APIFY_TOKEN}`;
  console.log(`  📡 Fetching dataset ${datasetId}...`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Transform & insert ────────────────────────────────────
async function seedDataset(datasetId, sourceType) {
  const raw = await fetchApifyDataset(datasetId);
  console.log(`  📦 Fetched ${raw.length} items from ${datasetId} (${sourceType})`);

  const records = raw
    .filter(p => p.caption)
    .map(p => ({
      source_type: sourceType,
      caption: p.caption,
      transcription: null,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      topic_tags: classifyTopics(p.caption, p.hashtags || []),
      likes_count: p.likesCount || 0,
      comments_count: p.commentsCount || 0,
      engagement_score: computeEngagement(p.likesCount || 0, p.commentsCount || 0),
      post_date: p.timestamp ? new Date(p.timestamp).toISOString() : null,
      source_url: p.videoUrl || p.url || null,
      raw_data: p,
    }));

  console.log(`  🧠 Inserting ${records.length} records into carlos_knowledge...`);

  // Batch insert in chunks of 50
  const CHUNK_SIZE = 50;
  let totalInserted = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('carlos_knowledge')
      .upsert(chunk, { onConflict: 'source_url', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.error(`  ❌ Chunk ${i}-${i+CHUNK_SIZE} error: ${error.message}`);
      // Try without dedup if source_url might be null
      const { data: d2, error: e2 } = await supabase
        .from('carlos_knowledge')
        .insert(chunk)
        .select('id');
      if (e2) { console.error(`     Retry failed: ${e2.message}`); continue; }
      totalInserted += (d2?.length || 0);
    } else {
      totalInserted += (data?.length || 0);
    }
  }

  console.log(`  ✅ ${sourceType}: ${totalInserted}/${records.length} records inserted`);
  return totalInserted;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Seeding Carlos Empirika Knowledge Base...\n');
  console.log(`   Supabase: ${SUPABASE_URL}`);

  try {
    const postsCount  = await seedDataset(POSTS_DATASET_ID,  'instagram_post');
    const reelsCount  = await seedDataset(REELS_DATASET_ID,  'instagram_reel');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 Knowledge Base Seeded!`);
    console.log(`   Posts:  ${postsCount}`);
    console.log(`   Reels:  ${reelsCount}`);
    console.log(`   Total:  ${postsCount + reelsCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('👉 Carlos Empirika can now recall his own content to craft personalized pitches.');
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
