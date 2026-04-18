// ============================================================
// lead_magnet_worker.js — Niche-Based Landing Image Selector
// Detects leads with lead_magnet_status = 'IDLE', matches their
// industry to a pre-built website screenshot from assets/landing_niches/,
// and stores the image path for outreach attachment.
// No AI calls — pure deterministic niche mapping.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordAgentEvent } from './lib/agentEventsSink.js';
import { logOutreachEvent } from './tools/outreachEvents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const LEAD_MAGNET_BUCKET = process.env.SUPABASE_LEAD_MAGNET_BUCKET || 'lead-magnets';

// Map file extension → Content-Type for Supabase Storage upload.
function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png')  return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf')  return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Upload the chosen asset to the public lead-magnet bucket and return
 * its public URL. Returns null (without throwing) if the bucket isn't
 * reachable — the local path is still useful for SMTP attachments.
 */
export async function uploadMagnetToStorage({ absolutePath, fileName, brandId, leadId, storageClient = null }) {
  // `storageClient` allows tests to inject a stubbed supabase client.
  const client = storageClient || supabase;
  if (!client) return null;
  return _uploadWithClient(client, { absolutePath, fileName, brandId, leadId });
}

async function _uploadWithClient(client, { absolutePath, fileName, brandId, leadId }) {
  try {
    const buffer = fs.readFileSync(absolutePath);
    const storagePath = `${brandId || 'unknown-brand'}/${leadId}/${fileName}`;
    const { error: upErr } = await client.storage
      .from(LEAD_MAGNET_BUCKET)
      .upload(storagePath, buffer, {
        contentType: contentTypeFor(fileName),
        upsert: true,
      });
    if (upErr) {
      console.warn(`  ⚠️ [Storage] Upload to bucket "${LEAD_MAGNET_BUCKET}" failed: ${upErr.message}. Crealo manualmente en Supabase si no existe.`);
      return null;
    }
    const { data: urlData } = client.storage.from(LEAD_MAGNET_BUCKET).getPublicUrl(storagePath);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.warn(`  ⚠️ [Storage] Upload threw: ${e?.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// NICHE → FOLDER MAPPING
// Maps industry keywords (from leads.industry) to the folder
// name inside assets/landing_niches/
// Order matters: first match wins (most specific first).
// ────────────────────────────────────────────────────────────
const NICHE_MAP = [
  { keywords: ['clean', 'maid', 'limpieza', 'janitorial', 'washing'],           folder: '1. Limpieza (cleaning)' },
  { keywords: ['construct', 'general contractor', 'construcción', 'builder'],    folder: '2. Construcción (construction)' },
  { keywords: ['roof', 'techado', 'techo'],                                     folder: '3. Techado (roofing)' },
  { keywords: ['remodel', 'renovation', 'remodelación', 'interior', 'kitchen', 'bath'], folder: '4. Remodelación (remodeling)' },
  { keywords: ['handyman', 'mantenimiento', 'odd job', 'repair'],               folder: '5. Handyman' },
  { keywords: ['paint', 'pintura', 'coating'],                                  folder: '6. Pintura (painting)' },
  { keywords: ['landscape', 'lawn', 'garden', 'paisajismo', 'césped', 'tree', 'yard'], folder: '7. Paisajismo (landscaping)' },
  { keywords: ['electric', 'electricidad', 'wiring', 'solar panel'],            folder: '8. Electricidad' },
  { keywords: ['plumb', 'plomería', 'drain', 'pipe', 'water heater'],           folder: '9. Plomería (plumbing)' },
  { keywords: ['hvac', 'air condition', 'heating', 'cooling', 'aire acondicionado', 'ac '], folder: '10. Aire acondicionado (HVAC)' },
];

// Default fallback if no niche matches
const DEFAULT_FOLDER = '5. Handyman';
const ASSETS_BASE = path.join(__dirname, 'assets', 'landing_niches');

/**
 * Matches a lead's industry string to the correct niche folder.
 * @param {string} industry — e.g. "Landscaping", "Residential Cleaning"
 * @returns {string} Folder name inside assets/landing_niches/
 */
export function matchNicheFolder(industry, ctx = {}) {
  if (!industry) {
    recordAgentEvent({
      trace_id: ctx.traceId || `lead-magnet-${ctx.recordId || 'unknown'}`,
      brand_id: ctx.brandId || null,
      agent: 'lead_magnet_worker',
      event_type: 'LEAD_MAGNET_NO_NICHE',
      status: 'fallback',
      metadata: { industry: null, fallback: DEFAULT_FOLDER, reason: 'empty_industry' },
    });
    return DEFAULT_FOLDER;
  }
  const lower = industry.toLowerCase();

  for (const niche of NICHE_MAP) {
    if (niche.keywords.some(kw => lower.includes(kw))) {
      return niche.folder;
    }
  }

  console.log(`  ⚠️ [Niche] No match for "${industry}", using default: ${DEFAULT_FOLDER}`);
  recordAgentEvent({
    trace_id: ctx.traceId || `lead-magnet-${ctx.recordId || 'unknown'}`,
    brand_id: ctx.brandId || null,
    agent: 'lead_magnet_worker',
    event_type: 'LEAD_MAGNET_NO_NICHE',
    status: 'fallback',
    metadata: { industry, fallback: DEFAULT_FOLDER },
  });
  return DEFAULT_FOLDER;
}

/**
 * Picks a random image (PNG/JPG/PDF) from the niche folder.
 * @param {string} folderName — e.g. "7. Paisajismo (landscaping)"
 * @returns {{ absolutePath: string, relativePath: string, fileName: string } | null}
 */
function pickRandomImage(folderName) {
  const folderPath = path.join(ASSETS_BASE, folderName);

  if (!fs.existsSync(folderPath)) {
    console.error(`  ❌ [Assets] Folder not found: ${folderPath}`);
    return null;
  }

  const files = fs.readdirSync(folderPath).filter(f =>
    /\.(png|jpg|jpeg|webp|pdf)$/i.test(f)
  );

  if (files.length === 0) {
    console.error(`  ❌ [Assets] No images in folder: ${folderName}`);
    return null;
  }

  const chosen = files[Math.floor(Math.random() * files.length)];
  return {
    absolutePath: path.join(folderPath, chosen),
    relativePath: path.join('assets', 'landing_niches', folderName, chosen),
    fileName: chosen,
  };
}

/**
 * Main export — processes up to 10 IDLE leads per cycle.
 * Called by the setInterval loop in index.js (every 30s).
 */
let _bucketCheckDone = false;
async function warnIfBucketMissing() {
  if (_bucketCheckDone || !supabase) return;
  _bucketCheckDone = true;
  try {
    // listBuckets requires the service_role key; if it fails we just warn once.
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      console.warn(`⚠️ [Lead Magnet Worker] No se pudo listar buckets (${error.message}). Asegurate que exista "${LEAD_MAGNET_BUCKET}" como bucket PÚBLICO en Supabase.`);
      return;
    }
    const exists = Array.isArray(data) && data.some(b => b.name === LEAD_MAGNET_BUCKET);
    if (!exists) {
      console.warn(`⚠️ [Lead Magnet Worker] Bucket "${LEAD_MAGNET_BUCKET}" no existe en Supabase Storage. Crealo manualmente (público) para que los mockups tengan URL embebible. Los uploads van a fallar silenciosamente hasta que lo crees.`);
    }
  } catch (e) {
    console.warn(`⚠️ [Lead Magnet Worker] Chequeo de bucket falló: ${e?.message}`);
  }
}

export async function processIdleMagnets() {
  if (!supabase) {
    console.error('❌ [Lead Magnet Worker] Supabase no está configurado (falta URL o Key).');
    return;
  }

  await warnIfBucketMissing();

  const { data: campaignData, error } = await supabase
    .from('campaign_enriched_data')
    .select(`
      id,
      prospect_id,
      brand_id,
      leads!inner (
        business_name,
        industry
      )
    `)
    .eq('lead_magnet_status', 'IDLE')
    .limit(10);

  if (error) {
    console.error('❌ [Lead Magnet Worker] Query error:', error.message);
    return;
  }

  if (!campaignData || campaignData.length === 0) return;

  console.log(`🎯 [Lead Magnet Worker] Processing ${campaignData.length} IDLE leads...`);

  for (const record of campaignData) {
    const lead = record.leads;
    const brandId = record.brand_id || null;
    const nicheFolder = matchNicheFolder(lead.industry, {
      brandId,
      recordId: record.id,
      traceId: `lead-magnet-${record.id}`,
    });
    const image = pickRandomImage(nicheFolder);

    if (!image) {
      // Mark as ERROR if no image available for this niche
      await supabase
        .from('campaign_enriched_data')
        .update({ lead_magnet_status: 'ERROR' })
        .eq('id', record.id);
      console.log(`  ❌ ${lead.business_name} → No image for niche "${nicheFolder}"`);
      continue;
    }

    // Upload to public Supabase Storage bucket (best-effort; falls back to local path).
    const publicUrl = await uploadMagnetToStorage({
      absolutePath: image.absolutePath,
      fileName: image.fileName,
      brandId,
      leadId: record.prospect_id,
    });

    // Update with image data and mark COMPLETED
    const magnetData = {
      magnet_type: 'website_screenshot',
      niche_folder: nicheFolder,
      image_path: image.relativePath,
      image_file: image.fileName,
      public_url: publicUrl,
      assigned_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('campaign_enriched_data')
      .update({
        lead_magnet_status: 'COMPLETED',
        lead_magnets_data: magnetData,
      })
      .eq('id', record.id);

    if (updateError) {
      console.error(`  ❌ ${lead.business_name} → DB update failed:`, updateError.message);
      continue;
    }

    console.log(`  ✅ ${lead.business_name} (${lead.industry}) → ${nicheFolder} → ${image.fileName}${publicUrl ? ' (uploaded)' : ' (local only)'}`);

    // Learning-loop: landing/sent event (silent-fail when LEARNING_ENABLED=false)
    logOutreachEvent({
      leadId:   record.prospect_id,
      brandId:  brandId,
      channel:  'landing',
      eventType: 'sent',
      metadata: {
        magnet_type: 'website_screenshot',
        niche_folder: nicheFolder,
        industry: lead.industry || null,
        public_url: publicUrl || null,
      },
    }).catch(() => {});
  }
}
