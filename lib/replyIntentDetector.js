// ============================================================
// lib/replyIntentDetector.js — Detecta si la respuesta de un lead
//   pide que le mandemos el mini-reporte.
//
// Estrategia híbrida:
//   1. Reglas rápidas (regex) — captan los casos obvios sin LLM.
//   2. Si reglas son ambiguas → LLM clasifica como
//      "send_report" | "schedule_call" | "not_interested" | "other".
//
// El detector NUNCA debe enviar el reporte por sí solo. Devuelve
// el verdict + razón. El worker upstream decide la acción.
// ============================================================

const POSITIVE_TOKENS = [
  // Spanish positive
  /\bs[ií]\b/i,
  /\bclaro\b/i,
  /\bdale\b/i,
  /\bmandam[ae]l[oa]\b/i,
  /\benv[íi]al?o\b/i,
  /\benv[íi]amel?o\b/i,
  /\bme interes[ao]\b/i,
  /\bme gustar[íi]a verl[oa]\b/i,
  /\bquiero verl[oa]\b/i,
  /\bp[áa]samel[oa]\b/i,
  /\baceptar?\b/i,
  /\bvamos\b/i,
  /\bok(ay)?\b/i,
  // English
  /\byes\b/i,
  /\bsend it\b/i,
  /\bplease send\b/i,
  /\bshare it\b/i,
  /\bsounds (good|interesting)\b/i,
  /\bi'?d like\b/i,
  /\bgo ahead\b/i,
];

const NEGATIVE_TOKENS = [
  /\bno gracias\b/i,
  /\bno me interesa\b/i,
  /\bno (estoy )?interesad[oa]\b/i,
  /\bdesinscrib(ir|eme)\b/i,
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bstop emailing\b/i,
  /\bno thanks?\b/i,
  /\bnot interested\b/i,
];

const CALL_TOKENS = [
  /\breuni[óo]n\b/i,
  /\bcall\b/i,
  /\bllamada\b/i,
  /\bagendar?\b/i,
  /\bschedul(e|ing)\b/i,
  /\bbook (a )?(call|meeting)\b/i,
  /\bcuando podemos\b/i,
  /\b15 ?min\b/i,
];

function stripQuotes(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  return lines
    .filter((l) => !l.trim().startsWith('>'))
    .filter((l) => !/^On .* wrote:$/i.test(l.trim()))
    .filter((l) => !/^El .* escribió:$/i.test(l.trim()))
    .join('\n')
    .trim();
}

/**
 * Cheap, no-LLM intent classifier. Returns the verdict directly when
 * confidence is high. Returns 'ambiguous' if the rules don't decide.
 *
 * @param {string} body — raw reply body (will be quote-stripped).
 * @returns {{ intent: 'send_report'|'schedule_call'|'not_interested'|'other'|'ambiguous',
 *            confidence: number, signals: string[], cleaned: string }}
 */
export function classifyReplyByRules(body) {
  const cleaned = stripQuotes(body || '').slice(0, 2000);
  if (!cleaned || cleaned.length < 2) {
    return { intent: 'other', confidence: 0.3, signals: [], cleaned };
  }

  const signals = [];
  let positive = 0, negative = 0, callIntent = 0;

  for (const rx of POSITIVE_TOKENS) if (rx.test(cleaned)) { positive++; signals.push(`+${rx.source}`); }
  for (const rx of NEGATIVE_TOKENS) if (rx.test(cleaned)) { negative++; signals.push(`-${rx.source}`); }
  for (const rx of CALL_TOKENS)     if (rx.test(cleaned)) { callIntent++; signals.push(`call:${rx.source}`); }

  // Negatives override
  if (negative >= 1) return { intent: 'not_interested', confidence: 0.95, signals, cleaned };

  // Strong call intent (asks for meeting before report)
  if (callIntent >= 2 || (callIntent >= 1 && positive >= 1)) {
    return { intent: 'schedule_call', confidence: 0.85, signals, cleaned };
  }

  // Strong send-report (positive without call mention)
  if (positive >= 1 && callIntent === 0) {
    return { intent: 'send_report', confidence: 0.85, signals, cleaned };
  }

  // Weak signals — let the LLM decide
  return { intent: 'ambiguous', confidence: 0.4, signals, cleaned };
}

/**
 * Falls back to LLM when rules are ambiguous. Caller must pass an
 * AgentRuntime (NVIDIA primary, Gemini fallback already configured).
 */
export async function classifyReplyByLLM(body, runtime) {
  if (!runtime?.run) return { intent: 'other', confidence: 0.3 };
  const cleaned = stripQuotes(body || '').slice(0, 1500);
  const prompt = `Clasificá esta respuesta a un email de outreach frío de Empírika. La respuesta es del prospecto. Le ofrecimos enviarle un "mini-reporte SEO en PDF, 1 página, gratis".

Respuesta del prospecto:
"""
${cleaned}
"""

Devolvé SOLO un JSON con esta forma exacta:
{ "intent": "send_report" | "schedule_call" | "not_interested" | "other", "confidence": 0.0-1.0, "reason_es": "string corto" }

Reglas:
- "send_report" = pide que le mandemos el reporte / dice sí / muestra interés sin pedir reunión.
- "schedule_call" = pide reunión, llamada, "cuándo podemos hablar", agendar.
- "not_interested" = rechazo claro, "no gracias", "no me interesa", "unsubscribe", desviación al spam.
- "other" = pregunta sobre el negocio, pide info adicional, OOO, autoresponder, todo lo demás.`;

  try {
    const result = await runtime.run('Atlas', prompt, { maxIterations: 1 });
    const txt = result?.response || '';
    const match = txt.match(/\{[\s\S]*\}/);
    if (!match) return { intent: 'other', confidence: 0.4 };
    const parsed = JSON.parse(match[0]);
    if (!['send_report','schedule_call','not_interested','other'].includes(parsed.intent)) {
      return { intent: 'other', confidence: 0.4 };
    }
    return { intent: parsed.intent, confidence: Number(parsed.confidence) || 0.7, reason: parsed.reason_es };
  } catch (err) {
    return { intent: 'other', confidence: 0.3, reason: `llm_error: ${err.message}` };
  }
}

/**
 * Combined hybrid classifier — rules first, LLM fallback on ambiguous.
 */
export async function detectReplyIntent(body, runtime = null) {
  const ruleResult = classifyReplyByRules(body);
  if (ruleResult.intent !== 'ambiguous') {
    return { ...ruleResult, source: 'rules' };
  }
  if (!runtime) return { ...ruleResult, intent: 'other', source: 'rules_only' };
  const llmResult = await classifyReplyByLLM(body, runtime);
  return { ...llmResult, signals: ruleResult.signals, cleaned: ruleResult.cleaned, source: 'llm' };
}
