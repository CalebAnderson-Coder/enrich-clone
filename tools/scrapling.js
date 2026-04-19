// ============================================================
// tools/scrapling.js — Node bridge to local Scrapling (Python).
// Replaces Firecrawl for cost-free, stealth-capable page fetching.
// ============================================================
// Uses child_process.spawn per call (no persistent sidecar). Python
// startup is ~400ms, negligible vs the 5–15s typical scrape latency.
// Requires: Python 3.11+ with scrapling installed (pip install scrapling).
// ============================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '..', 'sidecars', 'scrapling_fetch.py');
const PY = process.env.PYTHON_BIN || 'python';
const DEFAULT_TIMEOUT_MS = 35000;

/**
 * Fetch a URL via Scrapling. Returns { success, status, html, text, url, error? }.
 * When stealthy=true, uses StealthyFetcher (Playwright + stealth patches) — slower
 * but passes Cloudflare/WAF in most cases. Default false is 10x faster HTTP fetch.
 */
export async function scraplingFetch(url, { stealthy = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ url, stealthy, timeout_ms: timeoutMs });

    const proc = spawn(PY, ['-u', SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const killer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs + 5000);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    proc.on('error', (err) => {
      clearTimeout(killer);
      resolve({ success: false, url, error: `spawn_failed: ${err.message}` });
    });

    proc.on('close', () => {
      clearTimeout(killer);
      if (killed) return resolve({ success: false, url, error: 'timeout' });
      const trimmed = stdout.trim();
      if (!trimmed) {
        return resolve({ success: false, url, error: `no_stdout. stderr=${stderr.slice(0, 300)}` });
      }
      // stdout may contain multiple JSON lines — take the last parseable one
      const lines = trimmed.split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try { return resolve(JSON.parse(line)); } catch {}
      }
      resolve({ success: false, url, error: `parse_failed: ${trimmed.slice(0, 300)}` });
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/**
 * Scrape → markdown-lite. Backwards compat with Firecrawl-style consumers.
 * Returns a string (markdown) on success, or error message string on failure.
 */
export async function scraplingMarkdown(url, opts = {}) {
  const result = await scraplingFetch(url, opts);
  if (!result.success) return `[scrapling error] ${result.error || 'unknown'} for ${url}`;
  // Scrapling already strips boilerplate reasonably; the .text is what agents want.
  // Cap at 8000 chars to match Firecrawl's slice behavior.
  return (result.text || '').slice(0, 8000);
}
