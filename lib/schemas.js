// ============================================================
// lib/schemas.js — Zod Schemas for Agent Contract Design
// Validates tool inputs, LLM outputs, and data structures
// ============================================================

import { z } from 'zod';

// ── Lead Data Schema ──────────────────────────────────────────

export const leadSchema = z.object({
  business_name: z.string().min(1, "Business name is required"),
  owner_name: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  metro_area: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  google_maps_url: z.string().nullable().optional(),
  gmb_active: z.boolean().nullable().optional(),
  review_count: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  has_website: z.boolean().nullable().optional(),
  qualification_score: z.number().nullable().optional(),
  lead_tier: z.enum(['HOT', 'WARM', 'COOL', 'COLD']).nullable().optional(),
  score_breakdown: z.unknown().nullable().optional(),
  scraped_by: z.string().nullable().optional(),
  mega_profile: z.unknown().nullable().optional(),
  profiled_by: z.string().nullable().optional(),
  outreach_status: z.string().nullable().optional(),
  facebook_url: z.string().nullable().optional(),
  instagram_url: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  email_address: z.string().nullable().optional(),
});

// ── Campaign Data Schema ──────────────────────────────────────

export const campaignDataSchema = z.object({
  prospect_id: z.string().uuid("Invalid prospect ID"),
  radiography_technical: z.string().nullable().optional(),
  attack_angle: z.string().nullable().optional(),
  outreach_copy: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lead_magnet_status: z.string().nullable().optional()
});

// ── LLM Output Schemas (Agent Contracts) ──────────────────────

/** Radar agent output — lead discovery results */
export const radarOutputSchema = z.object({
  business_name: z.string().describe("Exact, official business name"),
  website: z.string().nullable().describe("Real website URL, or null if none"),
  phone: z.string().nullable().describe("Contact phone number"),
  rating: z.number().nullable().describe("Google Maps rating (e.g. 4.5)"),
  review_count: z.number().nullable().describe("Total review count"),
  google_maps_url: z.string().nullable().describe("Exact Google Maps link"),
  facebook_url: z.string().nullable().describe("Exact Facebook link"),
  instagram_url: z.string().nullable().describe("Exact Instagram link"),
  linkedin_url: z.string().nullable().describe("Exact LinkedIn link"),
  radar_summary: z.string().describe("Summary of findings")
});

/** Enrichment agent output — technical analysis */
export const enrichOutputSchema = z.object({
  radiography_technical: z.string().describe("1-2 paragraphs of technical web/social/local presence evaluation"),
  attack_angle: z.string().describe("Tactical sales angle in 1 direct paragraph"),
  outreach_copy: z.string().describe("Original subject and body for outreach")
});

/** Angela's outreach draft — email + whatsapp copy (LEGACY single-email contract) */
export const outreachDraftSchema = z.object({
  email_subject: z.string().min(5, "Subject line too short — needs at least 5 chars"),
  email_body: z.string().min(50, "Email body too short for professional outreach"),
  whatsapp: z.string().min(10, "WhatsApp message too short to be effective"),
});

// ── Angela 3-Touch Sequence (Observation → Proof → Ask) ──────

/** Single touch within Angela's 3-touch email sequence */
export const emailTouchSchema = z.object({
  touch: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  days_after_previous: z.number().int().min(0, "days_after_previous must be >= 0"),
  angle: z.enum(['observation', 'proof', 'ask']),
  subject: z.string().min(30, "Subject must be at least 30 chars").max(60, "Subject must be at most 60 chars"),
  body: z.string().min(80, "Body too short for professional outreach (min 80 chars)"),
  preview_text: z.string().min(40, "Preview text must be at least 40 chars").max(90, "Preview text must be at most 90 chars"),
}).refine(
  (t) => t.touch !== 1 || t.days_after_previous === 0,
  { message: "Touch 1 must have days_after_previous === 0", path: ['days_after_previous'] }
);

// ── SPIN Call Script — for phone/WhatsApp outreach on Path A ──

/**
 * SPIN selling framework call script.
 * The human rep uses this when dialing a DRAFT_PHONE lead.
 * Language defaults to 'es' because Empírika operates 100% in Spanish.
 */
export const callScriptSchema = z.object({
  opening: z.string().min(30, "Opening must be at least 30 chars").max(400),
  situation: z.string().min(30, "Situation question too short").max(400),
  problem: z.string().min(30, "Problem question too short").max(400),
  implication: z.string().min(30, "Implication question too short").max(400),
  need_payoff: z.string().min(30, "Need-payoff question too short").max(400),
  objection_handlers: z.array(z.object({
    objection: z.string().min(5),
    response: z.string().min(20),
  })).min(2, "Need at least 2 objection handlers").max(5),
  next_step: z.string().min(20, "next_step must be at least 20 chars").max(300),
  language: z.enum(['es', 'en']).default('es'),
});

/**
 * Angela's full outreach sequence — 3 ordered touches + whatsapp + optional call script.
 * Order MUST be observation → proof → ask (indices 0/1/2).
 * call_script is optional for backward compatibility with older Angela outputs.
 */
