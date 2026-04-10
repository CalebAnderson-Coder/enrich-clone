// ============================================================
// tools/apifyInstagram.js — Instagram Profile Checker via Apify
// Actor: apify/instagram-profile-scraper
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { ApifyClient } from 'apify-client';

const APIFY_BASE = 'https://api.apify.com/v2';

export const checkInstagram = new Tool({
  name: 'check_instagram',
  description: `Check if a business has an Instagram profile and assess its activity level. Returns follower count, last post date, and whether the profile is actively maintained. Use to score leads on social media presence.`,
  parameters: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        description: 'Instagram username to check (without @)',
      },
      businessName: {
        type: 'string',
        description: 'Business name to search for if username is unknown',
      },
    },
    required: [],
  },
  fn: async (args) => {
    const { username, businessName } = args;
    const token = process.env.APIFY_API_TOKEN;

    const target = username || businessName;
    console.log(`  📸 [Instagram] Checking: "${target}"`);

    if (!token) {
      console.log(`  ⚠️  MOCK MODE — Set APIFY_API_TOKEN for real Instagram checks`);
      return JSON.stringify({
        mock: true,
        exists: false,
        username: target,
        followers: 0,
        lastPostDate: null,
        isActive: false,
        score_contribution: 15, // Full points if Instagram is absent
        note: 'Set APIFY_API_TOKEN for real checks',
      });
    }

    try {
      // If we have a username, check directly
      if (username) {
        const runRes = await fetch(
          `${APIFY_BASE}/acts/apify~instagram-profile-scraper/runs?token=${token}&waitForFinish=60`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              usernames: [username],
              resultsType: 'details',
            }),
          }
        );

        if (!runRes.ok) {
          throw new Error(`Apify Instagram call failed: ${runRes.status}`);
        }

        const runData = await runRes.json();
        const datasetId = runData.data?.defaultDatasetId;

        if (datasetId) {
          const dataRes = await fetch(
            `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json&limit=1`
          );
          const profiles = await dataRes.json();

          if (profiles.length > 0) {
            const profile = profiles[0];
            const lastPost = profile.latestPosts?.[0]?.timestamp || null;
            const daysSinceLastPost = lastPost
              ? Math.floor((Date.now() - new Date(lastPost).getTime()) / (1000 * 60 * 60 * 24))
              : 999;

            const isActive = profile.postsCount > 0 && daysSinceLastPost < 30;
            const hasSignificantFollowing = (profile.followersCount || 0) >= 100;

            return JSON.stringify({
              mock: false,
              exists: true,
              username: profile.username,
              fullName: profile.fullName,
              followers: profile.followersCount || 0,
              following: profile.followsCount || 0,
              posts: profile.postsCount || 0,
              lastPostDate: lastPost,
              daysSinceLastPost,
              isActive,
              hasSignificantFollowing,
              bio: profile.biography || '',
              // Score: 0 points if active (bad for us), 15 points if inactive/absent (good for us)
              score_contribution: (!isActive && !hasSignificantFollowing) ? 15 : 0,
            });
          }
        }
      }

      // Username not found or no username provided
      return JSON.stringify({
        mock: false,
        exists: false,
        username: username || null,
        businessName,
        followers: 0,
        lastPostDate: null,
        isActive: false,
        score_contribution: 15, // Full points — Instagram absent = opportunity
      });

    } catch (err) {
      console.error(`  ❌ [Instagram] Error: ${err.message}`);
      // On error, assume Instagram is absent (conservative scoring)
      return JSON.stringify({
        error: err.message,
        exists: false,
        isActive: false,
        score_contribution: 15,
      });
    }
  },
});

export const scrapeClientInstagram = new Tool({
  name: 'scrape_client_instagram',
  description: `Extracts the latest Instagram posts and reels from a client's Instagram profile using Apify.
The output provides caption text, engagement numbers, and video URLs.
NOTE: This operation handles the scraping and queues the posts for video transcription (RAG).
This should be called when Carlos needs deep context about a client's content.`,
  parameters: {
    type: 'object',
    properties: {
      prospect_id: {
        type: 'string',
        description: 'The UUID of the prospect in the database.',
      },
      instagram_username: {
        type: 'string',
        description: 'The Instagram handle to scrape (without the @ symbol).',
      },
      limit: {
        type: 'number',
        description: 'Number of recent posts/videos to extract. Default is 10.',
      },
    },
    required: ['prospect_id', 'instagram_username'],
  },
  fn: async (args) => {
    const { prospect_id, instagram_username, limit = 10 } = args;

    if (!process.env.APIFY_API_TOKEN) {
      return JSON.stringify({ error: 'APIFY_API_TOKEN is missing in .env' });
    }

    try {
      console.log(`  🕸️ [Scraper] Initiating Apify Instagram Scraper for @${instagram_username}...`);
      
      const client = new ApifyClient({
        token: process.env.APIFY_API_TOKEN,
      });

      const input = {
        addParentData: false,
        directUrls: [
          `https://www.instagram.com/${instagram_username}/`
        ],
        enhanceUserSearchWithFacebookPage: false,
        isUserTaggedFeedURL: false,
        resultsLimit: limit,
        resultsType: "posts",
        searchLimit: 1,
        searchType: "hashtag"
      };

      const run = await client.actor("apify/instagram-scraper").call(input);
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      
      console.log(`  🕸️ [Scraper] Scraped ${items.length} posts for @${instagram_username}`);

      // Dynamically import supabase 
      const { supabase } = await import('../lib/supabase.js');

      if (!supabase) {
         return JSON.stringify({ success: true, count: items.length, mock: true, items });
      }

      const records = items.filter(p => !p.error).map(p => {
        const likes = p.likesCount || 0;
        const comments = p.commentsCount || 0;
        const score = likes + (comments * 3);
        
        return {
          prospect_id,
          source_type: p.type === 'Video' ? 'instagram_reel' : 'instagram_post',
          caption: p.caption || '',
          transcription: null, 
          engagement_score: score,
          post_date: p.timestamp ? new Date(p.timestamp).toISOString() : null,
          source_url: p.url,       
          // We can also extract videoUrl directly if present. Apify usually returns it as videoUrl
          raw_data: p             
        };
      });

      // Upsert into client_knowledge
      const { data, error } = await supabase
        .from('client_knowledge')
        .upsert(records, { onConflict: 'source_url', ignoreDuplicates: true })
        .select('id');

      if (error) {
        console.error('  ❌ [Scraper] Supabase error:', error.message);
        throw error;
      }

      return JSON.stringify({
        success: true,
        scraped_posts: items.length,
        inserted_records: data ? data.length : 0,
        message: 'Records saved. Background transcription worker will now extract audio and generate vectors for semantic search.'
      });

    } catch (err) {
      console.error(`  ❌ [Scraper] Error: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  },
});

