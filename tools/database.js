// ============================================================
// tools/database.js — Lead Management Tools for Agents
// CRUD operations for the `leads` table in Supabase
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { supabase } from '../lib/supabase.js';

import fs from 'fs-extra';
import path from 'path';

const leadsPath = path.resolve(process.cwd(), 'db_fallback/mock_leads.json');

const defaultMockLeads = [
  ...Array.from({ length: 35 }).map((_, i) => {
    const latNames = ['Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Torres'];
    const subNiches = ['Roofing', 'Landscaping', 'Remodeling', 'Plumbing', 'HVAC'];
    const owner = latNames[i % latNames.length];
    const niche = subNiches[i % subNiches.length];
    
    return {
      id: `lead-mock-${Date.now()}-${i}`,
      business_name: `${owner} & Sons ${niche} Miami`,
      owner_name: `Jose ${owner}`,
      industry: niche,
      metro_area: 'Miami FL',
      phone: `(305) 555-0${100 + i}`,
      email: `contacto@${owner.toLowerCase()}${niche.toLowerCase()}miami.com`,
      website: i % 3 === 0 ? `https://www.${owner.toLowerCase()}${niche.toLowerCase()}miami.com` : null,
      google_maps_url: `https://maps.google.com/?q=${owner}+${niche}+Miami`,
      gmb_active: true,
      review_count: 20 + Math.floor(Math.random() * 100),
      rating: 4.5 + Math.random() * 0.5,
      has_website: i % 3 === 0,
      qualification_score: 75 + Math.floor(Math.random() * 25),
      lead_tier: 'HOT',
      score_breakdown: {},
      scraped_by: 'scout',
      outreach_status: 'PENDING',
      created_at: new Date(Date.now() - i * 3600000).toISOString()
    };
  })
];

let mockLeads = [];
try {
  mockLeads = fs.readJsonSync(leadsPath);
} catch (e) {
  mockLeads = defaultMockLeads;
  try { fs.writeJsonSync(leadsPath, mockLeads, { spaces: 2 }); } catch(err) {}
}

function saveMockLeads() {
  try { fs.writeJsonSync(leadsPath, mockLeads, { spaces: 2 }); } catch(err) {}
}


export const saveLead = new Tool({
  name: 'save_lead',
  description: `Save a qualified lead to the database with its qualification score and tier. Use after Google Maps scraping and GATE filter verification. Returns the saved lead ID.`,
  parameters: {
    type: 'object',
    properties: {
      business_name: { type: 'string', description: 'Business name' },
      owner_name: { type: 'string', description: 'Owner name (if known)' },
      industry: { type: 'string', description: 'Industry/niche (e.g. landscaping, remodeling)' },
      metro_area: { type: 'string', description: 'Metro area (e.g. Miami FL)' },
      address: { type: 'string', description: 'Physical address' },
      phone: { type: 'string', description: 'Phone number' },
      email: { type: 'string', description: 'Email address' },
      website: { type: 'string', description: 'Website URL' },
      google_maps_url: { type: 'string', description: 'Google Maps URL' },
      review_count: { type: 'number', description: 'Number of Google reviews' },
      rating: { type: 'number', description: 'Google rating (1-5)' },
      qualification_score: { type: 'number', description: 'Lead score (0-100)' },
      lead_tier: { type: 'string', description: 'Lead tier: HOT, WARM, COOL, or COLD' },
      score_breakdown: { type: 'string', description: 'JSON string with score breakdown by category' },
    },
    required: ['business_name', 'metro_area', 'qualification_score', 'lead_tier'],
  },
  fn: async (args) => {
    const leadData = {
      business_name: args.business_name,
      owner_name: args.owner_name || null,
      industry: args.industry || null,
      metro_area: args.metro_area,
      phone: args.phone || null,
      email: args.email || null,
      website: args.website || null,
      google_maps_url: args.google_maps_url || null,
      gmb_active: true, // Passed GATE
      review_count: args.review_count || 0,
      rating: args.rating || 0,
      has_website: !!args.website,
      qualification_score: args.qualification_score,
      lead_tier: args.lead_tier,
      score_breakdown: args.score_breakdown ? JSON.parse(args.score_breakdown) : {},
      scraped_by: 'scout',
    };

    if (!supabase) {
      const mockLead = { id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...leadData, created_at: new Date().toISOString() };
      mockLeads.push(mockLead);
      saveMockLeads();
      console.log(`  💾 [DB-MOCK] Saved lead: ${leadData.business_name} (${leadData.lead_tier} / ${leadData.qualification_score}pts)`);
      return JSON.stringify({ success: true, id: mockLead.id, tier: leadData.lead_tier });
    }

    try {
      const { data, error } = await supabase
        .from('leads')
        .insert([leadData])
        .select('id, lead_tier, qualification_score')
        .single();

      if (error) throw error;

      console.log(`  💾 [DB] Saved lead: ${leadData.business_name} (${leadData.lead_tier} / ${leadData.qualification_score}pts)`);
      return JSON.stringify({ success: true, id: data.id, tier: data.lead_tier, score: data.qualification_score });
    } catch (err) {
      console.error(`  ❌ [DB] Save lead error: ${err.message}. Falling back to mock DB.`);
      const mockLead = { id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...leadData, created_at: new Date().toISOString() };
      mockLeads.push(mockLead);
      saveMockLeads();
      return JSON.stringify({ success: true, id: mockLead.id, tier: leadData.lead_tier, score: leadData.qualification_score, fallback: true });
    }
  },
});

