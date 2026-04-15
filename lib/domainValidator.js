// ============================================================
// lib/domainValidator.js — Fast domain reachability validator
// Prevents saving leads with fabricated/hallucinated domains
// ============================================================

/**
 * Check if a domain is reachable via a fast HEAD request.
 * Returns { reachable: boolean, statusCode: number|null, error?: string }
 */
export async function isDomainReachable(urlOrDomain, timeoutMs = 5000) {
  if (!urlOrDomain) return { reachable: false, statusCode: null, error: 'No URL provided' };

  let url = urlOrDomain.trim();
  // Normalize to full URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    new URL(url); // Validate URL format
  } catch {
    return { reachable: false, statusCode: null, error: 'Invalid URL format' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    clearTimeout(timer);
    return { reachable: response.ok || response.status < 500, statusCode: response.status };
  } catch (err) {
    // Try GET as fallback (some servers reject HEAD)
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeoutMs);

      const response2 = await fetch(url, {
        method: 'GET',
        signal: controller2.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      clearTimeout(timer2);

      // Only read a tiny bit to confirm it's alive
      if (response2.body) {
        const reader = response2.body.getReader();
        await reader.read(); // Read first chunk
        reader.cancel();
      }

      return { reachable: response2.ok || response2.status < 500, statusCode: response2.status };
    } catch (err2) {
      return { reachable: false, statusCode: null, error: err2.message };
    }
  }
}

/**
 * Extract the domain from a URL string.
 * e.g. "https://www.example.com/about" → "example.com"
 */
export function extractDomain(urlString) {
  if (!urlString) return null;
  try {
    let url = urlString.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Batch validate an array of leads, marking unreachable websites.
 * Returns: { valid: Lead[], invalid: Lead[] }
 */
export async function validateLeadDomains(leads, concurrency = 5) {
  const valid = [];
  const invalid = [];

  // Process in batches of `concurrency`
  for (let i = 0; i < leads.length; i += concurrency) {
    const batch = leads.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        if (!lead.website) {
          // No website is OK — they might have phone/email
          valid.push(lead);
          return;
        }

        const result = await isDomainReachable(lead.website, 5000);
        if (result.reachable) {
          valid.push(lead);
        } else {
          invalid.push({ ...lead, _validation_error: result.error || `HTTP ${result.statusCode}` });
        }
      })
    );
  }

  return { valid, invalid };
}
