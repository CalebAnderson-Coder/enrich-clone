// ============================================================
// scripts/send_sourced_hvac_2026-05-06.js
//
// Reads the most recent filtered.json from sourcing, dedupes
// against leads already in Supabase, picks top N by score,
// guesses email (info@<domain>), then for each:
//   1. Insert into leads (brand_id=Empírika, outreach_status='PENDING')
//   2. Render HVAC template + rotating screenshot, send via SMTP
//   3. Mark outreach_status='SENT' + dates
//   4. Create GHL contact (with phone, address, website)
//   5. Create GHL opportunity in COLD LEADS pipeline → stage CONTACTADO
//   6. Add tags: empirika-cold-email, manual-send-<date>, canal-email,
//      hvac-fl, tier-hot, score-XX, <metro-slug>
//   7. Drop a [empirika-perfil:v1] note with full lead data
//   8. Log outreach_events row with GHL IDs in metadata
//
// Throttle: ~90s between sends to keep Gmail SMTP healthy.
//
// Usage:
//   node scripts/send_sourced_hvac_2026-05-06.js --limit=30
//   node scripts/send_sourced_hvac_2026-05-06.js --dry-run
//   node scripts/send_sourced_hvac_2026-05-06.js --file=<path>
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { renderMagnetEmail } from '../lib/emailRenderer.js';
import { logOutreachEvent } from '../tools/outreachEvents.js';
import { discoverEmail } from '../lib/emailVerifier.js';
import { randomUUID } from 'crypto';
import dns from 'dns/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RESEARCH_DIR = path.join(REPO_ROOT, '.omc', 'research');

// ── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 30;
const fileArg = args.find(a => a.startsWith('--file='));
const FILE_PATH = fileArg ? fileArg.split('=')[1] : null;
const skipArg = args.find(a => a.startsWith('--skip-domain='));
const SKIP_DOMAINS = skipArg ? skipArg.split('=')[1].split(',') : [];

// ── Constants ────────────────────────────────────────────────
const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';
const STAGE_CONTACTADO = 'c1d2e758-5235-4469-b0b5-95d4fb06cdc4';
const NICHE_FOLDER = '10. Aire acondicionado (HVAC)';
const SCREENSHOT_FILES = [
  'screencapture-st-ourhtmldemo-new-Aircare-2026-03-30-17_38_21.png',
  'screencapture-hadiman-vercel-app-home4-html-2026-03-30-17_41_58.png',
  'screencapture-airsupply-html-themerex-net-2026-03-30-17_37_29.png',
  'screencapture-html-storebuild-shop-airvice-prv-airvice-index-html-2026-03-30-17_38_57.png',
];
const THROTTLE_MS = parseInt(process.env.SEND_THROTTLE_MS || '90000', 10);

// ── Supabase ─────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

// ── SMTP ─────────────────────────────────────────────────────
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = process.env.SMTP_FROM_NAME || 'José Sánchez';
const FROM_ADDR = SMTP_USER || 'jsanchez@empirikagroup.com';
const transporter = SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS.trim() },
      tls: { rejectUnauthorized: false },
    })
  : null;