export const updateMegaProfile = new Tool({
  name: 'update_mega_profile',
  description: `Update a lead's MEGA profile with enrichment data. Call this after Helena, Sam, Kai, and Angela have completed their analysis.`,
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'string', description: 'The lead ID to update' },
      mega_profile: { type: 'string', description: 'JSON string containing the full MEGA profile analysis' },
      profiled_by: { type: 'string', description: 'Which agent(s) did the profiling' },
    },
    required: ['lead_id', 'mega_profile'],
  },
  fn: async (args) => {
    const { lead_id, mega_profile, profiled_by = 'helena+sam+kai+angela' } = args;
    let profileData;
    
    try {
      profileData = JSON.parse(mega_profile);
    } catch {
      profileData = { raw: mega_profile };
    }

    if (!supabase) {
      const idx = mockLeads.findIndex(l => l.id === lead_id);
      if (idx !== -1) {
        mockLeads[idx].mega_profile = profileData;
        mockLeads[idx].profiled_by = profiled_by;
        mockLeads[idx].updated_at = new Date().toISOString();
        saveMockLeads();
      }
      console.log(`  📝 [DB-MOCK] Updated MEGA profile for ${lead_id}`);
      return JSON.stringify({ success: true, lead_id });
    }

    try {
      const { error } = await supabase
        .from('leads')
        .update({
          mega_profile: profileData,
          profiled_by,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead_id);

      if (error) throw error;

      console.log(`  📝 [DB] Updated MEGA profile for ${lead_id}`);
      return JSON.stringify({ success: true, lead_id });
    } catch (err) {
      console.error(`  ❌ [DB] MEGA profile update error: ${err.message}. Falling back to mock DB.`);
      const idx = mockLeads.findIndex(l => l.id === lead_id);
      if (idx !== -1) {
        mockLeads[idx].mega_profile = profileData;
        mockLeads[idx].profiled_by = profiled_by;
        mockLeads[idx].updated_at = new Date().toISOString();
        saveMockLeads();
      }
      return JSON.stringify({ success: true, lead_id, fallback: true });
    }
  },
});

// --- Helper functions for API endpoints (not agent tools) ---

