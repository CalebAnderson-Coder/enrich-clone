'use client';

import React from 'react';
import type { Lead } from '../../api/types';
import { LeadCard } from './lead-card';

// ============================================================
// Lead Grid — Responsive card layout for all leads
// ============================================================
export function LeadGrid({ leads }: { leads: Lead[] }) {
  if (!leads.length) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '80px 20px',
          color: '#64748b',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
          No se encontraron leads
        </h3>
        <p style={{ fontSize: 14 }}>
          Ejecuta una campaña de prospección para poblar esta vista.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats bar */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 20,
          padding: '12px 16px',
          background: 'rgba(30,41,59,0.5)',
          borderRadius: 12,
          border: '1px solid rgba(148,163,184,0.08)',
          flexWrap: 'wrap',
        }}
      >
        <StatPill label="Total Leads" value={leads.length} color="#60a5fa" />
        <StatPill
          label="🔥 HOT"
          value={leads.filter((l) => l.lead_tier?.toUpperCase() === 'HOT').length}
          color="#ef4444"
        />
        <StatPill
          label="🌤️ WARM"
          value={leads.filter((l) => l.lead_tier?.toUpperCase() === 'WARM').length}
          color="#f59e0b"
        />
        <StatPill
          label="❄️ COOL"
          value={leads.filter((l) => l.lead_tier?.toUpperCase() === 'COOL').length}
          color="#3b82f6"
        />
        <StatPill
          label="Con Análisis IA"
          value={leads.filter((l) => l.has_mega_profile).length}
          color="#10b981"
        />
      </div>

      {/* Card Grid */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Stat Pill
// ============================================================
function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 20, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}</span>
    </div>
  );
}
