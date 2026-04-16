// ============================================================
// tests/smoke_verifier.js — Smoke test for Verifier + Gate
//
// Requires NVIDIA_API_KEY (or GEMINI_API_KEY) to run live.
// If neither key is present, exits 0 with a clear skip message.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { AgentRuntime } from '../lib/AgentRuntime.js';
import { verifier } from '../agents/verifier.js';
import { angela } from '../agents/angela.js';
import { verifyAndRewrite } from '../lib/verifierGate.js';

// ── Skip guard ────────────────────────────────────────────────
const hasNvidia = !!process.env.NVIDIA_API_KEY;
const hasGemini = !!process.env.GEMINI_API_KEY;

if (!hasNvidia && !hasGemini) {
  console.log('SKIPPED: NVIDIA_API_KEY missing — test deployment will run this');
  process.exit(0);
}

// ── Runtime setup ─────────────────────────────────────────────
// Prefer NVIDIA; fall back to Gemini if only that key is set
const runtime = hasNvidia
  ? new AgentRuntime({
      apiKey: process.env.NVIDIA_API_KEY,
      model: 'meta/llama-3.1-70b-instruct',
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  : new AgentRuntime({
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-2.0-flash',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });

runtime.registerAgent(verifier);
runtime.registerAgent(angela);

// ── Test fixtures ─────────────────────────────────────────────

// Good draft — should pass
const goodDraft = {
  subject: 'Hola Carlos, vi tu negocio de roofing en Miami',
  body: `Hola Carlos,

Te escribo porque vi tu negocio de techos en Miami y noté que tienes excelentes reseñas en Google (4.8 estrellas). Sin embargo, no encontré una página web que muestre todo lo que ofreces.

En Empírika ayudamos a negocios de roofing como el tuyo a conseguir más clientes con un sistema digital simple. Ya trabajamos con otros contratistas en Florida que duplicaron sus llamadas en 60 días.

¿Tienes 15 minutos el jueves para una llamada rápida? Te muestro exactamente qué haría por tu negocio.

Saludos,
Angela`,
  whatsapp: 'Hola Carlos, vi tu negocio de roofing en Miami. ¿Tienes 15 min el jueves?',
  instagram: '',
};

// Bad draft — generic, no CTA, too short
const badDraft = {
  subject: 'We can help your business grow',
  body: 'Hello, we offer marketing services. Contact us if interested. We have many solutions available for your company.',
  whatsapp: 'Hi',
  instagram: '',
};

const leadContext = {
  businessName: 'Carlos Roofing LLC',
  industry: 'Roofing',
  metro: 'Miami FL',
  tier: 'HOT',
};

// ── Helpers ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    failed++;
  }
}

// ── Tests ──────────────────────────────────────────────────────
console.log('\n[smoke_verifier] Running Verifier + Gate smoke tests...\n');

await testAsync('Good draft passes verification (verdict=pass)', async () => {
  const result = await verifyAndRewrite(goodDraft, leadContext, runtime, { maxRetries: 0 });
  if (result.blocked) throw new Error('Good draft was blocked unexpectedly');
  if (!result.verifier_history || result.verifier_history.length === 0) {
    throw new Error('No verifier history recorded');
  }
  const report = result.verifier_history[0];
  if (report.verdict !== 'pass') {
    throw new Error(`Expected pass, got ${report.verdict}. Overall: ${report.overall}. Issues: ${JSON.stringify(report.issues)}`);
  }
  console.log(`     overall=${report.overall}, verdict=${report.verdict}`);
});

await testAsync('Bad draft triggers issues (verdict=rewrite)', async () => {
  const result = await verifyAndRewrite(badDraft, leadContext, runtime, { maxRetries: 0 });
  if (!result.verifier_history || result.verifier_history.length === 0) {
    throw new Error('No verifier history recorded');
  }
  const report = result.verifier_history[0];
  // With maxRetries=0, a rewrite verdict should set blocked=true
  if (report.verdict !== 'rewrite') {
    throw new Error(`Expected rewrite, got ${report.verdict}. Overall: ${report.overall}`);
  }
  if (!result.blocked) {
    throw new Error('Expected blocked=true after maxRetries=0 on rewrite verdict');
  }
  console.log(`     overall=${report.overall}, issues=${JSON.stringify(report.issues)}`);
});

await testAsync('verifier_history accumulates across retries', async () => {
  // maxRetries=1 — will attempt 1 rewrite with Angela then check again
  // We don't assert final verdict since Angela may or may not fix it,
  // but history length must be >= 1
  const result = await verifyAndRewrite(badDraft, leadContext, runtime, { maxRetries: 1 });
  if (!result.verifier_history || result.verifier_history.length < 1) {
    throw new Error(`Expected at least 1 report, got ${result.verifier_history?.length}`);
  }
  console.log(`     history_length=${result.verifier_history.length}, blocked=${!!result.blocked}`);
});

// ── Summary ────────────────────────────────────────────────────
console.log(`\n[smoke_verifier] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
