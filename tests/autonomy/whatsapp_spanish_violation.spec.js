// ============================================================
// tests/autonomy/whatsapp_spanish_violation.spec.js
//
// Metric 10b (plan §B.2 A5): whatsapp_spanish_violation_count_24h.
// Runs spanishOnlyLinter over lead_magnets_data.wa_last_body for
// WhatsApp sends within the last 24h.
//
// Behaviour (mirrors workers/nightly_auditor.js):
//   - No recent sends                          → green, note=no_wa_sends_in_window
//   - All sends missing wa_last_body stamp     → green, note=awaiting_wa_body_stamp
//   - Any rendered body fails linter           → red, suggested_action=WHATSAPP_SPANISH_VIOLATION
//   - All bodies pass linter                   → green, no suggested_action
//
// Prereq: scripts/send_whatsapp_outreach.js must stamp wa_last_body
// (D1.3). This test asserts the send script contains that stamp.
//
// Run: node tests/autonomy/whatsapp_spanish_violation.spec.js
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lintSpanishOnly } from '../../lib/spanishOnlyLinter.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
}

// Reference implementation mirroring the auditor block.
function classifyBatch(rows) {
  const window24 = Date.now() - 24 * 3600_000;
  const recent = rows.filter(r => {
    const ts = r.lead_magnets_data?.wa_sent_at;
    return ts && new Date(ts).getTime() >= window24;
  });
  if (recent.length === 0) {
    return { severity: 'green', suggested_action: null, scanned: 0, note: 'no_wa_sends_in_window' };
  }
  let scanned = 0, missingBody = 0, violations = 0;
  for (const row of recent) {
    const body = row.lead_magnets_data?.wa_last_body;
    if (!body) { missingBody++; continue; }
    scanned++;
    if (!lintSpanishOnly(body).ok) violations++;
  }
  const severity = violations === 0 ? 'green' : 'red';
  return {
    severity,
    suggested_action: violations > 0 ? 'WHATSAPP_SPANISH_VIOLATION' : null,
    scanned, missingBody, violations,
    note: (scanned === 0 && missingBody > 0) ? 'awaiting_wa_body_stamp' : undefined,
  };
}

const nowISO  = () => new Date().toISOString();
const longAgo = () => new Date(Date.now() - 48 * 3600_000).toISOString();

const ES_BODY = 'Hola María, soy Carlos de Empírika. Queríamos compartir una propuesta para tu restaurante.';
const EN_BODY = 'Hi there! Just wanted to share a quick preview of our proposal. Best regards.';

// ── 1. empty window ───────────────────────────────────────────

test('no rows → green + no_wa_sends_in_window', () => {
  const r = classifyBatch([]);
  assert.equal(r.severity, 'green');
  assert.equal(r.suggested_action, null);
  assert.equal(r.note, 'no_wa_sends_in_window');
});

test('rows all outside 24h window → green + no_wa_sends_in_window', () => {
  const rows = [{ lead_magnets_data: { wa_sent_at: longAgo(), wa_last_body: EN_BODY } }];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'green');
  assert.equal(r.note, 'no_wa_sends_in_window');
});

// ── 2. missing-body fallback (send script hasn't stamped yet) ─

test('all recent rows missing wa_last_body → green + awaiting_wa_body_stamp', () => {
  const rows = [
    { lead_magnets_data: { wa_sent_at: nowISO() } },
    { lead_magnets_data: { wa_sent_at: nowISO() } },
  ];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'green', 'MUST not false-positive red while send script not stamping');
  assert.equal(r.suggested_action, null);
  assert.equal(r.note, 'awaiting_wa_body_stamp');
  assert.equal(r.missingBody, 2);
  assert.equal(r.scanned, 0);
});

// ── 3. happy path: all-Spanish bodies ────────────────────────

test('all Spanish bodies → green, no suggested_action', () => {
  const rows = [
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: ES_BODY } },
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: ES_BODY } },
  ];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'green');
  assert.equal(r.suggested_action, null);
  assert.equal(r.violations, 0);
  assert.equal(r.scanned, 2);
});

// ── 4. violation path ────────────────────────────────────────

test('one English body in batch → red + WHATSAPP_SPANISH_VIOLATION', () => {
  const rows = [
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: ES_BODY } },
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: EN_BODY } },
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: ES_BODY } },
  ];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'red');
  assert.equal(r.suggested_action, 'WHATSAPP_SPANISH_VIOLATION');
  assert.equal(r.violations, 1);
  assert.equal(r.scanned, 3);
});

test('all English bodies → red + WHATSAPP_SPANISH_VIOLATION', () => {
  const rows = [
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: EN_BODY } },
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: EN_BODY } },
  ];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'red');
  assert.equal(r.violations, 2);
});

test('mixed: some stamped (ES) + some missing → green if no violations', () => {
  const rows = [
    { lead_magnets_data: { wa_sent_at: nowISO(), wa_last_body: ES_BODY } },
    { lead_magnets_data: { wa_sent_at: nowISO() } }, // missing body
  ];
  const r = classifyBatch(rows);
  assert.equal(r.severity, 'green');
  assert.equal(r.scanned, 1);
  assert.equal(r.missingBody, 1);
  // Note not awaiting_wa_body_stamp because scanned>0.
  assert.equal(r.note, undefined);
});

// ── 5. Prereq: send script must stamp wa_last_body ───────────

test('scripts/send_whatsapp_outreach.js stamps wa_last_body (D1.3 prereq)', () => {
  const file = path.join(process.cwd(), 'scripts', 'send_whatsapp_outreach.js');
  const src  = fs.readFileSync(file, 'utf8');
  assert.match(src, /md\.wa_last_body\s*=/, 'send script must stamp wa_last_body for metric 10b');
});

// ── 6. Prereq: auditor emits the right action name ───────────

test('auditor source emits WHATSAPP_SPANISH_VIOLATION on red', () => {
  const file = path.join(process.cwd(), 'workers', 'nightly_auditor.js');
  const src  = fs.readFileSync(file, 'utf8');
  const block = src.slice(src.indexOf('whatsapp_spanish_violation_count_24h'));
  assert.match(block, /'WHATSAPP_SPANISH_VIOLATION'/, 'action name missing in auditor');
  assert.match(block, /awaiting_wa_body_stamp/, 'fallback note missing');
});

console.log(`\n[whatsapp_spanish_violation] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
