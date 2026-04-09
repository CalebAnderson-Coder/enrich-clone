// ============================================================
// tools/brightDataInstagram.js — Instagram Profile Checker via Bright Data
// Uses Web Scraper to check Instagram profile existence & activity
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

const BD_SCRAPE = 'https://api.brightdata.com/request';

/**
 * Scrape Instagram profile via Bright Data Web Unlocker
 */
async function scrapeInstagramProfile(username, token) {
  const url = `https://www.instagram.com/${username}/`;

  const res = await fetch(BD_SCRAPE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      url,
      format: 'raw',
      zone: 'web_unlocker1',
    }),
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Bright Data scrape failed (${res.status})`);
  }

  const html = await res.text();

  // Parse basic profile data from HTML/JSON-LD
  const profileData = extractProfileFromHTML(html, username);
  return profileData;
}

/**
 * Extract profile metrics from Instagram page HTML
 */
function extractProfileFromHTML(html, username) {
  // Instagram embeds profile data in multiple locations
  // Try JSON-LD first
  const jsonLdMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.mainEntityofPage?.interactionStatistic) {
        const stats = ld.mainEntityofPage.interactionStatistic;
        const followers = stats.find(s => s.interactionType?.includes('Follow'))?.userInteractionCount || 0;
        return {
          exists: true,
          username,
          followers: parseInt(followers, 10),
          fullName: ld.name || '',
          bio: ld.description || '',
        };
      }
    } catch { /* fallback below */ }
  }

  // Try meta tags
  const descMatch = html.match(/<meta\s+(?:name|property)="(?:og:description|description)"\s+content="([^"]+)"/i);
  if (descMatch) {
    const desc = descMatch[1];
    // "123 Followers, 45 Following, 67 Posts - See Instagram photos and videos from Name (@user)"
    const followersMatch = desc.match(/([\d,.]+[KkMm]?)\s*Followers/i);
    const postsMatch = desc.match(/([\d,.]+)\s*Posts/i);
    const nameMatch = desc.match(/from\s+(.+?)\s*\(@/);

    if (followersMatch) {
      return {
        exists: true,
        username,
        followers: parseCount(followersMatch[1]),
        posts: postsMatch ? parseInt(postsMatch[1].replace(/,/g, ''), 10) : 0,
        fullName: nameMatch ? nameMatch[1] : '',
        bio: '',
      };
    }
  }

  // Check if page exists at all
  if (html.includes('Page Not Found') || html.includes('"HttpError"') || html.includes('Sorry, this page')) {
    return null;
  }

  // Page exists but can't parse details
  return {
    exists: true,
    username,
    followers: 0,
    posts: 0,
    fullName: '',
    bio: '',
    parseError: true,
  };
}

/**
 * Parse "1.2K", "3.4M", "567" style counts
 */
function parseCount(str) {
  if (!str) return 0;
  const cleaned = str.replace(/,/g, '').trim();
  const numMatch = cleaned.match(/([\d.]+)\s*([KkMm])?/);
  if (!numMatch) return 0;
  let num = parseFloat(numMatch[1]);
  const suffix = (numMatch[2] || '').toUpperCase();
  if (suffix === 'K') num *= 1000;
  if (suffix === 'M') num *= 1000000;
  return Math.round(num);
}

export const checkInstagram = new Tool({
  name: 'check_instagram',
  description: `Check if a business has an Instagram profile and assess its activity level. Returns follower count and whether the profile exists. Use to score leads on social media presence.`,
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
    const token = process.env.BRIGHTDATA_API_TOKEN;

    const target = username || businessName;
    console.log(`  📸 [Instagram] Checking: "${target}"`);

    if (!token) {
      console.log(`  ⚠️  MOCK MODE — Set BRIGHTDATA_API_TOKEN for real checks`);
      return JSON.stringify({
        mock: true,
        exists: false,
        username: target,
        followers: 0,
        isActive: false,
        score_contribution: 15,
        note: 'Set BRIGHTDATA_API_TOKEN for real checks',
      });
    }

    try {
      if (username) {
        const profile = await scrapeInstagramProfile(username, token);

        if (profile && profile.exists) {
          const hasSignificantFollowing = (profile.followers || 0) >= 100;
          const hasPosts = (profile.posts || 0) > 0;
          const isActive = hasPosts && hasSignificantFollowing;

          return JSON.stringify({
            mock: false,
            exists: true,
            username: profile.username,
            fullName: profile.fullName || '',
            followers: profile.followers || 0,
            posts: profile.posts || 0,
            isActive,
            hasSignificantFollowing,
            bio: profile.bio || '',
            // Score: 0 points if active (bad for us), 15 points if inactive/absent
            score_contribution: (!isActive && !hasSignificantFollowing) ? 15 : 0,
          });
        }
      }

      // Profile not found or no username
      return JSON.stringify({
        mock: false,
        exists: false,
        username: username || null,
        businessName,
        followers: 0,
        isActive: false,
        score_contribution: 15, // Instagram absent = opportunity
      });

    } catch (err) {
      console.error(`  ❌ [Instagram] Error: ${err.message}`);
      return JSON.stringify({
        error: err.message,
        exists: false,
        isActive: false,
        score_contribution: 15,
      });
    }
  },
});