export async function getLeads(filters = {}) {
  const limit = parseInt(filters.limit) || 20;
  const page = parseInt(filters.page) || 1;
  const offset = (page - 1) * limit;

  if (!supabase) {
    let results = [...mockLeads];
    if (filters.tier) results = results.filter(l => l.lead_tier === filters.tier);
    if (filters.metro) results = results.filter(l => l.metro_area?.includes(filters.metro));
    if (filters.industry) results = results.filter(l => l.industry?.includes(filters.industry));
    if (filters.outreach_status) results = results.filter(l => l.outreach_status === filters.outreach_status);
    
    results = results.sort((a, b) => (b.qualification_score || 0) - (a.qualification_score || 0));
    
    const paginated = results.slice(offset, offset + limit);
    return { data: paginated, total: results.length };
  }

  let query = supabase.from('leads').select('*', { count: 'exact' });
  
  if (filters.tier) query = query.eq('lead_tier', filters.tier);
  if (filters.metro) query = query.ilike('metro_area', `%${filters.metro}%`);
  if (filters.industry) query = query.ilike('industry', `%${filters.industry}%`);
  if (filters.outreach_status) query = query.eq('outreach_status', filters.outreach_status);
  
  query = query.order('qualification_score', { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) { 
    console.error('❌ Get leads error:', error.message); 
    const fallbackResults = mockLeads.slice(offset, offset + limit);
    return { data: fallbackResults, total: mockLeads.length };
  }
  
  return { data: data || [], total: count || 0 };
}

export async function getLeadById(leadId) {
  if (!supabase) {
    return mockLeads.find(l => l.id === leadId) || null;
  }

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error) return null;
  return data;
}

export async function getLeadsStats() {
  const stats = {
    byTier: {},
    byMetro: {},
    byIndustry: {}
  };

  if (!supabase) {
    mockLeads.forEach(lead => {
      if (lead.lead_tier) stats.byTier[lead.lead_tier] = (stats.byTier[lead.lead_tier] || 0) + 1;
      if (lead.metro_area) stats.byMetro[lead.metro_area] = (stats.byMetro[lead.metro_area] || 0) + 1;
      if (lead.industry) stats.byIndustry[lead.industry] = (stats.byIndustry[lead.industry] || 0) + 1;
    });
    return stats;
  }

  const { data, error } = await supabase.from('leads').select('lead_tier, metro_area, industry');
  if (error) {
    console.error('❌ Get leads stats error:', error.message);
    return stats;
  }

  (data || []).forEach(lead => {
    if (lead.lead_tier) stats.byTier[lead.lead_tier] = (stats.byTier[lead.lead_tier] || 0) + 1;
    if (lead.metro_area) stats.byMetro[lead.metro_area] = (stats.byMetro[lead.metro_area] || 0) + 1;
    if (lead.industry) stats.byIndustry[lead.industry] = (stats.byIndustry[lead.industry] || 0) + 1;
  });

  return stats;
}

export async function updateOutreachStatus(leadId, status, notes = null) {
  const updates = {
    outreach_status: status,
    updated_at: new Date().toISOString(),
  };
  if (notes) updates.notes = notes;
  if (status === 'CONTACTED' && !updates.first_contact_date) {
    updates.first_contact_date = new Date().toISOString();
  }
  updates.last_contact_date = new Date().toISOString();

  if (!supabase) {
    const idx = mockLeads.findIndex(l => l.id === leadId);
    if (idx !== -1) {
      Object.assign(mockLeads[idx], updates);
      saveMockLeads();
    }
    return mockLeads[idx] || null;
  }

  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', leadId)
    .select()
    .single();

  if (error) return null;
  return data;
}

export function getMockLeads() {
  return mockLeads;
}

// ============================================================
// LEGACY EXPORTS — Used by existing agents (Angela, Helena, Sam, Kai, Manager)
// Keep these for backwards compatibility
// ============================================================

