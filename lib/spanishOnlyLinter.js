// ============================================================
// lib/spanishOnlyLinter.js — IRON RULE backstop for Empírika
//
// Enforces Spanish-only outreach. Used by:
//   - workers/nightly_auditor.js  (Metric 12 backstop)
//   - self-improve tournament gate (hard-fail DQ)
//   - morning briefing pre-merge gate (see .omc/plans/autonomy-3layer-v2.md B.0)
//
// Contract:
//   lintSpanishOnly(text) -> { ok: boolean, violations: string[] }
//
// Rules (all must pass):
//   R1. No forbidden English phrases (case-insensitive, word-boundary).
//   R2. Either ≥30% of letters are non-ASCII Spanish chars (á, é, í, ó, ú, ñ, ü,
//       ¿, ¡) OR the text contains ≥3 Spanish stop-words from the frozen list.
//   R3. URL-only / very-short sentinels (≤6 words, ≥1 URL) are exempt from R2.
//
// Sealed: this file is on the self-improve sealed_files list. Do not let the
// tournament loop modify it.
// ============================================================

const FORBIDDEN_ENGLISH = [
  'hi there',
  'hey there',
  'hey,',
  'hello,',
  'hello there',
  'good morning,',
  'good afternoon,',
  'good evening,',
  'best regards',
  'kind regards',
  'warm regards',
  'sincerely,',
  'thanks,',
  'thank you,',
  'cheers,',
  'looking forward',
  'as mentioned',
  'please find',
  'please let me know',
  'feel free to',
  'i hope this',
  "i wanted to reach out",
  'just wanted to',
  'quick question',
  'follow up',
  "let's chat",
  "let's connect",
  'schedule a call',
  'book a time',
  'p.s.',
  'sent from my iphone',
];

const SPANISH_STOPWORDS = new Set([
  'el','la','los','las','un','una','unos','unas',
  'de','del','al','a','en','con','por','para','sin','sobre','entre','hasta','desde','hacia',
  'que','qué','como','cómo','cuando','cuándo','donde','dónde','porque','pero','aunque','mientras',
  'y','o','u','ni','ya','también','tampoco',
  'es','son','fue','fueron','ser','estar','está','están','soy','eres','somos',
  'su','sus','mi','mis','tu','tus','nuestro','nuestra',
  'este','esta','estos','estas','ese','esa','esos','esas','aquel','aquella',
  'hola','buenos','buenas','gracias','saludos','atentamente','cordialmente','cordiales',
  'usted','ustedes','nosotros','ellos','ellas',
  'más','menos','muy','muchos','muchas','poco','poca',
  'esperamos','espero','pronto','semana','día','días','próximo','próxima',
  'tener','tiene','tienen','tienes','tengo',
  'poder','podría','podrías','podemos','pueden',
]);

const SPANISH_CHARS_RE = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/g;
const LETTER_RE = /\p{L}/gu;
const URL_RE = /\bhttps?:\/\/\S+/i;
const WORD_RE = /[\p{L}\p{M}'-]+/gu;

function stripHtml(input) {
  if (!input) return '';
  return String(input)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

export function lintSpanishOnly(input) {
  const violations = [];
  const text = stripHtml(input);

  if (!text || text.length < 3) {
    return { ok: false, violations: ['empty_or_trivial_text'] };
  }

  const lower = text.toLowerCase();

  // R1 — forbidden English phrases
  for (const phrase of FORBIDDEN_ENGLISH) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) violations.push(`forbidden_english_phrase:${phrase}`);
  }

  // R3 exemption: very short or URL-only sentinels
  const wc = wordCount(text);
  const hasUrl = URL_RE.test(text);
  const exemptFromR2 = wc <= 6 && hasUrl;

  if (!exemptFromR2) {
    // R2 — Spanish signal: char-ratio OR stopword count
    const letters = text.match(LETTER_RE) || [];
    const spanishChars = text.match(SPANISH_CHARS_RE) || [];
    const charRatio = letters.length ? spanishChars.length / letters.length : 0;

    const tokens = lower.match(WORD_RE) || [];
    let stopHits = 0;
    for (const tok of tokens) if (SPANISH_STOPWORDS.has(tok)) stopHits++;

    const charRuleOk = charRatio >= 0.03; // non-ASCII Spanish chars present
    const stopRuleOk = stopHits >= 3;

    if (!charRuleOk && !stopRuleOk) {
      violations.push(`insufficient_spanish_signal:chars=${spanishChars.length}/${letters.length},stopwords=${stopHits}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

export const _internals = { FORBIDDEN_ENGLISH, SPANISH_STOPWORDS, stripHtml };
