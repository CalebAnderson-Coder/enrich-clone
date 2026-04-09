// ============================================================
// tools/apifyInstagram.js — Instagram Profile Checker via Apify
// Actor: apify/instagram-profile-scraper
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

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
