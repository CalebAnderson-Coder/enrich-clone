// ============================================================
// tests/nightly_auditor_purity.spec.js
//
// Contract test for workers/nightly_auditor.js:
//   - MUST NOT import AgentRuntime, any agents/*, or any LLM client.
//   - Plan: .omc/plans/autonomy-3layer-v2.md §B.3
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'workers', 'nightly_auditor.js');
const src  = fs.readFileSync(FILE, 'utf8');

const forbiddenImports = [
  /from\s+['"]\.\.\/lib\/AgentRuntime\.js['"]/,
  /from\s+['"]\.\.\/agents\//,
  /from\s+['"]openai['"]/,
  /from\s+['"]@google\/generative-ai['"]/,
  /from\s+['"]@google\/genai['"]/,
  /from\s+['"]groq-sdk['"]/,
  /from\s+['"]anthropic['"]/,
];

let failed = 0;
let passed = 0;

for (const re of forbiddenImports) {
  if (re.test(src)) {
    console.error(`  ✗ forbidden import matched ${re}`);
    failed++;
  } else {
    console.log(`  ✓ no match for ${re}`);
    passed++;
  }
}

console.log(`\n[nightly_auditor_purity] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
