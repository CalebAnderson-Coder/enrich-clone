// ============================================================
// tests/instagram_parser.spec.js
// Covers extractProfileFromHTML against real Bright-Data HTML samples.
// Native test style (see tests/autonomy.spec.js): test(name, fn) + exit !=0 on fail.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProfileFromHTML } from '../tools/brightDataInstagram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, 'fixtures', 'instagram');

const zuckHtml     = fs.readFileSync(path.join(FIX, 'zuck.html'),     'utf8');
const nasaHtml     = fs.readFileSync(path.join(FIX, 'nasa.html'),     'utf8');
const notFoundHtml = fs.readFileSync(path.join(FIX, 'notfound.html'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\n══════════════════════════════════════════════');
console.log('  INSTAGRAM PARSER SPEC');
console.log('══════════════════════════════════════════════\n');

test('extrae followers >= 1_000_000 para @zuck', () => {
  const p = extractProfileFromHTML(zuckHtml, 'zuck');
  assert(p, 'profile should not be null');
  assert(typeof p.followers === 'number', 'followers must be number');
  assert(p.followers >= 1_000_000, `expected followers >= 1M, got ${p.followers}`);
});

test('extrae fullName no vacío para @zuck', () => {
  const p = extractProfileFromHTML(zuckHtml, 'zuck');
  assert(p, 'profile should not be null');
  assert(typeof p.fullName === 'string' && p.fullName.trim().length > 0,
    `expected non-empty fullName, got "${p.fullName}"`);
});

test('extrae followers >= 10_000_000 para @nasa', () => {
  const p = extractProfileFromHTML(nasaHtml, 'nasa');
  assert(p, 'profile should not be null');
  assert(typeof p.followers === 'number', 'followers must be number');
  assert(p.followers >= 10_000_000, `expected followers >= 10M, got ${p.followers}`);
});

test('devuelve null para HTML de perfil no existente', () => {
  const p = extractProfileFromHTML(notFoundHtml, 'instagram_business_userthatdoesnotexist_12345xyz');
  assert(p === null, `expected null, got ${JSON.stringify(p)}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