export const outreachSequenceSchema = z.object({
  email_sequence: z.array(emailTouchSchema)
    .length(3, "email_sequence must contain exactly 3 touches")
    .refine(
      (arr) => arr.length === 3 && arr[0].touch === 1 && arr[1].touch === 2 && arr[2].touch === 3,
      { message: "email_sequence must be ordered as touches 1, 2, 3" }
    )
    .refine(
      (arr) => arr.length === 3 && arr[0].angle === 'observation' && arr[1].angle === 'proof' && arr[2].angle === 'ask',
      { message: "email_sequence angles must follow observation → proof → ask" }
    ),
  whatsapp: z.string().min(10, "WhatsApp message too short to be effective"),
  call_script: callScriptSchema.optional(),
});

/**
 * Normalize Angela's output to a unified structure regardless of schema version.
 * Accepts BOTH the legacy {email_subject,email_body,whatsapp} and the new
 * {email_sequence,whatsapp}. Returns a canonical shape:
 *
 *   {
 *     touches: [touch1, touch2 | null, touch3 | null],
 *     whatsapp: string,
 *     legacy: boolean   // true when the input used the legacy single-email format
 *   }
 *
 * When the legacy format is provided, touch 1 is synthesized from the single
 * email (angle='observation', days_after_previous=0) and touches 2/3 are null.
 *
 * Throws if the raw payload matches neither contract.
 */
export function normalizeOutreachOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('normalizeOutreachOutput: input must be an object');
  }

  // New contract: sequence of 3
  if (Array.isArray(raw.email_sequence)) {
    const parsed = outreachSequenceSchema.parse(raw);
    return {
      touches: [parsed.email_sequence[0], parsed.email_sequence[1], parsed.email_sequence[2]],
      whatsapp: parsed.whatsapp,
      call_script: parsed.call_script || null,
      legacy: false,
    };
  }

  // Legacy contract: single email
  if (typeof raw.email_subject === 'string' && typeof raw.email_body === 'string') {
    const parsed = outreachDraftSchema.parse(raw);
    const touch1 = {
      touch: 1,
      days_after_previous: 0,
      angle: 'observation',
      subject: parsed.email_subject,
      body: parsed.email_body,
      preview_text: '',
    };
    return {
      touches: [touch1, null, null],
      whatsapp: parsed.whatsapp,
      call_script: null,
      legacy: true,
    };
  }

  throw new Error('normalizeOutreachOutput: payload matches neither legacy nor sequence contract');
}

// ── Tool Input Schemas ────────────────────────────────────────

/** save_lead tool — strict input validation */
export const saveLeadInputSchema = z.object({
  business_name: z.string().min(1, "business_name is required"),
  owner_name: z.string().optional(),
  industry: z.string().optional(),
  metro_area: z.string().min(1, "metro_area is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  google_maps_url: z.string().optional(),
  review_count: z.coerce.number().refine(n => Number.isFinite(n), { message: 'must be a finite number' }).optional(),
  rating: z.coerce.number().refine(n => Number.isFinite(n), { message: 'must be a finite number' }).min(0).max(5).optional(),
  qualification_score: z.coerce.number().refine(n => Number.isFinite(n), { message: 'must be a finite number' }).min(0).max(100),
  lead_tier: z.preprocess(
    v => typeof v === 'string' ? v.trim().toUpperCase() : v,
    z.enum(['HOT', 'WARM', 'COOL', 'COLD'])
  ),
  score_breakdown: z.string().optional(),
  auto_enrich: z.preprocess(v => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
    }
    return v;
  }, z.boolean().optional()),
});

/** update_mega_profile tool — strict input validation */
export const megaProfileInputSchema = z.object({
  lead_id: z.string().min(1, "lead_id is required"),
  mega_profile: z.string().min(1, "mega_profile JSON string is required"),
  profiled_by: z.string().optional(),
});

/** request_human_approval tool — strict input validation */
export const approvalInputSchema = z.object({
  job_id: z.string().min(1, "job_id is required"),
  content_type: z.enum(['email', 'blog', 'ad_copy', 'social_post', 'outreach']),
  draft_content: z.string().min(1, "draft_content cannot be empty"),
  summary: z.string().min(1, "summary is required"),
  lead_id: z.string().optional(),
  email_subject: z.string().optional(),
  email_body: z.string().optional(),
  whatsapp_message: z.string().optional(),
  instagram_message: z.string().optional(),
});

/** send_email tool — strict input validation */
export const sendEmailInputSchema = z.object({
  to: z.string().email("Invalid recipient email address"),
  subject: z.string().min(1, "Email subject cannot be empty"),
  html_body: z.string().min(1, "Email body cannot be empty"),
  from_name: z.string().optional(),
});

/** send_batch_emails tool — strict input validation */
export const sendBatchEmailsInputSchema = z.object({
  emails: z.array(z.object({
    to: z.string().email("Invalid recipient email address"),
    subject: z.string().min(1, "Email subject cannot be empty"),
    html_body: z.string().min(1, "Email body cannot be empty"),
  })).min(1, "At least one email required"),
});

// ── Standard Tool Result Envelope ─────────────────────────────

/** Standard wrapper for all tool return values */
export const toolResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});
