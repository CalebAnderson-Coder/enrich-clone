// ============================================================
// lib/openTracker.js — Build tracking URL + inject pixel into
//   HTML emails for open tracking.
// ============================================================

const TRACK_BASE = process.env.TRACK_BASE_URL || 'https://agency-fleet-runtime.onrender.com';

/**
 * Build the tracking URL for a specific lead + message_id.
 * Encodes both into a base64url token so the endpoint can decode
 * both pieces without a DB lookup.
 * @param {string} leadId
 * @param {string} messageId
 * @returns {string}
 */
export function buildTrackingUrl(leadId, messageId) {
  const raw = `${leadId}|${messageId}`;
  const token = Buffer.from(raw).toString('base64url');
  return `${TRACK_BASE}/api/track/open/${token}`;
}

/**
 * Decode a tracking token back into { lead_id, message_id }.
 * Returns null if the token is invalid.
 * @param {string} token
 * @returns {{ lead_id: string, message_id: string } | null}
 */
export function decodeTrackingToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf-8');
    const [lead_id, message_id] = raw.split('|');
    if (!lead_id || !message_id) return null;
    return { lead_id, message_id };
  } catch {
    return null;
  }
}

/**
 * Wrap a plain-text email body into HTML that includes the tracking
 * pixel at the bottom. Preserves line breaks (text → <br>).
 *
 * @param {string} text — plain-text body
 * @param {string} trackingUrl — full URL to the tracking pixel
 * @returns {string} HTML body
 */
export function wrapTextWithPixel(text, trackingUrl) {
  const safe = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">
${safe}
<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none">
</body></html>`;
}
