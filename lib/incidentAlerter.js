// ============================================================
// lib/incidentAlerter.js — Email alerter for Atlas CRITICAL incidents
//
// When Atlas detects a CRITICAL incident, Manager invokes this to
// email the operator (Brian) outside the dashboard. Anti-spam via
// fingerprint match against last_incident_email_fingerprint in
// agent_state — same fingerprint within 60 min → suppress.
// ============================================================

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const RECIPIENT     = process.env.INCIDENT_ALERT_TO || 'brian@doublemybookings.com';
const DEDUPE_MS     = 60 * 60 * 1000;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://enrich-dashboard-seven.vercel.app';
const BRAND_ID      = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

function buildSmtpTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user, pass: pass.trim() },
    tls: { rejectUnauthorized: false },
  });
}

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function fingerprintFromFindings(findings = []) {
  return findings
    .filter((f) => f?.severity === 'critical')
    .map((f) => `${f.kind}:${f.agent ?? '_'}`)
    .sort()
    .join('|') || 'unknown';
}

function renderBody(payload) {
  const { audit_id, summary, findings = [], opened_at } = payload || {};
  const findingsLines = findings
    .filter((f) => f?.severity === 'critical')
    .map((f) => `  • [${(f.kind || '').toUpperCase()}] ${f.agent || 'sin agente'} — ${f.detail || ''}`)
    .join('\n') || '  (sin findings detallados)';

  return [
    'Atlas detectó un incidente CRÍTICO en el fleet Empírika.',
    '',
    `Resumen: ${summary || 'sin resumen'}`,
    `Reportado: ${opened_at || new Date().toISOString()}`,
    `Audit ID: ${audit_id ?? 'n/d'}`,
    '',
    'Hallazgos críticos:',
    findingsLines,
    '',
    `Dashboard: ${DASHBOARD_URL}/atlas`,
    '',
    '— Atlas, agente auditor del fleet Empírika',
  ].join('\n');
}

/**
 * Sends an incident alert email if all gates pass.
 *
 * @param {object} payload  The incident_detected payload from Atlas.
 * @returns {Promise<{sent: boolean, reason?: string, fingerprint: string}>}
 */
export async function sendIncidentEmail(payload) {
  const fingerprint = fingerprintFromFindings(payload?.findings);
  const transporter = buildSmtpTransport();

  if (!transporter) {
    return { sent: false, reason: 'smtp_not_configured', fingerprint };
  }

  // Anti-spam dedupe via agent_state.
  const supabase = buildSupabase();
  if (supabase) {
    try {
      const { data: prev } = await supabase
        .from('agent_state')
        .select('value, updated_at')
        .eq('brand_id', BRAND_ID)
        .eq('agent_name', 'Atlas')
        .eq('key', 'last_incident_email_fingerprint')
        .maybeSingle();
      if (prev?.value === fingerprint && prev?.updated_at) {
        const ageMs = Date.now() - new Date(prev.updated_at).getTime();
        if (ageMs < DEDUPE_MS) {
          return { sent: false, reason: 'duplicate_within_dedupe_window', fingerprint };
        }
      }
    } catch (_) {
      // Non-fatal — continue with the send
    }
  }

  await transporter.sendMail({
    from: `"Atlas · Empírika" <${process.env.SMTP_USER}>`,
    to: RECIPIENT,
    subject: 'Empírika · INCIDENT CRITICAL detectado por Atlas',
    text: renderBody(payload),
  });

  if (supabase) {
    try {
      await supabase
        .from('agent_state')
        .upsert({
          brand_id: BRAND_ID,
          agent_name: 'Atlas',
          key: 'last_incident_email_fingerprint',
          value: fingerprint,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'brand_id,agent_name,key' });
    } catch (_) { /* swallow */ }
  }

  return { sent: true, fingerprint };
}
