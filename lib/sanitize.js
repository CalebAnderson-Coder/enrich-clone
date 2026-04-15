// ============================================================
// lib/sanitize.js — Input Sanitization for Prompt Injection Defense
// Strips dangerous patterns from scraped data before LLM prompts
// ============================================================

/**
 * Strip prompt injection patterns from a single string.
 * Removes:
 *  - Known injection prefixes ("Ignore previous instructions", "SYSTEM:", etc.)
 *  - Markdown/HTML that could manipulate prompt structure
 *  - Unicode control characters and zero-width chars
 *  - Excessive length (truncate to maxLen)
 *
 * @param {string} input - Raw string from scraped data or user input
 * @param {number} [maxLen=2000] - Maximum allowed length
 * @returns {string} - Sanitized string
 */
export function sanitizeForPrompt(input, maxLen = 2000) {
  if (typeof input !== 'string') return '';

  let s = input;

  // 1. Remove Unicode control characters and zero-width chars
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '');

  // 2. Neutralize common prompt injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|context)/gi,
    /you\s+are\s+now\s+(a|an)\s+/gi,
    /\bSYSTEM\s*:/gi,
    /\bASSISTANT\s*:/gi,
    /\bUSER\s*:/gi,
    /\bHUMAN\s*:/gi,
    /```(system|assistant|user|human)/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /<<SYS>>/gi,
    /<<\/SYS>>/gi,
    /\bdo\s+not\s+follow\b/gi,
    /\bdisregard\s+(all\s+)?prior\b/gi,
    /\boverride\s+(your\s+)?(system|instructions?|rules?)\b/gi,
    /\bact\s+as\s+(if\s+you\s+are|a)\b/gi,
  ];

  for (const pattern of injectionPatterns) {
    s = s.replace(pattern, '[FILTERED]');
  }

  // 3. Strip HTML tags (prevent HTML injection into prompts)
  s = s.replace(/<[^>]{0,500}>/g, '');

  // 4. Collapse excessive whitespace
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/ {3,}/g, '  ');

  // 5. Truncate to max length
  if (s.length > maxLen) {
    s = s.slice(0, maxLen) + '… [truncated]';
  }

  return s.trim();
}

/**
 * Deep-sanitize all string fields on a lead data object.
 * Call this BEFORE injecting lead data into any LLM prompt.
 *
 * @param {Object} lead - Raw lead object from scraping or database
 * @param {Object} [opts]
 * @param {number} [opts.maxFieldLen=1000] - Max length per field
 * @param {string[]} [opts.skipFields=[]] - Fields to skip (e.g., 'id', 'created_at')
 * @returns {Object} - New sanitized lead object (original is NOT mutated)
 */
export function sanitizeLeadData(lead, opts = {}) {
  if (!lead || typeof lead !== 'object') return {};

  const { maxFieldLen = 1000, skipFields = ['id', 'created_at', 'updated_at'] } = opts;
  const sanitized = {};

  for (const [key, value] of Object.entries(lead)) {
    if (skipFields.includes(key)) {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] = sanitizeForPrompt(value, maxFieldLen);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively sanitize nested objects (e.g., mega_profile)
      sanitized[key] = sanitizeLeadData(value, opts);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
