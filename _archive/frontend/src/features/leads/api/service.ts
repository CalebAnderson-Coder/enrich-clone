// ============================================================
// Lead Service — Data Access Layer
// ============================================================

import type { LeadFilters, LeadsResponse, LeadMutationPayload } from './types';

// Replace with your actual backend URL or route handler
const API_URL = '/api/leads';

export async function getLeads(filters: LeadFilters): Promise<LeadsResponse> {
  const isServer = typeof window === 'undefined';
  const baseUrl = isServer ? (process.env.BACKEND_URL || 'http://localhost:3001') : '';
  
  const urlObj = new URL(API_URL, 'http://dummy.local');
  if (filters.search) urlObj.searchParams.set('search', filters.search);
  if (filters.page) urlObj.searchParams.set('page', filters.page.toString());
  if (filters.limit) urlObj.searchParams.set('limit', filters.limit.toString());
  if (filters.status) urlObj.searchParams.set('status', filters.status);
  
  const finalUrl = isServer 
    ? `${baseUrl}${urlObj.pathname}${urlObj.search}` 
    : `${urlObj.pathname}${urlObj.search}`;
  
  const API_KEY = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_API_SECRET_KEY || 'sk_live_51MxxXYZ123SecureEnrichToken2026';
  const headers: HeadersInit = {
    'Authorization': `Bearer ${API_KEY}`
  };

  const res = await fetch(finalUrl, { headers });
  if (!res.ok) throw new Error('Failed to fetch leads');
  const data = await res.json();
  
  // Backend returns { total, limit, page, leads: [...] }
  const leadsArray = data.leads || (Array.isArray(data) ? data : data.data || []);
  return {
    success: true,
    time: new Date().toISOString(),
    message: 'success',
    total_leads: data.total || leadsArray.length,
    offset: 0,
    limit: data.limit || 1000,
    leads: leadsArray
  };
}

export async function createLead(data: LeadMutationPayload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create lead');
  return res.json();
}

export async function updateLead(id: string, data: LeadMutationPayload) {
  const res = await fetch(`${API_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update lead');
  return res.json();
}

export async function deleteLead(id: string) {
  const res = await fetch(`${API_URL}/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Failed to delete lead');
  return res.json();
}

export async function prospectLeads(data: { metro: string; niche: string; limit: number; autoEnrich: boolean }) {
  const res = await fetch('/api/prospect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to start prospecting');
  return res.json();
}
