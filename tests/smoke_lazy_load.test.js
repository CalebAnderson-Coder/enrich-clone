import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

test('US-007: Bundle should have lazy-loaded chunks', async () => {
  const distPath = path.join(process.cwd(), 'dashboard', 'dist', 'assets');
  
  if (!fs.existsSync(distPath)) {
    throw new Error(`Build output not found at ${distPath}. Run: npm run build`);
  }
  
  const files = fs.readdirSync(distPath);
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const mainChunk = jsFiles.find(f => f.startsWith('index-'));
  
  assert(mainChunk, 'Main chunk (index-*.js) not found in dist/assets');
  
  const mainChunkPath = path.join(distPath, mainChunk);
  const mainStats = fs.statSync(mainChunkPath);
  const mainSizeKb = mainStats.size / 1024;
  
  console.log(`✓ Main bundle: ${mainChunk}`);
  console.log(`  Size: ${mainSizeKb.toFixed(2)} kB (${(mainStats.size / 1024 / 1024).toFixed(2)} MB)`);
  
  assert(mainSizeKb < 400, `Main chunk should be <400kB (is ${mainSizeKb.toFixed(2)}kB)`);
  
  const hasLazyChunks = jsFiles.filter(f => 
    f.includes('View') && !f.startsWith('index-')
  ).length > 0;
  
  assert(hasLazyChunks, 'Should have lazy-loaded view chunks');
  
  const lazyViewChunks = jsFiles.filter(f => 
    f.includes('View') && !f.startsWith('index-')
  );
  
  console.log(`✓ Found ${lazyViewChunks.length} lazy-loaded view chunks:`);
  lazyViewChunks.forEach(chunk => {
    const chunkPath = path.join(distPath, chunk);
    const stats = fs.statSync(chunkPath);
    const sizeKb = stats.size / 1024;
    console.log(`  - ${chunk} (${sizeKb.toFixed(2)} kB)`);
  });
  
  assert(lazyViewChunks.length >= 5, 'Should have at least 5 lazy-loaded view chunks');
});
