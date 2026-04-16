// ============================================================
// lib/verifierGate.js — Verifier Gate Helper
// Runs a draft through the Verifier agent and optionally
// requests Angela to rewrite if it fails the rubric.
// ============================================================

import { z } from 'zod';
import { AgentRuntime } from './AgentRuntime.js';
import { logger } from './logger.js';

// ── Zod schema for Verifier output ───────────────────────────
const verifierReportSchema = z.object({
  scores: z.object({
    tono:           z.number().min(1).max(5),
    cta_claridad:   z.number().min(1).max(5),
    longitud:       z.number().min(1).max(5),
    personalizacion:z.number().min(1).max(5),
    idioma:         z.number().min(1).max(5),
  }),
  overall:      z.number(),
  verdict:      z.enum(['pass', 'rewrite']),
  issues:       z.array(z.string()),
  rewrite_hint: z.string(),
});

/**
 * Run a draft through the Verifier agent, retrying with Angela if needed.
 *
 * @param {object} draft         - { subject, body, whatsapp, instagram }
 * @param {object} leadContext   - { businessName, industry, metro, tier }
 * @param {AgentRuntime} runtime - Registered runtime (must have 'Verifier' + 'Angela')
 * @param {object} [options]
 * @param {number} [options.maxRetries=2]
 * @returns {Promise<{ draft: object, verifier_history: object[], blocked?: boolean }>}
 */
export async function verifyAndRewrite(draft, leadContext, runtime, { maxRetries = 2 } = {}) {
  const { businessName = '', industry = '', metro = '', tier = '' } = leadContext || {};
  const verifier_history = [];
  let currentDraft = draft;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Build evaluation prompt
    const evalPrompt = `Evalúa este draft:\n\nLead: ${businessName} (${industry}, ${metro}, tier=${tier})\nAsunto: ${currentDraft.subject || ''}\nCuerpo:\n${currentDraft.body || ''}`;

    let result;
    try {
      // TODO: force Gemini provider once AgentRuntime supports _forceProvider context key
      result = await runtime.run('Verifier', evalPrompt, { currentAgent: 'Verifier' });
    } catch (err) {
      logger.warn('[VerifierGate] Verifier run error', { error: err.message });
      // Can't verify — pass through without blocking
      return { draft: currentDraft, verifier_history };
    }

    const parseResult = AgentRuntime.safeParseLLMOutput(result.response, verifierReportSchema);

    if (!parseResult.success) {
      logger.warn('[VerifierGate] Verifier output failed schema validation', { error: parseResult.error });
      // Pass through if we can't parse the report
      return { draft: currentDraft, verifier_history };
    }

    const report = parseResult.data;
    verifier_history.push(report);

    logger.info('[VerifierGate] Verifier report', {
      business: businessName,
      verdict: report.verdict,
      overall: report.overall,
      attempt,
    });

    if (report.verdict === 'pass') {
      return { draft: currentDraft, verifier_history };
    }

    // verdict === 'rewrite' — if retries exhausted, mark blocked
    if (attempt >= maxRetries) {
      logger.warn('[VerifierGate] Max retries reached — blocking draft', { business: businessName });
      return { draft: currentDraft, verifier_history, blocked: true };
    }

    // Ask Angela for a rewrite
    const rewritePrompt = `Reescribí este draft atendiendo: ${report.rewrite_hint}. Devolvé JSON con forma { "subject": "...", "body": "...", "whatsapp": "...", "instagram": "..." }`;

    let rewriteResult;
    try {
      rewriteResult = await runtime.run('Angela', rewritePrompt, { currentAgent: 'Angela' });
    } catch (err) {
      logger.warn('[VerifierGate] Angela rewrite error', { error: err.message });
      return { draft: currentDraft, verifier_history, blocked: true };
    }

    const rewriteParse = AgentRuntime.safeParseLLMOutput(rewriteResult.response, z.object({
      subject:   z.string(),
      body:      z.string(),
      whatsapp:  z.string().optional().default(''),
      instagram: z.string().optional().default(''),
    }));

    if (!rewriteParse.success) {
      logger.warn('[VerifierGate] Angela rewrite output invalid', { error: rewriteParse.error });
      return { draft: currentDraft, verifier_history, blocked: true };
    }

    currentDraft = rewriteParse.data;
    logger.info('[VerifierGate] Angela produced rewrite', { business: businessName, attempt: attempt + 1 });
  }

  // Should not reach here, but safety net
  return { draft: currentDraft, verifier_history, blocked: true };
}
