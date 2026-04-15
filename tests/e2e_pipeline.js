// ============================================================
// tests/e2e_pipeline.js — End-to-End Pipeline Test
// Validates the FULL chain: Lead → Angela → Draft → Supabase
//
// What it tests:
//   1. Supabase connectivity
//   2. SMTP transport readiness
//   3. Test lead + campaign record creation
//   4. Angela AI copy generation (Gemini 2.0 Flash)
//   5. Zod schema validation of Angela's output
//   6. Email HTML rendering via emailRenderer
//   7. Draft persistence in Supabase
//   8. Cleanup of test data
//
// Usage: node tests/e2e_pipeline.js
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { angela } from '../agents/angela.js';
import { outreachDraftSchema } from '../lib/schemas.js';
import { sanitizeLeadData } from '../lib/sanitize.js';
import { renderMagnetEmail } from '../lib/emailRenderer.js';
import { verifySmtpConnection } from '../outreach_dispatcher.js';
import { logger } from '../lib/logger.js';

dotenv.config();

// ── Test Configuration ────────────────────────────────────────
const TEST_LEAD = {
  business_name: 'E2E Test Landscaping Co.',
  industry: 'Landscaping',
  email_address: 'e2e-test@example.com',
  owner_name: 'Test Owner',
  phone: '+1-555-0199',
  website: null,
  has_website: false,
  metro_area: 'Austin, TX',
  review_count: 12,
  rating: 4.3,
  qualification_score: 78,
  lead_tier: 'WARM',
  outreach_status: null,
};

const TEST_MAGNET_DATA = {
  magnet_type: 'website_screenshot',
  niche_folder: '7. Paisajismo (landscaping)',
  image_path: null, // No actual image needed for E2E test
  status: 'COMPLETED',
};

