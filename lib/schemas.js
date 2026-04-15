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

/** Angela's outreach draft — email + whatsapp copy */
export const outreachDraftSchema = z.object({
  email_subject: z.string().min(5, "Subject line too short — needs at least 5 chars"),
  email_body: z.string().min(50, "Email body too short for professional outreach"),
  whatsapp: z.string().min(10, "WhatsApp message too short to be effective"),
});

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
  review_count: z.coerce.number().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  qualification_score: z.coerce.number().min(0).max(100),
  lead_tier: z.enum(['HOT', 'WARM', 'COOL', 'COLD']),
  score_breakdown: z.string().optional(),
  auto_enrich: z.boolean().optional(),
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
