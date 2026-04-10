// ============================================================
// tools/email.js — Email sending tools via Gmail SMTP (José)
// Primary:  Gmail SMTP  →  Jsanchez@empirikagroup.com
// Fallback: Resend API  →  RESEND_API_KEY
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import nodemailer from 'nodemailer';

// ── Build shared SMTP transporter ─────────────────────────────
function buildTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth:   { user, pass: pass.trim() },
    tls:    { rejectUnauthorized: false },
  });
}

const _transporter = buildTransporter();

// ── Core sendMail helper ──────────────────────────────────────
async function sendMail({ to, subject, html_body, from_name }) {
  const smtpUser   = process.env.SMTP_USER;
  const fromAddr   = smtpUser || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const senderName = from_name
    || process.env.SMTP_FROM_NAME
    || 'Ángela · Empírika Digital';
  const fromField  = `"${senderName}" <${fromAddr}>`;

  // Priority 1: Gmail SMTP
  if (_transporter) {
    const info = await _transporter.sendMail({
      from:    fromField,
      to:      [to],
      subject,
      html:    html_body,
    });
    return { status: 'sent', email_id: info.messageId, to, subject, transport: 'smtp' };
  }

  // Priority 2: Resend API
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const res  = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: fromField, to: [to], subject, html: html_body }),
    });
    const data = await res.json();
    if (data.id) {
      return { status: 'sent', email_id: data.id, to, subject, transport: 'resend' };
    }
    return { status: 'error', error: data };
  }

  // Priority 3: MOCK
  console.log(`  📧 [MOCK] Would send email to ${to}: "${subject}"`);
  return {
    status: 'mock_sent',
    note:   'No email transport configured. Email logged but not sent.',
    to, subject,
  };
}

// ── Tool: send_email ──────────────────────────────────────────

export const sendEmail = new Tool({
  name: 'send_email',
  description: 'Send a single personalized email using the agency Gmail SMTP (José Sánchez / Empírika). Use after content has been approved.',
  parameters: {
    type: 'object',
    properties: {
      to:        { type: 'string', description: 'Recipient email address' },
      subject:   { type: 'string', description: 'Email subject line' },
      html_body: { type: 'string', description: 'HTML body of the email' },
      from_name: { type: 'string', description: 'Sender display name (optional, defaults to Ángela · Empírika Digital)' },
    },
    required: ['to', 'subject', 'html_body'],
  },
  fn: async (args) => {
    try {
      const result = await sendMail(args);
      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({ status: 'error', error: err.message });
    }
  },
});

// ── Tool: send_batch_emails ───────────────────────────────────

export const sendBatchEmails = new Tool({
  name: 'send_batch_emails',
  description: 'Send multiple personalized emails via Gmail SMTP. Each email in the batch goes to a different recipient.',
  parameters: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        description: 'Array of email objects with to, subject, html_body fields',
        items: {
          type: 'object',
          properties: {
            to:        { type: 'string' },
            subject:   { type: 'string' },
            html_body: { type: 'string' },
          },
        },
      },
    },
    required: ['emails'],
  },
  fn: async (args) => {
    const { emails } = args;
    const results = [];

    for (const email of emails) {
      try {
        const result = await sendMail(email);
        results.push(result);
        // Throttle: 300ms between sends to avoid Gmail rate limits
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        results.push({ status: 'error', to: email.to, error: err.message });
      }
    }

    const sent   = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;
    return JSON.stringify({ status: 'batch_done', sent, errors, results });
  },
});
