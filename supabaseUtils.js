import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnon = process.env.SUPABASE_ANON_KEY || '';
const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseKey = supabaseService || supabaseAnon;
export const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null;

import { leadSchema, campaignDataSchema } from './lib/schemas.js';

/**
 * Creates a new marketing job in the async job queue.
 * Jobs start as PENDING and require approval before execution (HITL pattern).
 *
 * @param {string} brandId - UUID of the brand (from `brands` table) requesting the job.
 * @param {string} taskType - Type of task: 'cold_outreach' | 'email_campaign' | 'social_post' | 'seo_audit'.
 * @param {Object} payload - Task-specific data (lead info, instructions, constraints).
 * @returns {Promise<Object|null>} The created job row from `marketing_jobs`, or null on error.
 *
 * @example
 * const job = await createMarketingJob(brandId, 'cold_outreach', { leadIds: ['...'] });
 */
export async function createMarketingJob(brandId, taskType, payload) {
    if(!supabase) return null;
    const { data, error } = await supabase
        .from('marketing_jobs')
        .insert([{ brand_id: brandId, task_type: taskType, payload, status: 'PENDING' }])
        .select();
    
    if(error) console.error("Error creating job", error);
    return data ? data[0] : null;
}

/**
 * Saves a new prospect (lead) to the `leads` table.
 * Applies Zod validation via `leadSchema` before insertion.
 *
 * IMPORTANT: Column mapping handles legacy vs production field names:
 *   - `reviews_count` → `review_count` (production column name)
 *   - `raw_data`      → `mega_profile` (production column name)
 *   - `city`          → `metro_area`   (production column name)
 *
 * @param {Object} prospectData - Raw prospect data from Scout agent.
 * @param {string} prospectData.business_name - Business name (required).
 * @param {string} [prospectData.website] - Business website URL.
 * @param {string} [prospectData.phone] - Phone number.
 * @param {number} [prospectData.rating] - Google Maps rating (1.0–5.0).
 * @param {number} [prospectData.reviews_count] - Google review count (legacy name).
 * @param {number} [prospectData.review_count] - Google review count (production name).
 * @param {Object} [prospectData.raw_data] - Full enrichment payload (stored as `mega_profile`).
 * @param {Object} [prospectData.raw_data.radar_parsed] - Parsed social URLs from radar.
 * @param {string} [prospectData.city] - Metro area (stored as `metro_area`).
 * @param {string} [prospectData.industry] - Business industry vertical.
 * @param {number} [prospectData.qualification_score] - GATE filter score (0–100).
 * @param {string} [prospectData.lead_tier] - Lead tier: 'HOT' | 'WARM' | 'COOL' | 'COLD'.
 * @param {string} [prospectData.email_address] - Verified outreach email.
 * @returns {Promise<Object|null>} The inserted lead row, or null on validation/DB error.
 */
export async function saveProspect(prospectData) {
    if(!supabase) return null;

    // ──────────────────────────────────────────────────────────────
    // IMPORTANT: Column names below match the PRODUCTION Supabase
    // schema (discovered via scripts/check_schema.js), NOT the
    // local schema.sql which is out of sync.
    //   local schema.sql  →  production column
    //   reviews_count      →  review_count
    //   raw_data           →  mega_profile
    //   city               →  metro_area
    // ──────────────────────────────────────────────────────────────
    const leadPayload = {
      business_name: prospectData.business_name,
      website: prospectData.website || '',
      phone: prospectData.phone || '',
      rating: prospectData.rating || 0,
      review_count: prospectData.reviews_count || prospectData.review_count || 0,
      google_maps_url: prospectData.raw_data?.radar_parsed?.google_maps_url || null,
      facebook_url: prospectData.raw_data?.radar_parsed?.facebook_url || null,
      instagram_url: prospectData.raw_data?.radar_parsed?.instagram_url || null,
      linkedin_url: prospectData.raw_data?.radar_parsed?.linkedin_url || null,
      mega_profile: prospectData.raw_data || {},
      metro_area: prospectData.city || 'Desconocido',
      industry: prospectData.industry || 'Servicios',
      qualification_score: prospectData.qualification_score || 0,
      lead_tier: prospectData.lead_tier || 'COLD',
      email_address: prospectData.email_address || null
    };

    let safePayload;
    try {
        safePayload = leadSchema.parse(leadPayload);
    } catch (e) {
        console.error("❌ Zod Validation Error en saveProspect:", e.errors);
        return null;
    }

    const { data, error } = await supabase
        .from('leads')
        .insert([safePayload])
        .select();
    
    if(error) {
        console.error("Error saving prospect into leads", error);
        return null;
    }
    return data ? data[0] : null;
}

/**
 * Saves enrichment and outreach artifacts for a prospect to `campaign_enriched_data`.
 * Applies Zod validation via `campaignDataSchema` before insertion.
 * Called after the "Francotirador" (Sniper) macro-flow completes:
 *   1. Technical radiography (Helena + Sam + Kai)
 *   2. Attack angle (Carlos)
 *   3. Outreach copy (Angela)
 *
 * @param {Object} campaignData - Enrichment data from the agent pipeline.
 * @param {string} campaignData.prospect_id - UUID FK to `leads.id`.
 * @param {string} campaignData.radiography_technical - Technical audit (SEO, speed, ads, social).
 * @param {string} campaignData.attack_angle - Carlos's strategic sales angle.
 * @param {string} campaignData.outreach_copy - Angela's multi-channel outreach messages.
 * @param {string} [campaignData.status='ENRICHED'] - Status: 'PENDING' | 'ENRICHED' | 'SENT' | 'FAILED'.
 * @returns {Promise<Object|null>} The inserted campaign row, or null on validation/DB error.
 */
export async function saveCampaignData(campaignData) {
    if(!supabase) return null;

    const campaignPayload = {
        prospect_id: campaignData.prospect_id,
        radiography_technical: campaignData.radiography_technical,
        attack_angle: campaignData.attack_angle,
        outreach_copy: campaignData.outreach_copy,
        status: campaignData.status || 'ENRICHED'
    };

    let safePayload;
    try {
        safePayload = campaignDataSchema.parse(campaignPayload);
    } catch (e) {
        console.error("❌ Zod Validation Error en saveCampaignData:", e.errors);
        return null;
    }

    const campaignResult = await supabase.from('campaign_enriched_data').insert([safePayload]).select();
    
    if (campaignResult.error) {
        console.error("Error saving campaign enriched data into campaign_enriched_data", campaignResult.error);
    }

    // Return the campaign data
    return campaignResult.data ? campaignResult.data[0] : null;
}