// ── GHL ──────────────────────────────────────────────────────
const GHL_TOKEN =
  process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const GHL_LOC = process.env.GHL_LOCATION_ID || 'uQPxZOmT4zVlMHfOGRw2';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = GHL_TOKEN
  ? {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  : null;

// ── Helpers ──────────────────────────────────────────────────
function pickFile() {
  if (FILE_PATH) return FILE_PATH;
  const files = fs
    .readdirSync(RESEARCH_DIR)
    .filter(f => f.startsWith('hvac_fl_') && f.endsWith('_filtered.json'))
    .map(f => ({ f, mtime: fs.statSync(path.join(RESEARCH_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    console.error(`FATAL: no hvac_fl_*_filtered.json in ${RESEARCH_DIR}`);
    process.exit(1);
  }
  return path.join(RESEARCH_DIR, files[0].f);
}

function domainOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `http://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

async function hasMxRecord(domain) {
  if (!domain) return false;
  try {
    const recs = await dns.resolveMx(domain);
    return recs.length > 0;
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function metroSlug(metro) {
  return String(metro || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── GHL ops ──────────────────────────────────────────────────
async function ghlCreateContact(lead) {
  const body = {
    locationId: GHL_LOC,
    firstName: lead.business_name,
    companyName: lead.business_name,
    email: lead.email_address,
    phone: lead.phone || undefined,
    address1: lead.address || undefined,
    city: lead.city || undefined,
    state: lead.state || 'FL',
    country: 'US',
    website: lead.website || undefined,
    source: 'Empírika cold email — Apify GMaps 2026-05-06',
    tags: lead.tags,
  };
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok && !j?.contact?.id) {
    throw new Error(`GHL contact create ${res.status}: ${JSON.stringify(j).slice(0, 250)}`);
  }
  return j.contact?.id || j?.id;
}

async function ghlCreateOpportunity(contactId, name) {
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({
      pipelineId: PIPELINE_ID,
      pipelineStageId: STAGE_CONTACTADO,
      contactId,
      name,
      status: 'open',
      locationId: GHL_LOC,
    }),
  });
  const j = await res.json();
  if (!res.ok && !j?.opportunity?.id) {
    throw new Error(`GHL oppty create ${res.status}: ${JSON.stringify(j).slice(0, 250)}`);
  }
  return j.opportunity?.id || j?.id;
}

async function ghlAddNote(contactId, body) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn(`  [WARN] note: ${res.status} ${t.slice(0, 120)}`);
  }
}

function buildPerfilNote(lead, sentInfo) {
  const dt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `[empirika-perfil:v1] PERFIL COMPLETO DEL LEAD
═══════════════════════════════════════════════
🏢 Negocio: ${lead.business_name}
📍 Dirección: ${lead.address || '—'}
🏭 Industria: HVAC
🌎 Metro: ${lead.metro_area}

📊 CALIFICACIÓN
• Score Empírika: ${lead.qualification_score}/100
• Tier: HOT 🔥
• Reviews Google: ${lead.review_count} · Rating ${lead.rating}⭐
• Sitio web activo: Sí

📞 CANALES DISPONIBLES
• Email: ${lead.email_address} (✓ contactado ${dt} UTC)
• Teléfono: ${lead.phone || '—'}
• Web: ${lead.website || '—'}
• Google Maps: ${lead.google_maps_url || '—'}

🎯 ESTADO OUTREACH
• Stage: CONTACTADO (canal email)
• Primer contacto: ${dt} UTC
• Próximo follow-up automático: 48h después
• Source: Apify Google Maps · 2026-05-06 (sourcing run Hialeah/Doral/Kissimmee/Miami Beach)

🔗 IDs sistema
• Lead Supabase: ${lead.id}
• Brand: Empírika`;
}

// ── Send loop ────────────────────────────────────────────────
async function processOne(target, idx) {
  const tagsExtra = [
    'empirika-cold-email',
    'manual-send-2026-05-06',
    'canal-email',
    'hvac-fl',
    'tier-hot',
    `score-${target.qualification_score}`,
    metroSlug(target.metro_area),
  ];

  const screenshot = SCREENSHOT_FILES[idx % SCREENSHOT_FILES.length];
  const imagePath = path.join(REPO_ROOT, 'assets', 'landing_niches', NICHE_FOLDER, screenshot);

  const { subject, html, attachments } = renderMagnetEmail(
    {
      magnet_type: 'website_screenshot',
      niche_folder: NICHE_FOLDER,
      image_path: imagePath,
      image_file: screenshot,
    },
    {
      business_name: target.business_name,
      industry: 'HVAC',
      email_address: target.email_address,
      metro_area: target.metro_area,
      id: target.id,
    },
  );

  console.log(`\n[${idx + 1}] ${target.business_name} <${target.email_address}>`);
  console.log(`    metro: ${target.metro_area} · score ${target.qualification_score} · ${target.review_count} rev`);
  console.log(`    subject: ${subject}`);
  console.log(`    image: ${screenshot}`);

  if (DRY_RUN) {
    console.log('    [DRY] no send / no DB / no GHL');
    return { status: 'dry_run' };
  }
  if (!transporter) {
    console.log('    [WARN] SMTP not configured');
    return { status: 'no_transport' };
  }

  // 1. Insert lead row
  const leadId = randomUUID();
  const { error: insertErr } = await supabase.from('leads').insert({
    id: leadId,
    brand_id: BRAND_ID,
    business_name: target.business_name,
    industry: 'HVAC',
    metro_area: target.metro_area,
    phone: target.phone || null,
    email_address: target.email_address,
    website: target.website || null,
    google_maps_url: target.google_maps_url || null,
    review_count: target.review_count,
    rating: target.rating,
    has_website: true,
    qualification_score: target.qualification_score,
    lead_tier: 'HOT',
    score_breakdown: {},
    mega_profile: { address: target.address || '' },
    scraped_by: 'apify_compass_2026-05-06_run2',
    outreach_status: 'PENDING',
    notes: 'Sourceado 2026-05-06 batch HVAC FL Latino-density metros',
  });
  if (insertErr) {
    console.error(`    ✗ DB insert: ${insertErr.message}`);
    return { status: 'db_error', error: insertErr.message };
  }

  // 2. Send email
  let info;
  try {
    info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_ADDR}>`,
      to: [target.email_address],
      subject,
      html,
      attachments,
    });
    console.log(`    ✓ sent — ${info.messageId}`);
  } catch (err) {
    console.error(`    ✗ SMTP: ${err.message}`);
    await supabase.from('outreach_events').insert({
      lead_id: leadId,
      brand_id: BRAND_ID,
      channel: 'email',
      event_type: 'failed',
      metadata: { to: target.email_address, error: err.message, script: 'send_sourced_hvac_2026-05-06' },
    });
    return { status: 'smtp_error', error: err.message };
  }

  // 3. Mark SENT
  const sentAt = new Date().toISOString();
  await supabase.from('leads').update({
    outreach_status: 'SENT',
    last_contact_date: sentAt,
    first_contact_date: sentAt,
  }).eq('id', leadId);

  // 4. GHL create contact
  let ghlContactId = null;
  let ghlOpptyId = null;
  try {
    const addrParts = (target.address || '').split(',').map(s => s.trim());
    ghlContactId = await ghlCreateContact({
      ...target,
      email_address: target.email_address,
      address: addrParts[0] || target.address,
      city: addrParts[1] || (target.metro_area || '').split(',')[0],
      state: 'FL',
      tags: tagsExtra,
    });
    console.log(`    GHL contact: ${ghlContactId}`);
  } catch (err) {
    console.warn(`    [WARN] GHL contact: ${err.message}`);
  }

  // 5. GHL create opportunity
  if (ghlContactId) {
    try {
      ghlOpptyId = await ghlCreateOpportunity(
        ghlContactId,
        `${target.business_name} — HVAC ${target.metro_area.split(',')[0]}`,
      );
      console.log(`    GHL oppty:   ${ghlOpptyId}`);
    } catch (err) {
      console.warn(`    [WARN] GHL oppty: ${err.message}`);
    }

    // 6. GHL note
    target.id = leadId;
    const noteBody = buildPerfilNote(target, info);
    await ghlAddNote(ghlContactId, noteBody);
  }

  // 7. Log outreach_events
  await logOutreachEvent({
    leadId,
    brandId: BRAND_ID,
    channel: 'email',
    eventType: 'sent',
    metadata: {
      from: FROM_ADDR,
      sender_name: FROM_NAME,
      followup: false,
      niche_folder: NICHE_FOLDER,
      image_file: screenshot,
      has_attachment: true,
      manual_send: true,
      script: 'send_sourced_hvac_2026-05-06',
      email_verified: true,
      email_source: target.email_source,
      email_alternates: target.email_alternates,
      ghl_contact_id: ghlContactId,
      ghl_opportunity_id: ghlOpptyId,
      ghl_pipeline_id: PIPELINE_ID,
      ghl_stage_id: STAGE_CONTACTADO,
      ghl_stage_name: 'CONTACTADO',
    },
    messageId: info.messageId,
  });

  return {
    status: 'sent',
    messageId: info.messageId,
    leadId,
    ghlContactId,
    ghlOpptyId,
  };
}

// ── Main ─────────────────────────────────────────────────────
(async () => {
  const file = pickFile();
  console.log(`\n=== Empírika send sourced HVAC FL · ${new Date().toISOString()} ===`);
  console.log(`File:     ${file}`);
  console.log(`Mode:     ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Limit:    ${LIMIT}`);
  console.log(`SMTP:     ${transporter ? `OK (${FROM_ADDR})` : 'NOT CONFIGURED'}`);
  console.log(`GHL:      ${GHL_HEADERS ? 'OK' : 'NOT CONFIGURED'}`);
  console.log(`Throttle: ${(THROTTLE_MS / 1000).toFixed(0)}s between sends\n`);

  const candidates = JSON.parse(fs.readFileSync(file, 'utf-8'));
  console.log(`Loaded ${candidates.length} candidates from file.`);

  // Dedupe vs Supabase by domain (already-contacted protection)
  const { data: existing } = await supabase
    .from('leads')
    .select('email_address, website')
    .eq('brand_id', BRAND_ID);
  const knownDomains = new Set();
  const knownEmails = new Set();
  for (const e of existing || []) {
    if (e.email_address) knownEmails.add(e.email_address.toLowerCase());
    const d = domainOf(e.website);
    if (d) knownDomains.add(d);
  }

  // Build send list — verify each candidate's email by scraping their site
  const sendList = [];
  console.log(`\nVerificando emails (scraping de cada website)…\n`);
  for (const c of candidates) {
    const dom = domainOf(c.website);
    if (!dom) continue;
    if (SKIP_DOMAINS.includes(dom)) continue;
    if (knownDomains.has(dom)) {
      console.log(`  · skip ${c.name} — ya está en DB (${dom})`);
      continue;
    }
    const hasMx = await hasMxRecord(dom);
    if (!hasMx) {
      console.log(`  · skip ${c.name} — sin MX para ${dom}`);
      continue;
    }

    process.stdout.write(`  · ${c.name.padEnd(45)} `);
    const result = await discoverEmail(c.website);
    if (!result) {
      console.log(`✗ sin email publicado en sitio`);
      continue;
    }
    if (knownEmails.has(result.email)) {
      console.log(`✗ ya en DB: ${result.email}`);
      continue;
    }
    console.log(`✓ ${result.email}  (de ${result.source.replace(/^https?:\/\//, '').slice(0, 40)})`);

    sendList.push({
      business_name: c.name,
      metro_area: c.metro_area,
      address: c.address,
      phone: c.phone,
      website: c.website,
      google_maps_url: c.googleMapsUrl,
      review_count: c.reviewCount,
      rating: c.rating,
      qualification_score: c.qualification_score,
      email_address: result.email,
      email_source: result.source,
      email_alternates: result.allFound.filter(e => e !== result.email),
    });
    if (sendList.length >= LIMIT) break;
  }

  console.log(`\nSend list: ${sendList.length} leads ready.\n`);
  if (!sendList.length) {
    console.log('Nada que enviar.');
    return;
  }

  const results = [];
  for (let i = 0; i < sendList.length; i++) {
    const r = await processOne(sendList[i], i);
    results.push(r);
    if (!DRY_RUN && i < sendList.length - 1) {
      console.log(`    ... esperando ${THROTTLE_MS / 1000}s`);
      await new Promise(r => setTimeout(r, THROTTLE_MS));
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const errors = results.filter(r => r.status?.endsWith('_error')).length;
  const skipped = results.filter(r => ['dry_run', 'no_transport'].includes(r.status)).length;

  console.log(`\n=== Resumen ===`);
  console.log(`Sent:    ${sent}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Skipped: ${skipped}`);
  process.exit(errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