// ── Supabase Client ──────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Test Utilities ───────────────────────────────────────────
let testLeadId = null;
let testCampaignId = null;
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function skip(message) {
  console.log(`  ⏭️  SKIP: ${message}`);
  skipped++;
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ── Phase 1: Infrastructure Checks ──────────────────────────
async function phase1_infrastructure() {
  section('PHASE 1: Infrastructure Checks');

  // 1a. Supabase connection
  const { data, error } = await supabase.from('leads').select('id').limit(1);
  assert(!error, `Supabase connectivity (${error ? error.message : 'OK'})`);

  // 1b. SMTP transport
  const smtp = await verifySmtpConnection();
  assert(smtp.ok, `SMTP transport ready (${smtp.ok ? 'connected' : smtp.reason})`);

  // 1c. Gemini API key
  assert(!!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY is set');

  // 1d. Required env vars
  assert(!!process.env.SUPABASE_URL, 'SUPABASE_URL is set');
  assert(!!process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is set');
}

// ── Phase 2: Create Test Lead ───────────────────────────────
async function phase2_insertTestLead() {
  section('PHASE 2: Insert Test Lead into Supabase');

  // 2a. Insert into leads table
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert(TEST_LEAD)
    .select()
    .single();

  assert(!leadError, `Lead insert (${leadError ? leadError.message : 'OK'})`);

  if (leadError) {
    console.error('  🛑 Cannot continue without test lead. Aborting.');
    return false;
  }

  testLeadId = lead.id;
  console.log(`  📍 Test lead ID: ${testLeadId}`);
  assert(lead.business_name === TEST_LEAD.business_name, `Lead name matches: "${lead.business_name}"`);

  // 2b. Insert into campaign_enriched_data
  const { data: campaign, error: campaignError } = await supabase
    .from('campaign_enriched_data')
    .insert({
      prospect_id: testLeadId,
      lead_magnets_data: TEST_MAGNET_DATA,
      lead_magnet_status: 'COMPLETED',
      outreach_status: null,
    })
    .select()
    .single();

  assert(!campaignError, `Campaign record insert (${campaignError ? campaignError.message : 'OK'})`);

  if (campaignError) {
    console.error('  🛑 Cannot continue without campaign record. Aborting.');
    return false;
  }

  testCampaignId = campaign.id;
  console.log(`  📍 Test campaign ID: ${testCampaignId}`);
  return true;
}

// ── Phase 3: Angela AI Copy Generation ──────────────────────
async function phase3_angelaCopyGeneration() {
  section('PHASE 3: Angela AI Copy Generation (Gemini 2.0 Flash)');

  const runtime = new AgentRuntime({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  runtime.registerAgent(angela);

  // 3a. Sanitize lead data
  const safeLead = sanitizeLeadData(TEST_LEAD);
  assert(safeLead.business_name === TEST_LEAD.business_name, 'Lead data sanitization works');

  // 3b. Build the prompt (same as outreach_dispatcher.js)
  const prompt = `Write a cold outreach message for a ${safeLead.industry || 'service'} business called "${safeLead.business_name || 'their business'}".
Context: Our agency (Empírika) designed a free, professional website concept for them (magnet: website_screenshot).
Mention that you found their business, thought it was great, but noticed they're missing an online presence — and tell them to check the attached website concept.
Offer to deliver the finished version 100% free.
Be assertive, professional, but very human.

Write TWO versions:
1. A cold Email (Subject line + body, 2-3 paragraphs).
2. A WhatsApp message (Short, direct, conversational, impactful).

IMPORTANT: Write EVERYTHING in ENGLISH. Return ONLY a JSON object:
{
  "email_subject": "[Subject line]",
  "email_body": "[Email body with 2-3 paragraphs]",
  "whatsapp": "[Short WhatsApp message]"
}`;

  console.log('  🤖 Calling Angela via Gemini 2.0 Flash...');
  const startTime = Date.now();

  let aiResult;
  try {
    aiResult = await runtime.run('Angela', prompt, { maxIterations: 3 });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ⏱️  Angela responded in ${elapsed}s (${aiResult.iterations} iterations, provider: ${aiResult.provider})`);
    assert(!!aiResult.response, 'Angela produced a response');
    assert(aiResult.response.length > 20, `Response length: ${aiResult.response.length} chars`);
  } catch (err) {
    console.error(`  🛑 Angela call failed: ${err.message}`);
    assert(false, `Angela execution: ${err.message}`);
    return null;
  }

  // 3c. Parse and validate with Zod
  console.log('  🔍 Validating Angela output with Zod schema...');
  const parseResult = AgentRuntime.safeParseLLMOutput(aiResult.response, outreachDraftSchema);

  assert(parseResult.success, `Zod schema validation (${parseResult.success ? 'VALID' : parseResult.error})`);

  if (!parseResult.success) {
    console.log('  📋 Raw response preview:', aiResult.response.slice(0, 300));
    return null;
  }

  const draft = parseResult.data;

  // 3d. Validate content quality
  assert(draft.email_subject.length >= 5, `Subject line length: ${draft.email_subject.length} chars`);
  assert(draft.email_body.length >= 50, `Email body length: ${draft.email_body.length} chars`);
  assert(draft.whatsapp.length >= 10, `WhatsApp message length: ${draft.whatsapp.length} chars`);

  // 3e. Verify English output (basic check — no Spanish characters in subject)
  const hasSpanish = /[áéíóúñ¿¡]/i.test(draft.email_subject);
  assert(!hasSpanish, `Subject line is in English (no Spanish chars): "${draft.email_subject}"`);

  console.log(`  📧 Subject: "${draft.email_subject}"`);
  console.log(`  📱 WhatsApp: "${draft.whatsapp.slice(0, 80)}..."`);

  return draft;
}

// ── Phase 4: Email Rendering ────────────────────────────────
async function phase4_emailRendering(draft) {
  section('PHASE 4: Email HTML Rendering');

  if (!draft) {
    skip('No draft available — Angela phase failed');
    return null;
  }

  const lead = { ...TEST_LEAD, id: testLeadId };
  const magnetData = { ...TEST_MAGNET_DATA };

  const { subject, html, attachments } = renderMagnetEmail(
    magnetData, lead, { angelaSubject: draft.email_subject, angelaBody: draft.email_body }
  );

  assert(!!subject, `Email subject rendered: "${subject}"`);
  assert(html.length > 500, `HTML email generated: ${html.length} chars`);
  assert(/emp[ií]rika/i.test(html), 'HTML contains brand name "Empírika"');
  assert(html.includes('Montserrat'), 'HTML uses Montserrat font');
  assert(html.includes('#FF7A00'), 'HTML uses brand orange color');

  // Check that Angela's copy is in the rendered HTML (escaped)
  const escapedSubject = draft.email_subject.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  assert(html.includes(escapedSubject) || html.includes(draft.email_subject), 'Angela subject in rendered HTML');

  console.log(`  📎 Attachments: ${attachments.length}`);

  return { subject, html, attachments };
}

// ── Phase 5: Draft Persistence ──────────────────────────────
async function phase5_draftPersistence(draft, renderedEmail) {
  section('PHASE 5: Draft Persistence in Supabase');

  if (!draft || !renderedEmail) {
    skip('No draft/rendered email — earlier phase failed');
    return;
  }

  // 5a. Update campaign_enriched_data with draft
  const magnetDataWithDraft = {
    ...TEST_MAGNET_DATA,
    approval_status: 'DRAFT',
    email_draft_subject: renderedEmail.subject,
    email_draft_html: renderedEmail.html,
    whatsapp_draft: draft.whatsapp,
  };

  const { error: updateError } = await supabase
    .from('campaign_enriched_data')
    .update({
      outreach_status: 'DRAFT',
      lead_magnets_data: magnetDataWithDraft,
    })
    .eq('id', testCampaignId);

  assert(!updateError, `Campaign draft update (${updateError ? updateError.message : 'OK'})`);

  // 5b. Update leads table
  const { error: leadUpdateError } = await supabase
    .from('leads')
    .update({ outreach_status: 'DRAFT' })
    .eq('id', testLeadId);

  assert(!leadUpdateError, `Lead status update (${leadUpdateError ? leadUpdateError.message : 'OK'})`);

  // 5c. Verify the data was persisted
  const { data: verifyData, error: verifyError } = await supabase
    .from('campaign_enriched_data')
    .select('outreach_status, lead_magnets_data')
    .eq('id', testCampaignId)
    .single();

  assert(!verifyError, `Verify read back (${verifyError ? verifyError.message : 'OK'})`);
  assert(verifyData?.outreach_status === 'DRAFT', `Status is DRAFT: "${verifyData?.outreach_status}"`);
  assert(verifyData?.lead_magnets_data?.approval_status === 'DRAFT', 'Approval status is DRAFT');
  assert(!!verifyData?.lead_magnets_data?.email_draft_html, 'HTML draft persisted');
  assert(!!verifyData?.lead_magnets_data?.whatsapp_draft, 'WhatsApp draft persisted');

  // 5d. Verify lead table reflects status
  const { data: leadCheck } = await supabase
    .from('leads')
    .select('outreach_status')
    .eq('id', testLeadId)
    .single();

  assert(leadCheck?.outreach_status === 'DRAFT', `Lead outreach_status is DRAFT: "${leadCheck?.outreach_status}"`);
}

// ── Phase 6: Cleanup ────────────────────────────────────────
async function phase6_cleanup() {
  section('PHASE 6: Cleanup Test Data');

  if (testCampaignId) {
    const { error: campaignDeleteError } = await supabase
      .from('campaign_enriched_data')
      .delete()
      .eq('id', testCampaignId);
    assert(!campaignDeleteError, `Campaign record deleted (${campaignDeleteError ? campaignDeleteError.message : 'OK'})`);
  }

  if (testLeadId) {
    const { error: leadDeleteError } = await supabase
      .from('leads')
      .delete()
      .eq('id', testLeadId);
    assert(!leadDeleteError, `Lead record deleted (${leadDeleteError ? leadDeleteError.message : 'OK'})`);
  }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 E2E PIPELINE TEST — Full Outreach Chain');
  console.log('━'.repeat(60));
  console.log(`  Lead:     ${TEST_LEAD.business_name}`);
  console.log(`  Industry: ${TEST_LEAD.industry}`);
  console.log(`  Niche:    ${TEST_MAGNET_DATA.niche_folder}`);
  console.log(`  LLM:      Gemini 2.0 Flash via Angela`);
  console.log('━'.repeat(60));

  const startTime = Date.now();

  try {
    // Phase 1: Infrastructure
    await phase1_infrastructure();

    // Phase 2: Insert test data
    const leadCreated = await phase2_insertTestLead();
    if (!leadCreated) {
      console.error('\n🛑 HALTED: Test data creation failed.\n');
      process.exit(1);
    }

    // Phase 3: Angela AI generation
    const draft = await phase3_angelaCopyGeneration();

    // Phase 4: Email rendering
    const renderedEmail = await phase4_emailRendering(draft);

    // Phase 5: Draft persistence
    await phase5_draftPersistence(draft, renderedEmail);

  } finally {
    // Phase 6: Always cleanup
    await phase6_cleanup();
  }

  // ── Results Summary ──────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  E2E PIPELINE TEST RESULTS');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ⏱️  Total:   ${elapsed}s`);
  console.log(`  📊 Result:  ${failed === 0 ? '🟢 ALL TESTS PASS' : '🔴 SOME TESTS FAILED'}`);
  console.log('═'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n💥 Fatal E2E error: ${err.message}\n${err.stack}`);
  // Attempt cleanup even on crash
  phase6_cleanup().finally(() => process.exit(1));
});
