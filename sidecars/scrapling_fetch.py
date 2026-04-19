#!/usr/bin/env python
"""
Scrapling single-shot fetcher. Reads JSON from stdin, writes JSON to stdout.

Input:  {"url": "...", "stealthy": false, "timeout_ms": 30000}
Output: {"success": true, "status": 200, "html": "...", "text": "...", "markdown": "..."}
        or {"success": false, "error": "..."}

Called by Node via child_process.spawn('python', ['-u', 'sidecars/scrapling_fetch.py']).
Keeps cost low (no persistent sidecar) with ~500ms Python startup overhead per call.
"""
import json
import sys
import re

# Force UTF-8 stdout on Windows (cp1252 breaks Unicode)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')


def html_to_text(html: str) -> str:
    """Cheap HTML → text. Strip scripts/styles, then tags, normalize whitespace."""
    s = re.sub(r'<script[\s\S]*?</script>', ' ', html, flags=re.I)
    s = re.sub(r'<style[\s\S]*?</style>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'&nbsp;', ' ', s)
    s = re.sub(r'&amp;', '&', s)
    s = re.sub(r'&lt;', '<', s)
    s = re.sub(r'&gt;', '>', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def main():
    try:
        payload = json.loads(sys.stdin.read() or '{}')
    except Exception as e:
        print(json.dumps({"success": False, "error": f"bad_input: {e}"}))
        return 1

    url = payload.get('url', '').strip()
    stealthy = bool(payload.get('stealthy', False))
    timeout_ms = int(payload.get('timeout_ms', 30000))

    if not url:
        print(json.dumps({"success": False, "error": "url_required"}))
        return 1

    try:
        if stealthy:
            from scrapling.fetchers import StealthyFetcher
            fetcher = StealthyFetcher(auto_match=False)
            page = fetcher.fetch(url, headless=True, network_idle=True,
                                 timeout=timeout_ms / 1000)
        else:
            from scrapling.fetchers import Fetcher
            page = Fetcher.get(url, timeout=timeout_ms / 1000, stealthy_headers=True)

        html = page.html_content if hasattr(page, 'html_content') else str(page)
        status = getattr(page, 'status', 200)
        text = html_to_text(html)

        out = {
            "success": True,
            "status": status,
            "url": url,
            "html_bytes": len(html),
            "text_bytes": len(text),
            # Keep payload small — Node side decides what to keep
            "html": html[:500_000],
            "text": text[:50_000],
        }
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"success": False, "error": f"{type(e).__name__}: {e}", "url": url}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
