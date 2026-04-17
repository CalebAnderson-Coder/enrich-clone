#!/usr/bin/env node
/**
 * Lyra — Autonomous B2B Content Engine
 * =====================================
 * Runs as a Render Cron Job (0 12 * * 1-5 = 8:00 AM ET Mon-Fri)
 *
 * Pipeline: Research → Draft → Publish → Log
 *
 * Environment variables required:
 *   GEMINI_API_KEY          — For content generation
 *   BUFFER_ACCESS_TOKEN     — Buffer API access token
 *   BUFFER_PROFILE_ID       — Buffer profile ID for LinkedIn
 *   BRIGHTDATA_API_TOKEN    — For trend research (optional, has fallback)
 *   SUPABASE_URL            — For logging (optional)
 *   SUPABASE_SERVICE_KEY    — For logging (optional)
 *
 * Usage:
 *   node index.js              → Full cycle (research, draft, publish, log)
 *   node index.js --dry-run    → Research + draft only, no publish
 *   node index.js --setup      → List your Buffer profiles to find BUFFER_PROFILE_ID
 */

import { research } from './lib/researcher.js';
import { draft } from './lib/drafter.js';
import { publish, listProfiles } from './lib/publisher.js';
import { logPost } from './lib/logger.js';

const isDryRun = process.argv.includes('--dry-run');
const isSetup = process.argv.includes('--setup');

async function main() {
  const startTime = Date.now();
  console.log('═══════════════════════════════════════════');
  console.log('  🔮 Lyra Content Engine — Starting cycle');
  console.log(`  📅 ${new Date().toISOString()}`);
  console.log(`  🏃 Mode: ${isDryRun ? 'DRY RUN' : isSetup ? 'SETUP' : 'PRODUCTION'}`);
  console.log('═══════════════════════════════════════════\n');

  // ── Setup mode: just fetch the Person URN ─────────────────────
  if (isSetup) {
    try {
      const profiles = await listProfiles();
      const linkedin = profiles.find(p => p.service === 'linkedin');
      if (linkedin) {
        console.log(`\n✅ Set this as BUFFER_PROFILE_ID: ${linkedin.id}`);
      } else {
        console.log('\n⚠️  No LinkedIn profile found. Connect LinkedIn in Buffer first.');
      }
    } catch (err) {
      console.error(`❌ Setup failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── STEP 1: Research ──────────────────────────────────────────
  console.log('📡 STEP 1/4 — Researching trends...\n');
  let researchContext;
  try {
    researchContext = await research();
    console.log(`\n✅ Research complete\n`);
  } catch (err) {
    console.error(`❌ Research failed: ${err.message}`);
    researchContext = 'IA agéntica, marketing autónomo, tendencias TikTok 2026';
  }

  // ── STEP 2: Draft ─────────────────────────────────────────────
  console.log('✍️  STEP 2/4 — Drafting LinkedIn post...\n');
  let postText;
  try {
    postText = await draft(researchContext);
    console.log(`\n✅ Draft complete\n`);
    console.log('─── POST PREVIEW ───');
    console.log(postText);
    console.log('─── END PREVIEW ────\n');
  } catch (err) {
    console.error(`❌ Draft failed: ${err.message}`);
    await logPost({
      postText: '',
      researchContext,
      published: false,
      error: `Draft failed: ${err.message}`,
    });
    process.exit(1);
  }

  // ── STEP 3: Publish ───────────────────────────────────────────
  if (isDryRun) {
    console.log('🏃 DRY RUN — Skipping publish\n');
    await logPost({
      postText,
      researchContext,
      published: false,
      error: 'dry-run',
    });
  } else {
    console.log('🚀 STEP 3/4 — Publishing to LinkedIn via Buffer...\n');
    const result = await publish(postText, { now: true });

    if (result.ok) {
      console.log(`✅ Published via Buffer! ID: ${result.updateId}\n`);
    } else {
      console.error(`❌ Publish failed: ${result.error}`);

      // Retry once after 30 seconds
      console.log('⏳ Retrying in 30 seconds...');
      await new Promise(r => setTimeout(r, 30_000));
      const retry = await publish(postText, { now: true });

      if (retry.ok) {
        console.log(`✅ Retry succeeded! ID: ${retry.updateId}\n`);
        result.ok = true;
        result.updateId = retry.updateId;
      } else {
        console.error(`❌ Retry also failed: ${retry.error}`);
        result.error = `Original: ${result.error} | Retry: ${retry.error}`;
      }
    }

    // ── STEP 4: Log ───────────────────────────────────────────────
    console.log('📝 STEP 4/4 — Logging results...\n');
    await logPost({
      postText,
      researchContext,
      published: result.ok,
      error: result.ok ? null : result.error,
      bufferUpdateId: result.updateId,
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('═══════════════════════════════════════════');
  console.log(`  ✅ Lyra cycle complete in ${elapsed}s`);
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('💥 Unhandled error:', err);
  process.exit(1);
});
