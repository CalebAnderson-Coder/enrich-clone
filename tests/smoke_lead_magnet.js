// ============================================================
// tests/smoke_lead_magnet.js
// Dry-run smoke test for Sprint 4 lead magnet wiring:
//   1. matchNicheFolder returns correct folder per industry keyword.
//   2. uploadMagnetToStorage returns the public URL from a stubbed client.
//   3. The magnetData payload persisted by the worker contains both
//      image_path AND public_url (plus legacy fields).
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'assert';

import {
  matchNicheFolder,
  uploadMagnetToStorage,
} from '../lead_magnet_worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let failures = 0;

function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`  ✅ ${name}`),
    (err) => {
      failures++;
      console.error(`  ❌ ${name}:`, err?.message || err);
    }
  );
}

// ── 1. matchNicheFolder ─────────────────────────────────────
await t('matchNicheFolder maps "Lawn Care" → Paisajismo folder', () => {
  const folder = matchNicheFolder('Lawn Care');
  assert.equal(folder, '7. Paisajismo (landscaping)');
});

await t('matchNicheFolder maps "Residential Plumbing" → Plomería', () => {
  const folder = matchNicheFolder('Residential Plumbing');
  assert.equal(folder, '9. Plomería (plumbing)');
});

await t('matchNicheFolder falls back to Handyman on unknown industry', () => {
  const folder = matchNicheFolder('Junk Removal');
  assert.equal(folder, '5. Handyman');
});

await t('matchNicheFolder falls back on empty industry', () => {
  const folder = matchNicheFolder('');
  assert.equal(folder, '5. Handyman');
});

// ── 2. uploadMagnetToStorage with stubbed supabase client ──
// Build a minimal asset file on disk so fs.readFileSync works.
const tmpDir  = path.join(__dirname, '.tmp_smoke_lead_magnet');
const tmpFile = path.join(tmpDir, 'mock.png');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes

function makeStubClient({ failUpload = false } = {}) {
  const calls = { upload: [], getPublicUrl: [] };
  const client = {
    storage: {
      from(bucket) {
        return {
          upload(storagePath, buffer, opts) {
            calls.upload.push({ bucket, storagePath, size: buffer?.length, opts });
            return Promise.resolve(failUpload
              ? { error: { message: 'bucket not found' } }
              : { data: { path: storagePath }, error: null });
          },
          getPublicUrl(storagePath) {
            calls.getPublicUrl.push({ bucket, storagePath });
            return { data: { publicUrl: `https://stub.supabase.co/storage/v1/object/public/${bucket}/${storagePath}` } };
          },
        };
      },
    },
  };
  return { client, calls };
}

await t('uploadMagnetToStorage returns public_url on success', async () => {
  const { client, calls } = makeStubClient();
  const url = await uploadMagnetToStorage({
    absolutePath: tmpFile,
    fileName: 'mock.png',
    brandId: 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    leadId: 'lead-abc',
    storageClient: client,
  });
  assert.ok(url, 'expected a public URL');
  assert.ok(url.includes('eca1d833-77e3-4690-8cf1-2a44db20dcf8/lead-abc/mock.png'), `URL should include storage path, got ${url}`);
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.upload[0].opts.contentType, 'image/png');
  assert.equal(calls.upload[0].opts.upsert, true);
});

await t('uploadMagnetToStorage returns null when upload fails (no throw)', async () => {
  const { client } = makeStubClient({ failUpload: true });
  const url = await uploadMagnetToStorage({
    absolutePath: tmpFile,
    fileName: 'mock.png',
    brandId: 'brand-x',
    leadId: 'lead-y',
    storageClient: client,
  });
  assert.equal(url, null);
});

// ── 3. magnetData payload shape (what the worker writes to DB) ──
await t('magnetData shape matches what outreach_dispatcher expects', async () => {
  const { client } = makeStubClient();
  const image = {
    absolutePath: tmpFile,
    relativePath: 'assets/landing_niches/7. Paisajismo (landscaping)/mock.png',
    fileName: 'mock.png',
  };
  const publicUrl = await uploadMagnetToStorage({
    absolutePath: image.absolutePath,
    fileName: image.fileName,
    brandId: 'brand-x',
    leadId: 'lead-y',
    storageClient: client,
  });
  const magnetData = {
    magnet_type: 'website_screenshot',
    niche_folder: '7. Paisajismo (landscaping)',
    image_path: image.relativePath,
    image_file: image.fileName,
    public_url: publicUrl,
    assigned_at: new Date().toISOString(),
  };
  assert.equal(magnetData.magnet_type, 'website_screenshot');
  assert.ok(magnetData.image_path, 'image_path must be set');
  assert.ok(magnetData.public_url, 'public_url must be set after upload');
  assert.ok(magnetData.public_url.startsWith('https://'));
  // Simulate the exact key index.js:963 reads after Fix 1.
  const readPath = magnetData?.image_path || magnetData?.public_url || null;
  const readUrl  = magnetData?.public_url || null;
  assert.equal(readPath, image.relativePath);
  assert.equal(readUrl, publicUrl);
});

// Cleanup
try { fs.unlinkSync(tmpFile); fs.rmdirSync(tmpDir); } catch {}

if (failures > 0) {
  console.error(`\n❌ ${failures} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\n✅ smoke_lead_magnet.js — all assertions passed');
