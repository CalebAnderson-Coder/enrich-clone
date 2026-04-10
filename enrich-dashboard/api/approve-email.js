// ============================================================
// api/approve-email.js — Vercel Serverless Function
// Handles email approval/rejection from the dashboard
// ============================================================

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { campaignId, action, rejectionReason } = req.body;

    if (!campaignId || !action) {
      return res.status(400).json({ error: 'Missing campaignId or action' });
    }

    // ── REJECT ──────────────────────────────────────────────
    if (action === 'reject') {
      const { error } = await supabase
        .from('campaign_enriched_data')
        .update({
          approval_status: 'REJECTED',
          rejection_reason: rejectionReason || 'Sin razón especificada',
        })
        .eq('id', campaignId);

      if (error) throw error;
      return res.status(200).json({ success: true, status: 'REJECTED' });
    }

    // ── APPROVE ─────────────────────────────────────────────
    if (action === 'approve') {
      // 1. Fetch the campaign record with lead data
      const { data: campaign, error: fetchError } = await supabase
        .from('campaign_enriched_data')
        .select(`
          id,
          prospect_id,
          email_draft_subject,
          email_draft_html,
          lead_magnets_data,
          leads!inner (
            id,
            business_name,
            email,
            email_address,
            phone,
            owner_name,
            industry,
            metro_area
          )
        `)
        .eq('id', campaignId)
        .single();

      if (fetchError || !campaign) {
        return res.status(404).json({ error: 'Campaign not found', details: fetchError?.message });
      }

      const lead = campaign.leads;
      const toEmail = lead.email_address || lead.email;
      const subject = campaign.email_draft_subject;
      const html = campaign.email_draft_html;

      if (!toEmail) {
        return res.status(400).json({ error: 'Lead has no email address' });
      }

      if (!html || !subject) {
        return res.status(400).json({ error: 'No email draft found — run the pre-render first' });
      }

      // 2. Send email via SMTP
      let emailId = `mock-${Date.now()}`;
      const SMTP_USER = process.env.SMTP_USER;
      const SMTP_PASS = process.env.SMTP_PASS;

      if (SMTP_USER && SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: false,
          auth: { user: SMTP_USER, pass: SMTP_PASS.trim() },
          tls: { rejectUnauthorized: false },
        });

        const fromName = process.env.SMTP_FROM_NAME || 'Ángela · Agency Fleet';
        const info = await transporter.sendMail({
          from: `"${fromName}" <${SMTP_USER}>`,
          to: toEmail,
          subject,
          html,
        });
        emailId = info.messageId;
      }

      // 3. Create/update contact in GHL
      let ghlContactId = null;
      const GHL_API_KEY = process.env.GHL_API_KEY;
      const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

      if (GHL_API_KEY && GHL_LOCATION_ID) {
        try {
          const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GHL_API_KEY}`,
              'Content-Type': 'application/json',
              'Version': '2021-07-28',
            },
            body: JSON.stringify({
              locationId: GHL_LOCATION_ID,
              email: toEmail,
              name: lead.owner_name || lead.business_name || '',
              companyName: lead.business_name || '',
              phone: lead.phone || '',
              tags: ['Enviado'],
              source: 'Empirika AI Outreach',
              customFields: [
                { key: 'industry', value: lead.industry || '' },
                { key: 'metro_area', value: lead.metro_area || '' },
              ],
            }),
          });

          const ghlData = await ghlRes.json();
          ghlContactId = ghlData?.contact?.id || null;
        } catch (ghlErr) {
          console.error('GHL sync error (non-blocking):', ghlErr.message);
        }
      }

      // 4. Update Supabase
      const { error: updateError } = await supabase
        .from('campaign_enriched_data')
        .update({
          approval_status: 'APPROVED',
          outreach_status: 'SENT',
          email_sent_at: new Date().toISOString(),
          email_resend_id: emailId,
          approved_at: new Date().toISOString(),
          ghl_contact_id: ghlContactId,
          ghl_tag: 'Enviado',
        })
        .eq('id', campaignId);

      if (updateError) throw updateError;

      return res.status(200).json({
        success: true,
        status: 'APPROVED',
        emailId,
        ghlContactId,
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
  } catch (err) {
    console.error('approve-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
