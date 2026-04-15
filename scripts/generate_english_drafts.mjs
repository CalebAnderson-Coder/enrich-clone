/**
 * generate_english_drafts.mjs
 * Generates professional English cold email drafts for all leads
 * that have no draft or have incomplete / Spanish drafts.
 * Writes results directly to Supabase campaign_enriched_data.
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

// ─── helpers ────────────────────────────────────────────────────────────────

function isDraftInvalid(outreach_copy) {
  if (!outreach_copy) return true;
  const txt = outreach_copy.toLowerCase();
  // Placeholders left by incomplete pipeline
  if (txt.includes('i will delegate to angela')) return true;
  if (txt.includes('pendiente de revisión')) return true;
  if (txt.includes('pendiente de revision')) return true;
  if (txt.includes('max iterations')) return true;
  if (txt.includes('after carlos empirika defines')) return true;
  // Spanish-only drafts (outreach must be in English)
  const spanishWords = ['hola ', 'querido ', 'estimado ', 'buenos días', 'buen día', 'saludos'];
  const startsWithSpanish = spanishWords.some(w => txt.startsWith(w) || txt.includes('\n' + w));
  if (startsWithSpanish) return true;
  // Too short to be a real draft
  if (outreach_copy.trim().length < 80) return true;
  return false;
}

async function generateDraft(lead, campaign) {
  const businessName = lead.business_name || 'your business';
  const city = lead.city || 'your area';
  const industry = lead.niche_id || 'home services';
  const website = lead.website || '';
  const rating = lead.rating ? `${lead.rating} stars (${lead.reviews_count} reviews)` : '';
  const attackAngle = campaign.attack_angle || '';
  const radiography = campaign.radiography_technical || '';

  const prompt = `You are Angela, a senior email copywriter at Empírika, a digital marketing agency.

Write a professional cold email IN ENGLISH to the owner of "${businessName}", a ${industry} business based in ${city}, USA.

CONTEXT ABOUT THIS LEAD:
- Website: ${website || 'No website found'}
- Google rating: ${rating || 'Unknown'}
- Digital audit summary: ${radiography ? radiography.substring(0, 400) : 'Local business with limited digital presence'}
- Sales angle: ${attackAngle ? attackAngle.substring(0, 400) : 'Improve digital marketing ROI'}

RULES (MUST FOLLOW):
1. Write ENTIRELY IN ENGLISH — no Spanish words whatsoever
2. DO NOT use placeholders like [Name] or [insert here]
3. Address them as "Hi there," or "Hi [Business Name] team," — do NOT guess owner name
4. Keep subject line under 50 characters
5. Body: 3-4 short paragraphs, professional but warm tone
6. Include ONE clear CTA (schedule a free 15-min call)
7. Sign off as: Angela | Empírika Digital | hello@empirika.agency
8. Make it hyper-specific to their business and location

Return ONLY a JSON object with this exact structure:
{
  "subject": "...",
  "body": "..."
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: extract with regex
      const subjectMatch = cleaned.match(/"subject"\s*:\s*"([^"]+)"/);
      const bodyMatch = cleaned.match(/"body"\s*:\s*"([\s\S]+?)"\s*[,}]/);
      if (subjectMatch && bodyMatch) {
        parsed = {
          subject: subjectMatch[1],
          body: bodyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        };
      } else {
        parsed = {
          subject: `Quick win for ${businessName} in ${city}`,
          body: cleaned,
        };
      }
    }
    
    if (!parsed || !parsed.subject || !parsed.body) throw new Error('Missing fields');
    return parsed;
  } catch (err) {
    console.error(`  ❌ Gemini error for ${businessName}: ${err.message}`);
    return null;
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting English draft generation...\n');

  // 1. Fetch all campaign records + join with prospects
  const { data: campaigns, error: cErr } = await supabase
    .from('campaign_enriched_data')
    .select('id, prospect_id, outreach_copy, outreach_status, attack_angle, radiography_technical')
    .in('outreach_status', ['SKIPPED_NO_EMAIL', 'DRAFT', null])
    .order('created_at', { ascending: false })
    .limit(200);

  if (cErr) { console.error('Supabase error:', cErr); process.exit(1); }

  // Filter to those that need a real English draft
  const needsDraft = campaigns.filter(c => isDraftInvalid(c.outreach_copy));
  console.log(`📋 Found ${campaigns.length} eligible records`);
  console.log(`✍️  ${needsDraft.length} need a real English draft\n`);

  if (needsDraft.length === 0) {
    console.log('✅ All drafts are already in English. Nothing to do.');
    return;
  }

  // 2. Fetch all prospects in one go
  const prospectIds = [...new Set(needsDraft.map(c => c.prospect_id))];
  const { data: prospects, error: pErr } = await supabase
    .from('prospects')
    .select('id, business_name, city, website, rating, reviews_count, niche_id, raw_data')
    .in('id', prospectIds);

  if (pErr) { console.error('Supabase prospects error:', pErr); process.exit(1); }
  const prospectMap = Object.fromEntries(prospects.map(p => [p.id, p]));

  // 3. Generate drafts one by one (rate-limited)
  let success = 0, failed = 0;

  for (const campaign of needsDraft) {
    const lead = prospectMap[campaign.prospect_id];
    if (!lead) { console.log(`  ⚠️  No lead found for campaign ${campaign.id}`); failed++; continue; }

    const businessName = lead.business_name || 'Unknown';
    process.stdout.write(`  ✍️  Generating draft for "${businessName}"... `);

    const draft = await generateDraft(lead, campaign);

    if (!draft) { failed++; continue; }

    // Combine into outreach_copy format the modal can parse
    const outreach_copy = `Subject: ${draft.subject}\n\n${draft.body}`;

    const { error: uErr } = await supabase
      .from('campaign_enriched_data')
      .update({
        outreach_copy,
        email_draft_subject: draft.subject,
        email_draft_html: draft.body,
        outreach_status: 'DRAFT',
      })
      .eq('id', campaign.id);

    if (uErr) {
      // email_draft_subject/html columns may not exist — try without them
      const { error: uErr2 } = await supabase
        .from('campaign_enriched_data')
        .update({ outreach_copy, outreach_status: 'DRAFT' })
        .eq('id', campaign.id);

      if (uErr2) {
        console.log(`FAILED (${uErr2.message})`);
        failed++;
        continue;
      }
    }

    console.log(`✅`);
    success++;

    // Rate-limit: 1 request per 1.5 seconds to avoid Gemini quota
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n✅ Done! ${success} drafts generated, ${failed} failed.`);
  console.log('🌐 Refresh the dashboard to see the updated drafts in English.');
}

main().catch(console.error);
