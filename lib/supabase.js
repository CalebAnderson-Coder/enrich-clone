// ============================================================
// lib/supabase.js — Supabase Client + Marketing Job Helpers
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ─────────────────────────────────────────────────────────────
// Multi-tenant helper (Phase B — single tenant per process)
// Each deployed worker/service runs with its own BRAND_ID env var.
// When you onboard a second tenant, spin up a second service with
// a different BRAND_ID, or evolve this helper to read from request
// context (Phase C).
// ─────────────────────────────────────────────────────────────
export function getCurrentBrandId() {
  const id = process.env.BRAND_ID;
  if (!id) {
    throw new Error('BRAND_ID env var is required for multi-tenant operations. Set it in Render / .env.');
  }
  return id;
}

import fs from 'fs-extra';
import path from 'path';

const jobsPath = path.resolve(process.cwd(), 'db_fallback/mock_jobs.json');

const defaultMockJobs = [
  {
    id: 'job-170420A-MGR',
    brand_id: 'empirika-ai',
    agent_name: 'Manager',
    task_type: 'strategic_planning',
    payload: { prompt: "Generar plan semestral B2B para captación de Real Estate en Miami usando RAG e investigación a profundidad." },
    status: 'PENDING',
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'job-170420B-ANG',
    brand_id: 'empirika-ai',
    agent_name: 'Angela',
    task_type: 'cold_outreach',
    payload: { leadName: "Luxury Miami Homes Group", industry: "Real Estate Brokers", niche: "Alto Perfil", message: "Draft correo inicial" },
    status: 'AWAITING_APPROVAL',
    created_at: new Date(Date.now() - 1800000).toISOString()
  },
  {
    id: 'job-170420C-SAM',
    brand_id: 'empirika-ai',
    agent_name: 'Sam',
    task_type: 'ads_creative',
    payload: { platform: "LinkedIn Ads", objective: "Lead Gen", audience: "B2B Sales Managers" },
    status: 'EXECUTED',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    result: { agentResponse: "Ad copy generated: 'Stop leaking pipeline. AI Agents close the gap 24/7.'" }
  }
];

let mockJobs = [];
try {
  mockJobs = fs.readJsonSync(jobsPath);
} catch (e) {
  mockJobs = defaultMockJobs;
  try { fs.writeJsonSync(jobsPath, mockJobs, { spaces: 2 }); } catch(err) {}
}

export function saveMockJobs() {
  try { fs.writeJsonSync(jobsPath, mockJobs, { spaces: 2 }); } catch(err) {}
}


export async function createJob(brandId, agentName, taskType, payload, statusOverride = 'PENDING') {
  const newJob = {
    id: `job-${Date.now()}`,
    brand_id: brandId,
    agent_name: agentName,
    task_type: taskType,
    payload,
    status: statusOverride,
    created_at: new Date().toISOString()
  };

  if (!supabase) {
    mockJobs.push(newJob);
    saveMockJobs();
    return newJob;
  }
  
  try {
    const { data, error } = await supabase
      .from('marketing_jobs')
      .insert([{
        brand_id: brandId,
        agent_name: agentName,
        task_type: taskType,
        payload,
        status: statusOverride,
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error(`  ❌ Create job error: ${err.message}. Falling back to mock DB.`);
    mockJobs.push(newJob);
    saveMockJobs();
    return newJob;
  }
}

export async function updateJobStatus(jobId, status, result = null) {
  if (!supabase) {
    const idx = mockJobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      mockJobs[idx].status = status;
      if (result) mockJobs[idx].result = result;
      if (status === 'EXECUTED') mockJobs[idx].executed_at = new Date().toISOString();
      saveMockJobs();
      return mockJobs[idx];
    }
    return { id: jobId, status };
  }

  const updates = { status };
  if (result) updates.result = result;
  if (status === 'EXECUTED') updates.executed_at = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('marketing_jobs')
      .update(updates)
      .eq('id', jobId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error(`  ❌ Update job error: ${err.message}. Falling back to mock DB.`);
    
    // Fallback logic
    const idx = mockJobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      mockJobs[idx].status = status;
      if (result) mockJobs[idx].result = result;
      if (status === 'EXECUTED') mockJobs[idx].executed_at = new Date().toISOString();
      saveMockJobs();
      return mockJobs[idx];
    }
    
    // If it wasn't in mockJobs, create a new mock job
    const newMockJob = { id: jobId, status, result, created_at: new Date().toISOString() };
    if (status === 'EXECUTED') newMockJob.executed_at = new Date().toISOString();
    mockJobs.push(newMockJob);
    saveMockJobs();
    return newMockJob;
  }
}

export async function getPendingJobs() {
  if (!supabase) {
    return mockJobs;
  }

  const { data, error } = await supabase
    .from('marketing_jobs')
    .select('*')
    .in('status', ['PENDING', 'APPROVED'])
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) { console.error('❌ Get pending jobs error:', error.message); return mockJobs; }
  return [...mockJobs, ...(data || [])];
}

export async function getJobById(jobId) {
  if (!supabase) {
    return mockJobs.find(j => j.id === jobId) || null;
  }
  const { data, error } = await supabase
    .from('marketing_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) return null;
  return data;
}

export async function getAwaitingApprovalJobs() {
  if (!supabase) {
    return mockJobs.filter(j => j.status === 'AWAITING_APPROVAL');
  }

  const { data, error } = await supabase
    .from('marketing_jobs')
    .select('*')
    .eq('status', 'AWAITING_APPROVAL')
    .order('created_at', { ascending: true });

  if (error) return [];
  return data || [];
}

// ---- Brands (multi-tenant) ----

export async function getBrandProfile(brandId) {
  if (!supabase) return { id: brandId, name: 'Demo Brand', industry: 'tech' };

  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single();

  if (error) return null;
  return data;
}

export async function getActiveBrands() {
  if (!supabase) return [{ id: 'demo-brand', name: 'Demo Brand' }];

  const { data, error } = await supabase
    .from('brands')
    .select('id, name, industry, website');

  if (error) return [];
  return data || [];
}

// ---- Agent Memory ----

export async function saveAgentMemory(agentName, brandId, key, value) {
  if (!supabase) return;

  await supabase
    .from('agent_memory')
    .upsert({
      agent_name: agentName,
      brand_id: brandId,
      memory_key: key,
      memory_value: value,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'agent_name,brand_id,memory_key',
    });
}

export async function getAgentMemory(agentName, brandId) {
  if (!supabase) return {};

  const { data, error } = await supabase
    .from('agent_memory')
    .select('memory_key, memory_value')
    .eq('agent_name', agentName)
    .eq('brand_id', brandId);

  if (error || !data) return {};
  return Object.fromEntries(data.map(d => [d.memory_key, d.memory_value]));
}
