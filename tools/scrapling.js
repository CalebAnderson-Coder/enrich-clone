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
// ── Node-only fallback for environments without Python/scrapling ──
// Uses native fetch with a desktop UA; no JS rendering. Good enough for
// ~80% of small-business sites whose homepage + /contact are static HTML.
async function nodeFetchFallback(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!resp.ok && !(resp.status >= 300 && resp.status < 400)) {
      return { success: false, url, status: resp.status, error: `http_${resp.status}` };
    }
    const html = await resp.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                     .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
    return { success: true, url, status: resp.status, html, text };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, url, error: `node_fetch_failed: ${err.message}` };
  }
}

// Cache the result of the Python probe: undefined=unknown, true=ok, false=missing.
let PY_AVAILABLE;

export async function scraplingFetch(url, { stealthy = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // Skip Python path entirely if we've already proven it's unavailable.
  if (PY_AVAILABLE === false) return nodeFetchFallback(url, timeoutMs);

  return new Promise((resolve) => {
    const payload = JSON.stringify({ url, stealthy, timeout_ms: timeoutMs });

    let proc;
    try {
      proc = spawn(PY, ['-u', SCRIPT_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      PY_AVAILABLE = false;
      return resolve(nodeFetchFallback(url, timeoutMs));
    }

    let stdout = '';
    let stderr = '';
    let killed = false;

    const killer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs + 5000);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    proc.on('error', async (err) => {
      clearTimeout(killer);
      // ENOENT / EACCES → Python not on PATH. Mark unavailable so we skip future spawns.
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        PY_AVAILABLE = false;
        return resolve(await nodeFetchFallback(url, timeoutMs));
      }
      resolve({ success: false, url, error: `spawn_failed: ${err.message}` });
    });

    proc.on('close', async (code) => {
      clearTimeout(killer);
      if (killed) return resolve({ success: false, url, error: 'timeout' });
      const trimmed = stdout.trim();
      if (!trimmed) {
        // Empty stdout → Python wasn't found, or scrapling module isn't installed,
        // or Python exited before reading stdin. Any of these means we can't use
        // the Python path on this host — flip the probe and fall back permanently.
        const pyMissing = code !== 0 || /ModuleNotFoundError|No module named|not recognized|command not found/i.test(stderr);
        if (pyMissing) {
          PY_AVAILABLE = false;
          return resolve(await nodeFetchFallback(url, timeoutMs));
        }
        return resolve({ success: false, url, error: `no_stdout. stderr=${stderr.slice(0, 300)}` });
      }
      // stdout may contain multiple JSON lines — take the last parseable one
      const lines = trimmed.split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          // Sidecar caught ImportError and emitted valid JSON; treat as Python-unusable
          // and fall back to Node fetch permanently.
          if (parsed && parsed.success === false && typeof parsed.error === 'string' &&
              /ModuleNotFoundError|No module named|ImportError/i.test(parsed.error)) {
            PY_AVAILABLE = false;
            return resolve(await nodeFetchFallback(url, timeoutMs));
          }
          if (PY_AVAILABLE === undefined) PY_AVAILABLE = true;
          return resolve(parsed);
        } catch {}
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
