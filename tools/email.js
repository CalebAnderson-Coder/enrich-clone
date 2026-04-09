// ============================================================
// tools/email.js — Email sending tools via Resend API
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';

export const sendEmail = new Tool({
  name: 'send_email',
  description: 'Send a single email using the Resend API. Use after content has been approved.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject line' },
      html_body: { type: 'string', description: 'HTML body of the email' },
      from_name: { type: 'string', description: 'Sender display name (optional)' },
    },
    required: ['to', 'subject', 'html_body'],
  },
  fn: async (args) => {
    const { to, subject, html_body, from_name = 'Marketing Agency' } = args;
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    if (!apiKey) {
      console.log(`  📧 [MOCK] Would send email to ${to}: "${subject}"`);
      return JSON.stringify({
        status: 'mock_sent',
        note: 'RESEND_API_KEY not configured. Email was logged but not sent.',
        to, subject,
      });
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${from_name} <${fromEmail}>`,
          to: [to],
          subject,
          html: html_body,
        }),
      });

      const data = await response.json();
      
      if (data.id) {
        return JSON.stringify({ status: 'sent', email_id: data.id, to, subject });
      } else {
        return JSON.stringify({ status: 'error', error: data });
      }
    } catch (err) {
      return `Email failed: ${err.message}`;
    }
  },
});

export const sendBatchEmails = new Tool({
  name: 'send_batch_emails',
  description: 'Send multiple emails in a single batch via Resend API. Max 100 emails per batch.',
  parameters: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        description: 'Array of email objects with to, subject, html_body fields',
        items: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            html_body: { type: 'string' },
          },
        },
      },
    },
    required: ['emails'],
  },
  fn: async (args) => {
    const { emails } = args;
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    if (!apiKey) {
      console.log(`  📧 [MOCK] Would send ${emails.length} emails in batch`);
      return JSON.stringify({ status: 'mock_batch', count: emails.length });
    }

    try {
      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emails: emails.map(e => ({
            from: `Marketing Agency <${fromEmail}>`,
            to: [e.to],
            subject: e.subject,
            html: e.html_body,
          })),
        }),
      });

      const data = await response.json();
      return JSON.stringify({ status: 'batch_sent', data });
    } catch (err) {
      return `Batch send failed: ${err.message}`;
    }
  },
});
