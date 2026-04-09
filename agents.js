import { Agent, Swarm } from '@swarmclawai/swarmclaw';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
export const swarm = new Swarm(client);

// ==========================================
// TOOLS FOR AGENTS
// ==========================================
function sendApprovalRequest(contextVariables) {
    const { job_id, draft, type } = contextVariables;
    console.log(`\n📧 [SYSTEM] Mocking Email to Human for Job ${job_id}:\n"Hello! Angela has drafted this ${type}:\n\n${draft}\n\nClick to approve: http://localhost:3000/api/approve?jobId=${job_id}&action=approve"`);
    return "Approval request was sent successfully to the human. Await their response.";
}

function publishMaterial(contextVariables) {
    const { job_id, channels } = contextVariables;
    console.log(`\n🚀 [SYSTEM] Executing actual publication for Job ${job_id} across ${channels}.`);
    return "Material successfully published.";
}

// ==========================================
// AGENT DEFINITIONS
// ==========================================
export const angelaAgent = new Agent({
    name: "Angela (Email Marketer)",
    instructions: `You are Angela, an expert autonomous AI Email Marketer for Enrich Labs.
    Your job is to read instructions, draft high-converting email copy, and then ALWAYS ask the human for approval.
    If you receive instructions to draft an email, draft it, then call the sendApprovalRequest tool.
    Once the human approves, you will be woken up again and you should call publishMaterial.`,
    functions: [sendApprovalRequest, publishMaterial],
});

export const helenaAgent = new Agent({
    name: "Helena (SEO & Ads)",
    instructions: `You are Helena, an expert autonomous AI Digital Marketer.
    You specialize in writing blog posts, researching keywords, and configuring Ads.`,
    functions: [sendApprovalRequest, publishMaterial],
});

export const managerAgent = new Agent({
    name: "Agency Manager",
    instructions: `You are the Agency Manager. You route tasks to the specific specialists (Angela for Email, Helena for SEO/Ads).`,
});
