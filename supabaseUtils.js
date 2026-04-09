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
    const { data, error } = await supabase
        .from('prospects')
        .insert([prospectData])
        .select();
    
    if(error) {
        console.error("Error saving prospect", error);
        return null;
    }
    return data ? data[0] : null;
}

// Enriched Data Storage
export async function saveCampaignData(campaignData) {
    if(!supabase) return null;
    const { data, error } = await supabase
        .from('campaign_enriched_data')
        .insert([campaignData])
        .select();
    
    if(error) {
        console.error("Error saving campaign enriched data", error);
        return null;
    }
    return data ? data[0] : null;
}
