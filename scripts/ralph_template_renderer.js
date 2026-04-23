// ============================================================
// scripts/ralph_template_renderer.js — render a ralph template
// for a given autonomy_audits row.
//
// Pure function, no side effects. Used by:
//   - tests/briefing_dispatch_plan.spec.js (synthetic row test)
//   - empirika-briefing skill (Week 2+) to build the ralph prompt
//     before invoking /oh-my-claudecode:ralph.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT  = path.resolve(path.dirname(__filename), '..');
const TEMPLATES  = path.join(REPO_ROOT, '.omc', 'ralph-templates');

/** Escape a string for inclusion inside a regex literal. */
export function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the word-boundary regex pattern for a brand name. */
export function brandNameToRegex(brandName) {
  const escaped = escapeRegex(brandName).trim();
  if (!escaped) throw new Error('brand_name required');
  return `/\\b${escaped.toLowerCase()}\\b/i`;
}

/** Load a ralph template by suggested_action. Returns raw markdown. */
export function loadTemplate(suggestedAction) {
  const filename = `${suggestedAction.toLowerCase()}.md`;
  const filepath = path.join(TEMPLATES, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`ralph template not found for action="${suggestedAction}" (looked at ${filepath})`);
  }
  return fs.readFileSync(filepath, 'utf8');
}

/**
 * Render a ralph prompt block for an audit row.
 *
 * Extracts the fenced ``` block that holds the prompt and substitutes
 * {{brand_name}}, {{regex_pattern}}, {{audit_id}}, {{evidence}}.
 *
 * @param {Object} audit  An autonomy_audits row
 * @param {Object} [opts] { templateDir }
 * @returns {{ prompt: string, variables: Object, template_action: string }}
 */
export function renderRalphPrompt(audit, opts = {}) {
  if (!audit || !audit.suggested_action) {
    throw new Error('audit.suggested_action required');
  }
  const action = audit.suggested_action;
  const raw = opts.templateRaw || loadTemplate(action);

  // Extract the FIRST fenced ``` block (authoritative ralph prompt).
  const match = raw.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`template ${action} has no fenced prompt block`);

  const details = audit.details || {};
  const brandName = details.brand_name || details.business_name || '';
  if (!brandName) throw new Error(`audit.details.brand_name required for ${action}`);

  const variables = {
    brand_name:     brandName,
    regex_pattern:  brandNameToRegex(brandName),
    audit_id:       audit.id || 'UNKNOWN',
    evidence:       details.evidence || `Detected via metric ${audit.metric_name || 'unknown'}`,
  };

  let prompt = match[1];
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replaceAll(`{{${key}}}`, String(value));
  }

  // Hard assertion: no unfilled mustache variables remain.
  const leftover = prompt.match(/\{\{[a-z_]+\}\}/gi);
  if (leftover) {
    throw new Error(`unfilled template variables: ${leftover.join(', ')}`);
  }

  return { prompt, variables, template_action: action };
}