export const readBrandProfile = new Tool({
  name: 'read_brand_profile',
  description: 'Read the brand profile for the current client. Returns brand name, tone, audience, goals, and guidelines.',
  parameters: {
    type: 'object',
    properties: {
      brand_id: { type: 'string', description: 'Brand ID to look up' },
    },
    required: ['brand_id'],
  },
  fn: async (args) => {
    const { brand_id } = args;

    if (!supabase) {
      return JSON.stringify({
        id: brand_id,
        name: 'Empírika',
        tone: 'Professional yet warm, bilingual (Spanish/English)',
        audience: 'Latino-owned service businesses in the USA',
        goals: 'Digital marketing services for businesses with strong reputations but weak digital presence',
        guidelines: 'Always address leads in Spanish first. Focus on data-driven insights. Never make promises without evidence.',
      });
    }

    try {
      const { data, error } = await supabase
        .from('brand_profiles')
        .select('*')
        .eq('id', brand_id)
        .single();

      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data);
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
});

export const saveMemory = new Tool({
  name: 'save_memory',
  description: 'Save a learning, insight, or piece of context to agent memory for future recall.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory key/topic (e.g. "email_best_subject_lines")' },
      value: { type: 'string', description: 'The information to remember' },
      agent: { type: 'string', description: 'Which agent is saving this memory' },
    },
    required: ['key', 'value'],
  },
  fn: async (args) => {
    const { key, value, agent = 'unknown' } = args;

    if (!supabase) {
      console.log(`  🧠 [Memory-MOCK] ${agent} saved: "${key}" = "${value.slice(0, 60)}..."`);
      return JSON.stringify({ success: true, key });
    }

    try {
      const { error } = await supabase
        .from('agent_memory')
        .upsert([{ key, value, agent, updated_at: new Date().toISOString() }], { onConflict: 'key' });

      if (error) throw error;
      console.log(`  🧠 [Memory] ${agent} saved: "${key}"`);
      return JSON.stringify({ success: true, key });
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
});

export const recallMemory = new Tool({
  name: 'recall_memory',
  description: 'Recall a previously saved memory by key or search term.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory key to recall' },
    },
    required: ['key'],
  },
  fn: async (args) => {
    const { key } = args;

    if (!supabase) {
      return JSON.stringify({ key, value: null, note: 'No memory found (mock mode)' });
    }

    try {
      const { data, error } = await supabase
        .from('agent_memory')
        .select('*')
        .eq('key', key)
        .single();

      if (error) return JSON.stringify({ key, value: null });
      return JSON.stringify(data);
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  },
});

export const createMarketingJob = new Tool({
  name: 'create_marketing_job',
  description: 'Create a new marketing job/task for an agent to execute. Jobs go through approval before execution.',
  parameters: {
    type: 'object',
    properties: {
      brand_id: { type: 'string', description: 'Brand ID this job is for' },
      agent_name: { type: 'string', description: 'Agent to assign the job to' },
      task_type: { type: 'string', description: 'Type of task (e.g. "email_campaign", "social_post", "seo_audit")' },
      description: { type: 'string', description: 'Detailed description of the task' },
    },
    required: ['brand_id', 'agent_name', 'task_type', 'description'],
  },
  fn: async (args) => {
    const { brand_id, agent_name, task_type, description } = args;
    const { createJob } = await import('../lib/supabase.js');

    try {
      const job = await createJob(brand_id, agent_name, task_type, { description });
      if (!job) throw new Error('Job creation failed');
      
      console.log(`  📋 [Job] Created: ${task_type} for ${agent_name}`);
      return JSON.stringify(job);
    } catch (err) {
      console.error(`  ❌ [Job] Error: ${err.message}. Generating ephemeral job.`);
      const mockJob = {
        id: `job-${Date.now()}`,
        brand_id,
        agent_name,
        task_type,
        description,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
      return JSON.stringify(mockJob);
    }
  },
});
