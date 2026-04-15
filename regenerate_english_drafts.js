/**
 * regenerate_english_drafts.js (ESM)
 * ───────────────────────────────────
 * Regenerates outreach drafts in English for all leads that have
 * Spanish drafts, no drafts, or empty copy.
 *
 * Usage: node regenerate_english_drafts.js
 * (dotenv loaded via --env-file flag or package.json "scripts")
 */

import 'dotenv/config';
import { createClient }      from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const sb    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ── Config ──────────────────────────────────────────────────────────────────
const BATCH_SIZE = 4;
const DELAY_MS   = 2500;
const MAX_LEADS  = 60;

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function detectEnglish(text) {
  if (!text || text.length < 20) return false;
  const spanishSignals = [
    /\bHola\b/i, /\bEstimad[oa]\b/i, /\bGracias\b/i, /\bSaludos\b/i,
    /\bNegocio\b/i, /\bMercado\b/i, /\bServicios\b/i, /\bAtentamente\b/i,
    /\bCordialmente\b/i, /\bDisponibilidad\b/i, /\bPresencia\b/i,
    /\bImpulsa\b/i, /\bCrecer\b/i,
  ];
  const hits = spanishSignals.filter(r => r.test(text)).length;
  return hits < 2;
}

const ANGELA_SYSTEM = `You are Angela Rodriguez, a Growth Strategist at Empirika Digital.
You write cold outreach emails to small business owners in Florida and Texas.

IRON RULE — ZERO EXCEPTIONS: Every single word must be in ENGLISH.
No Spanish. No Spanglish. No bilingual mixing.
The US market clients never respond to non-English outreach.

Write like a real human who genuinely noticed something valuable about their business.`;

async function generateEnglishDraft(lead) {
  const mega       = lead.mega_profile || {};
  const painPoints = mega.pain_points || 'their online presence could bring them more customers';
  const situation  = mega.situational_summary || '';
  const biz        = lead.business_name;
  const city       = lead.metro_area || lead.city || 'Florida';
  const industry   = lead.industry   || 'home services';
  const rating     = lead.rating     ? `${lead.rating}⭐` : '';
  const reviews    = lead.review_count ? `(${lead.review_count} reviews)` : '';
  const website    = lead.website    || null;

  const userPrompt = `Write a cold outreach email to this prospect. ALL WORDS IN ENGLISH:

Business: ${biz}
City: ${city}
Industry: ${industry}
${website  ? `Website: ${website}` : 'Website: none found — this is a strong hook'}
${rating   ? `Google Rating: ${rating} ${reviews}` : ''}
${situation ? `Context: ${situation}` : ''}
${painPoints ? `Pain point: ${painPoints}` : ''}

Requirements:
- Subject line: max 50 chars, curiosity + benefit hook
- 3-4 paragraphs, ~150 words total
- Reference something specific: their city, niche, star rating, or lack of website
- Value prop: Empirika Digital helps Hispanic-owned service businesses in the US grow online and get more customers
- One clear CTA: book a free 15-min discovery call
- Professional closing + PS line with urgency

Write ONLY the email. Format:

Subject: [subject here]

[Email body]

Best,
Angela Rodriguez
Growth Strategist | Empirika Digital
angela@empirika.digital

P.S. [PS line]`;

  const chat = model.startChat({
    history: [
      { role: 'user',  parts: [{ text: ANGELA_SYSTEM }] },
      { role: 'model', parts: [{ text: 'Understood completely. I will write every email 100% in English, as Angela Rodriguez from Empirika Digital.' }] },
    ],
  });

  const result = await chat.sendMessage(userPrompt);
  return result.response.text().trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  ENGLISH DRAFT REGENERATION ENGINE  — Empirika Digital    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // 1. Fetch leads
  const { data: allLeads, error: leadsErr } = await sb
    .from('leads')
    .select('id, business_name, metro_area, industry, website, phone, email, rating, review_count, mega_profile')
    .order('created_at', { ascending: false })
    .limit(MAX_LEADS + 20);

  if (leadsErr) { console.error('❌ Lead fetch error:', leadsErr.message); process.exit(1); }
  console.log(`📋 Total leads: ${allLeads.length}`);

  // 2. Fetch existing campaigns
  const { data: allCamps } = await sb
    .from('campaign_enriched_data')
    .select('prospect_id, outreach_copy, status, id')
    .in('prospect_id', allLeads.map(l => l.id));

  const campMap = {};
  (allCamps || []).forEach(c => { campMap[c.prospect_id] = c; });

  // 3. Classify leads that need regeneration
  const targets = [];
  for (const lead of allLeads) {
    const camp = campMap[lead.id];
    if (!camp)                                    targets.push({ lead, reason: 'NO_CAMPAIGN' });
    else if (!camp.outreach_copy)                 targets.push({ lead, reason: 'NO_COPY' });
    else if (!detectEnglish(camp.outreach_copy))  targets.push({ lead, reason: 'SPANISH_DRAFT' });
    if (targets.length >= MAX_LEADS) break;
  }

  const counts = targets.reduce((a, { reason }) => ({ ...a, [reason]: (a[reason]||0)+1 }), {});
  console.log(`\n🎯 Leads needing English drafts: ${targets.length}`);
  Object.entries(counts).forEach(([k, v]) => console.log(`   • ${k}: ${v}`));

  if (targets.length === 0) {
    console.log('\n✅ All leads already have English drafts! Dashboard is ready.\n');
    return;
  }
  console.log();

  // 4. Process in batches
  let succeeded = 0, failed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch      = targets.slice(i, i + BATCH_SIZE);
    const batchNum   = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatch = Math.ceil(targets.length / BATCH_SIZE);
    console.log(`⚡ Batch ${batchNum}/${totalBatch} — ${batch.length} leads`);

    const results = await Promise.allSettled(
      batch.map(async ({ lead, reason }) => {
        try {
          const draft = await generateEnglishDraft(lead);
          if (!draft || draft.length < 80) throw new Error('Draft too short');
          if (!detectEnglish(draft))       throw new Error('Language check FAILED — still Spanish');

          const camp = campMap[lead.id];
          let dbErr;

          if (camp) {
            const { error } = await sb
              .from('campaign_enriched_data')
              .update({ outreach_copy: draft, status: 'DRAFT' })
              .eq('prospect_id', lead.id);
            dbErr = error;
          } else {
            const { error } = await sb
              .from('campaign_enriched_data')
              .insert({
                prospect_id:   lead.id,
                outreach_copy: draft,
                status:        'DRAFT',
                attack_angle:  lead.mega_profile?.pain_points || 'Digital presence & online lead generation',
              });
            dbErr = error;
          }

          if (dbErr) throw new Error(`DB: ${dbErr.message}`);

          const preview = draft.split('\n')[0].slice(0, 55);
          console.log(`  ✅ ${lead.business_name.padEnd(38)} "${preview}..."`);
          return { ok: true };
        } catch (err) {
          console.error(`  ❌ ${lead.business_name.padEnd(38)} → ${err.message.slice(0, 65)}`);
          return { ok: false };
        }
      })
    );

    results.forEach(r => r.status === 'fulfilled' && r.value.ok ? succeeded++ : failed++);

    if (i + BATCH_SIZE < targets.length) {
      process.stdout.write(`  ⏳ Rate limit pause ${DELAY_MS}ms...\n`);
      await sleep(DELAY_MS);
    }
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  ✅ ${succeeded}/${targets.length} English drafts generated and saved          `);
  if (failed > 0)
  console.log(`║  ❌ ${failed} failed (check logs above)                          `);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });
