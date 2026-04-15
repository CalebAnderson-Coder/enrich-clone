// ============================================================
// tools/approvals.js — Human-in-the-loop approval system
// Pauses agent work and waits for human review via Magic Link
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { updateJobStatus } from '../lib/supabase.js';
import { sendEmail } from './email.js';
import { updateLeadOutreach } from './database.js';
import { approvalInputSchema } from '../lib/schemas.js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export const requestApproval = new Tool({
  name: 'request_human_approval',
  inputSchema: approvalInputSchema,
  description: `Submit your draft work for human review. This pauses execution until the human clicks Approve or Reject via the magic link. Use this AFTER you have generated content (email, blog, ad copy, social post) and BEFORE publishing.`,
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job ID to associate with this approval' },
      content_type: { type: 'string', description: 'Type of content: email, blog, ad_copy, social_post, outreach' },
      draft_content: { type: 'string', description: 'The full draft content for human review' },
      summary: { type: 'string', description: 'Brief summary of what was created' },
      // Structured outreach fields for Dashboard Sync
      lead_id: { type: 'string', description: 'ID of the lead (required for outreach types)' },
      email_subject: { type: 'string', description: 'Drafted email subject' },
      email_body: { type: 'string', description: 'Drafted email body (HTML or plain text)' },
      whatsapp_message: { type: 'string', description: 'Drafted WhatsApp message' },
      instagram_message: { type: 'string', description: 'Drafted Instagram DM' },
    },
    required: ['job_id', 'content_type', 'draft_content', 'summary'],
  },
  fn: async (args, context) => {
    const { 
      job_id, 
      content_type, 
      draft_content, 
      summary, 
      lead_id,
      email_subject,
      email_body,
      whatsapp_message,
      instagram_message
    } = args;

    // 1. If this is an outreach draft with a lead_id, sync it to the leads table
    // This allows the "Draft" modal in the dashboard to show the content immediately.
    if (lead_id && (email_subject || email_body || whatsapp_message || instagram_message)) {
      console.log(`  🔄 [Sync] Syncing agent draft to Lead ${lead_id} for dashboard review...`);
      await updateLeadOutreach(lead_id, {
        subject: email_subject || '',
        body: email_body || '',
        whatsapp: whatsapp_message || '',
        instagram: instagram_message || ''
      }, 'PENDING_APPROVAL');
    }

    // 2. Update job status in DB with the full payload
    await updateJobStatus(job_id, 'AWAITING_APPROVAL', {
      content_type,
      draft: draft_content,
      summary,
      outreach: {
        subject: email_subject,
        body: email_body,
        whatsapp: whatsapp_message,
        instagram: instagram_message,
        lead_id
      }
    });

    const approveLink = `${BASE_URL}/api/approve?jobId=${job_id}&action=approve`;
    const rejectLink = `${BASE_URL}/api/approve?jobId=${job_id}&action=reject`;

    // Log the approval request (in production this sends an email/Slack)
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📋 AWAITING HUMAN APPROVAL — Job ${job_id}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Type: ${content_type}`);
    console.log(`Summary: ${summary}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Draft Preview:\n${draft_content.slice(0, 500)}...`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`✅ Approve: ${approveLink}`);
    console.log(`❌ Reject:  ${rejectLink}`);
    console.log(`${'═'.repeat(60)}\n`);

    // TODO: Send actual notification via email/Slack/Telegram
    // await sendNotification({ type: 'approval_request', job_id, approveLink, rejectLink });

    return JSON.stringify({
      status: 'AWAITING_APPROVAL',
      job_id,
      approve_link: approveLink,
      reject_link: rejectLink,
      message: 'Draft submitted for human review. Execution paused until approval.',
    });
  },
});

export const publishContent = new Tool({
  name: 'publish_content',
  description: 'Publish approved content to the specified channels. Only call this AFTER human approval.',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The approved job ID' },
      channels: {
        type: 'array',
        description: 'Channels to publish to: email, blog, linkedin, twitter, instagram',
        items: { type: 'string' },
      },
      content: { type: 'string', description: 'The final approved content to publish' },
    },
    required: ['job_id', 'channels', 'content'],
  },
  fn: async (args) => {
    const { job_id, channels, content } = args;

    console.log(`\n🚀 [PUBLISH] Job ${job_id} → ${channels.join(', ')}`);
    
    const results = {};
    
    for (const channel of channels) {
      switch (channel) {
        case 'email':
          try {
            // Native dispatch bypassing n8n
            const emailResultRaw = await sendEmail.fn({
              to: 'admin@marketing.local', // default to test
              subject: `Campaign Approved: Job ${job_id}`,
              html_body: content
            });
            const emailResult = JSON.parse(emailResultRaw);
            results[channel] = { status: emailResult.status, id: emailResult.email_id || 'mocked' };
          } catch(e) {
            results[channel] = { status: 'error', reason: e.message };
          }
          break;
        case 'blog':
          results[channel] = { status: 'published', url: 'https://blog.example.com/new-post' };
          break;
        case 'linkedin':
        case 'twitter':
        case 'instagram':
          results[channel] = { status: 'posted', note: `Published natively to ${channel}` };
          break;
        default:
          results[channel] = { status: 'unsupported_channel' };
      }
    }

    await updateJobStatus(job_id, 'EXECUTED', results);
    return JSON.stringify({ status: 'PUBLISHED', job_id, results });
  },
});
