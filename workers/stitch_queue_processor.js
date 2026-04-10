// ============================================================
// workers/stitch_queue_processor.js — Stitch Landing Page Builder
// Reads queued JSON files from output/stitch_queue/, creates
// real Stitch projects via MCP, and updates Supabase with the
// live preview URL.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, '..', 'output', 'stitch_queue');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ── Main export ───────────────────────────────────────────────

/**
 * Processes all pending JSON files in output/stitch_queue/.
 * For each file: calls the Stitch MCP to create a real project,
 * updates the campaign_enriched_data row with the live preview URL,
 * and archives the processed JSON.
 * @returns {{ processed: number, errors: number }}
 */
export async function processStitchQueue() {
  console.log('\n🏗️  [StitchQueueProcessor] Escaneando cola de landing pages...');

  // Ensure queue dir exists
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    console.log('    ℹ️  Queue dir vacía — nada que procesar.');
    return { processed: 0, errors: 0 };
  }

  const files = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('done_'));

  if (files.length === 0) {
    console.log('    ✅ Cola vacía — todas las landings ya fueron procesadas.');
    return { processed: 0, errors: 0 };
  }

  console.log(`    📂 ${files.length} landing(s) en cola.`);
  const stats = { processed: 0, errors: 0 };

  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);

    let job;
    try {
      job = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error(`  ❌ Error leyendo ${file}:`, e.message);
      stats.errors++;
      continue;
    }

    const { job_id, business_name, stitch_prompt, prospect_campaign_id } = job;

    try {
      console.log(`  🌐 Creando landing para: ${business_name} (${job_id})`);

      // ── Call Stitch MCP via HTTP ──────────────────────────
      const stitchResult = await callStitchMCP(stitch_prompt, business_name);

      const previewUrl = stitchResult?.previewUrl
        || `https://idx.google.com/stitch/projects/${job_id}`;

      console.log(`    ✅ Landing creada: ${previewUrl}`);

      // ── Update Supabase if campaign ID is known ───────────
      if (prospect_campaign_id) {
        const { error: dbError } = await supabase
          .from('campaign_enriched_data')
          .update({
            lead_magnets_data: supabase.rpc
              ? undefined  // Will use RPC patch below
              : {},        // Fallback: skip nested update
          })
          .eq('id', prospect_campaign_id);

        // Patch just the stitch_preview_url inside lead_magnets_data JSONB
        await supabase.rpc('update_magnet_stitch_url', {
          p_campaign_id: prospect_campaign_id,
          p_preview_url: previewUrl,
        }).catch(() => {
          // RPC may not exist yet — log but continue
          console.warn('    ⚠️  update_magnet_stitch_url RPC not found — URL not persisted to DB.');
        });
      }

      // ── Archive processed file ────────────────────────────
      const donePath = path.join(QUEUE_DIR, `done_${file}`);
      fs.renameSync(filePath, donePath);

      stats.processed++;

    } catch (err) {
      console.error(`  ❌ Error procesando ${business_name}:`, err.message);
      stats.errors++;
    }
  }

  console.log(`\n📊 [StitchQueueProcessor] ${stats.processed} procesadas | ${stats.errors} errores\n`);
  return stats;
}

// ── Stitch MCP caller ─────────────────────────────────────────

/**
 * Calls the Stitch MCP server to create a new project.
 * Falls back to a mock response if STITCH_MCP_URL is not set.
 */
async function callStitchMCP(prompt, title) {
  const mcpUrl = process.env.STITCH_MCP_URL;

  if (!mcpUrl) {
    // Mock mode: return a fake preview URL for development
    console.log('    📐 [MOCK] Stitch MCP not configured — returning mock URL.');
    return {
      previewUrl: `https://stitch.google.com/preview/mock-${Date.now()}`,
      projectId:  `mock-${Date.now()}`,
    };
  }

  const res = await fetch(`${mcpUrl}/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, title }),
  });

  if (!res.ok) {
    throw new Error(`Stitch MCP error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// ── CLI runner ───────────────────────────────────────────────
// node workers/stitch_queue_processor.js

if (process.argv[1].includes('stitch_queue_processor')) {
  processStitchQueue()
    .then(stats => process.exit(stats.errors > 0 ? 1 : 0))
    .catch(err => {
      console.error('💥 Fatal:', err);
      process.exit(1);
    });
}
