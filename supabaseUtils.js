import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnon = process.env.SUPABASE_ANON_KEY || '';
const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseKey = supabaseService || supabaseAnon;
export const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null;

// Initial Setup Helper Structure
export async function createMarketingJob(brandId, taskType, payload) {
    if(!supabase) return null;
    const { data, error } = await supabase
        .from('marketing_jobs')
        .insert([{ brand_id: brandId, task_type: taskType, payload, status: 'PENDING' }])
        .select();
    
    if(error) console.error("Error creating job", error);
    return data ? data[0] : null;
}

// Prospect Storage
export async function saveProspect(prospectData) {
    if(!supabase) return null;

    const leadPayload = {
      business_name: prospectData.business_name,
      website: prospectData.website || '',
      phone: prospectData.phone || '',
      rating: prospectData.rating || 0,
      review_count: prospectData.reviews_count || 0,
      google_maps_url: prospectData.raw_data?.radar_parsed?.google_maps_url || null,
      facebook_url: prospectData.raw_data?.radar_parsed?.facebook_url || null,
      instagram_url: prospectData.raw_data?.radar_parsed?.instagram_url || null,
      linkedin_url: prospectData.raw_data?.radar_parsed?.linkedin_url || null,
      mega_profile: prospectData.raw_data || {},
      metro_area: prospectData.city || 'Desconocido',
      industry: 'Servicios',
      qualification_score: 0,
      lead_tier: 'COLD'
    };

    const { data, error } = await supabase
        .from('leads')
        .insert([leadPayload])
        .select();
    
    if(error) {
        console.error("Error saving prospect into leads", error);
        return null;
    }
    return data ? data[0] : null;
}

// Enriched Data Storage
export async function saveCampaignData(campaignData) {
    if(!supabase) return null;

    const jobPayload = {
        agent_name: 'Data Enrichment',
        task_type: 'radiography',
        status: campaignData.status || 'ENRICHED',
        payload: { target_lead_id: campaignData.prospect_id },
        result: {
            radiography: campaignData.radiography_technical,
            attack: campaignData.attack_angle,
            outreach: campaignData.outreach_copy
        }
    };

    const campaignPayload = {
        prospect_id: campaignData.prospect_id,
        radiography_technical: campaignData.radiography_technical,
        attack_angle: campaignData.attack_angle,
        outreach_copy: campaignData.outreach_copy,
        status: campaignData.status || 'ENRICHED'
    };

    const [jobsResult, campaignResult] = await Promise.all([
        supabase.from('jobs').insert([jobPayload]).select(),
        supabase.from('campaign_enriched_data').insert([campaignPayload]).select()
    ]);
    
    if(jobsResult.error) {
        console.error("Error saving campaign enriched data into jobs", jobsResult.error);
    }
    if (campaignResult.error) {
        console.error("Error saving campaign enriched data into campaign_enriched_data", campaignResult.error);
    }

    // Prefer returning the campaign data as it's the primary record type for leads
    return campaignResult.data ? campaignResult.data[0] : null;
}
