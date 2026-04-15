// ============================================================
// index.js — Main Entry Point: Agency Fleet Runtime
// Express server + Agent Runtime + Cron Scheduler + Lead Pipeline
// ============================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { AgentRuntime } from './lib/AgentRuntime.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { manager } from './agents/manager.js';
import { scout } from './agents/scout.js';
import { carlos } from './agents/carlos.js';
import { davinci } from './agents/davinci.js';
import { getPendingJobs, updateJobStatus, getActiveBrands, createJob, getJobById } from './lib/supabase.js';
import { getLeads, getLeadById, updateOutreachStatus, getLeadsStats, updateLeadOutreach } from './tools/database.js';
import { fetchPage } from './tools/webResearch.js';
import { processIdleMagnets } from './lead_magnet_worker.js';
import { startTranscriptionWorker } from './workers/transcription_worker.js';
import { dispatchPendingOutreach } from './outreach_dispatcher.js';


import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 1. Initialize Agent Runtime
// ============================================================
const runtime = new AgentRuntime({
  apiKey: process.env.NVIDIA_API_KEY || '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',
  model: 'meta/llama-3.1-70b-instruct',
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

// Register all agents
runtime.registerAgent(manager);
runtime.registerAgent(scout);   // 🆕 Lead Prospection & Qualification
runtime.registerAgent(angela);
runtime.registerAgent(helena);
runtime.registerAgent(sam);
runtime.registerAgent(kai);
runtime.registerAgent(carlos);
runtime.registerAgent(davinci);

console.log(`🧠 Agent Runtime initialized with ${runtime.agents.size} agents`);
console.log(`   Agents: ${Array.from(runtime.agents.keys()).join(', ')}`);

// ============================================================
// 2. Express Server
// ============================================================
const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3002', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve lead magnet images (assets/landing_niches/) as static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---- Health Check ----
app.get('/health', (req, res) => {
  const agents = Array.from(runtime.agents.keys());
  res.json({
    status: 'ok',
    version: '1.0.0',
    agents,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---- Authentication Middleware for API routes ----
app.use('/api', (req, res, next) => {
  // Allow OPTIONS preflight
  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers.authorization;
  const isAuthorized = authHeader === `Bearer ${process.env.API_SECRET_KEY}`;
  
  if (isAuthorized) {
    return next();
  }

  // Bypasses for public / local dashboard access
  const isLeadPath = req.path.startsWith('/leads/');
  const publicPaths = ['/approve', '/approve-email', '/leads', '/health'];
  
  if (isLeadPath || publicPaths.includes(req.path)) {
    console.log(`✅ [Auth] Bypassing auth for path: ${req.path}`);
    return next();
  }

  console.warn(`🔒 [Auth] Blocked request: ${req.method} ${req.path}`);
  res.status(401).json({ error: 'Unauthorized' });
});

// ---- Agents Endpoint ----
app.get('/api/agents', (req, res) => {
  const agents = Array.from(runtime.agents.entries()).map(([name, agent]) => ({
    name,
    toolCount: agent.tools ? agent.tools.size : 0,
  }));
  res.json({ agents });
});

// ---- Jobs Endpoint ----
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await getPendingJobs();
    res.json({ jobs });
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ error: err.message, jobs: [] });
  }
});

// ---- Chat Endpoint (direct agent interaction) ----
app.post('/api/chat', async (req, res) => {
  const { message, agent = 'Manager', brandId, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  console.log(`\n💬 [Chat] → ${agent}: "${message.slice(0, 80)}..."`);

  try {
    const result = await runtime.run(agent, message, {
      history,
      currentAgent: agent,
      brandId,
    });

    res.json({
      agent: result.agent,
      response: result.response,
      artifacts: result.artifacts,
      iterations: result.iterations,
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Task Dispatch (create a job for an agent) ----
app.post('/api/dispatch', async (req, res) => {
  const { agent, task, brandId } = req.body;

  if (!agent || !task) {
    return res.status(400).json({ error: 'agent and task are required' });
  }

  console.log(`\n📋 [Dispatch] ${agent} ← "${task.slice(0, 80)}..."`);

  try {
    const result = await runtime.run(agent, task, {
      currentAgent: agent,
      brandId,
    });

    res.json(result);
  } catch (err) {
    console.error('Dispatch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Native Agent Integration: Draft Campaign ----
app.post('/api/leads/:id/draft-campaign', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    
    const leadName = lead.business_name || lead.empresa || lead.empresa_nombre || lead.nombre || 'Business Owner';
    const industry = lead.industry || lead.nicho || 'general services';
    const link = lead.website || lead.google_maps_url || lead.url || 'No link';

    console.log(`\n📧 [Native Outreach] Redactando correo con Angela para: ${leadName}`);
    
    // Create the pending job first
    const brandId = process.env.BRAND_ID;
    const job = await createJob(brandId, 'Angela', 'cold_outreach', {
      leadId: lead.id,
      leadName: leadName
    }, 'PENDING');

    const prompt = `Write a high-converting cold email offering AI Marketing / SEO services to ${leadName}. 
They are in the ${industry} industry. 
Their current website/Google maps is: ${link}. 
Draft the email and then call the 'request_human_approval' tool.
CRITICAL: You MUST provide this exactly as the job_id parameter: ${job.id}`;

    const result = await runtime.run('Angela', prompt, {
      currentAgent: 'Angela',
      brandId: brandId
    });
    
    res.json({ success: true, message: 'Draft completely natively generated by Angela!', response: result.response, job });
  } catch (err) {
    console.error('Error drafting lead:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Deep Analysis (AI Strategist) ----
app.post('/api/leads/:id/analyze', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    
    console.log(`\n🧠 [Deep Analysis] Iniciando auditoría estratégica de: ${lead.business_name || lead.empresa || 'Prospecto'}`);
    
    // Add realistic random delay for visual effect in demo if required, but llm time suffices.
    const context = `
      Nombre: ${lead.business_name || lead.empresa || 'Empresa local'}
      Industria: ${lead.industry || lead.nicho || 'General'}
      Web/Maps: ${lead.website || lead.google_maps_url || 'No disponible'}
      Ubicación: ${lead.metro_area || lead.ciudad || 'No disponible'}
    `;

    const prompt = `Contexto del lead: ${context}`;

    const result = await runtime.run('Carlos', prompt, { currentAgent: 'Carlos' });

    let parsedResponse = {};
    try {
      const cleanJsonStr = result.response.replace(/^\`\`\`(json)?/mi, '').replace(/\`\`\`$/m, '').trim();
      parsedResponse = JSON.parse(cleanJsonStr);
    } catch (e) {
       console.log("No se pudo parsear el JSON de la estrategia, fallback aplicado.");
       parsedResponse = {
         attack_angle: "Nuestro Sistema Automatizado de Lead Generation (Scraping + Landings con IA + GoHighLevel) te permitirá escalar captación y cerrar clientes calificados en piloto automático. (Generado automáticamente)",
         copy_suggestion: result.response
       };
    }

    res.json({ success: true, analysis: parsedResponse });
  } catch (err) {
    console.error('Error analyzing lead:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Prospecting System ----
app.post('/api/prospect', async (req, res) => {
  const { metro, niche, limit, autoEnrich } = req.body;
  if (!metro || !niche) {
    return res.status(400).json({ error: 'metro and niche are required' });
  }

  try {
    const brandId = process.env.BRAND_ID || 'default-brand';
    // Create an asynchronous job for prospection
    const task = `Search for maximum ${limit || 20} Latino-owned businesses in the ${niche} niche in ${metro}. Extract their info and use save_lead. Proceed to qualify them.${autoEnrich ? " IMPORTANT: You MUST set the parameter 'auto_enrich' to true when calling save_lead for each lead you find!" : ""}`;
    
    // We start the run async so the UI doesn't hang.
    runtime.run('scout', task, { currentAgent: 'scout', brandId })
      .catch(e => console.error("Error in async scout run:", e));

    res.json({ success: true, message: 'Prospecting started in the background.' });
  } catch (err) {
    console.error('Prospect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Approval Webhook (email link click) ----
app.get('/api/approve', async (req, res) => {
  const { jobId, action } = req.query;

  if (!jobId || !action) {
    return res.status(400).send('Missing jobId or action');
  }

  const validActions = ['approve', 'reject'];
  if (!validActions.includes(action)) {
    return res.status(400).send('Invalid action. Use "approve" or "reject".');
  }

  try {
    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await updateJobStatus(jobId, newStatus);

    console.log(`\n✅ Job ${jobId} → ${newStatus}`);

    // If approved, wake up the agent to continue
    if (action === 'approve') {
      const job = await getJobById(jobId);
      
      // NEW: If the job has structured outreach data, sync it to the lead record
      // This ensures that approvals via "Magic Link" (email) also update the dashboard's lead state.
      if (job && job.payload && job.payload.outreach && job.payload.outreach.lead_id) {
        const { lead_id, subject, body, whatsapp, instagram } = job.payload.outreach;
        console.log(`  📝 [Sync] Syncing approved outreach for Lead ${lead_id}...`);
        await updateLeadOutreach(lead_id, { 
          subject: subject || '', 
          body: body || '', 
          whatsapp: whatsapp || '', 
          instagram: instagram || '' 
        });
        // Optionally mark the lead as "CONTACTED" if it was approved and we assume immediate dispatch
        // Or keep as "PENDING_APPROVAL" if the agent still needs to run the "publish_content" tool.
        // For structured consistency, we mark it as CONTACTED here if it's an outreach job.
        await updateOutreachStatus(lead_id, 'CONTACTED');
      }

      if (job && job.payload && job.payload.reviewsText) {
        console.log(`  🔔 Agent notified: Job ${jobId} approved — waking up Sam to write email...`);
        // Wake up Sam to synthesize the email!
        runtime.run('Sam', 
          `El lead "${job.payload.leadName}" ha sido APROBADO. Escribe un borrador de Cold Email para este lead de remodelación. 
          Debe ser hiper-personalizado basándote en que vimos sus reviews en Google Maps: "${job.payload.reviewsText}".
          Ofrécele regalarle esta Landing Page estandarizada: ${job.payload.landingUrl}.
          IMPORTANTE: Simula que al final haces un envío al sistema interno de Delivery. No espero que envíes el correo de verdad ahora, solo simula el output final.`,
          { currentAgent: 'Sam', brandId: job.brand_id }
        ).then(result => {
           console.log(`  🚀 Email generado por Sam para ${job.payload.leadName}!`);
           updateJobStatus(jobId, 'EXECUTED', { agentResponse: result.response });
        }).catch(err => console.error("Error executing Sam's email gen:", err));
      } else {
        console.log(`  🔔 Job ${jobId} approved.`);
      }
    }

    // Return a nice HTML response
    const emoji = action === 'approve' ? '✅' : '❌';
    const color = action === 'approve' ? '#10b981' : '#ef4444';
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${action === 'approve' ? 'Approved' : 'Rejected'}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #e2e8f0;
          }
          .card {
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid rgba(148, 163, 184, 0.1);
            border-radius: 16px; padding: 48px; text-align: center;
            max-width: 480px; backdrop-filter: blur(20px);
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
          }
          .emoji { font-size: 64px; margin-bottom: 16px; }
          h1 { font-size: 28px; margin-bottom: 8px; color: ${color}; }
          p { color: #94a3b8; font-size: 16px; line-height: 1.6; }
          .job-id { font-family: monospace; color: #60a5fa; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="emoji">${emoji}</div>
          <h1>${action === 'approve' ? 'Approved!' : 'Rejected'}</h1>
          <p>Job <span class="job-id">${jobId}</span> has been ${action === 'approve' ? 'approved' : 'rejected'}.</p>
          <p style="margin-top: 12px;">${action === 'approve' 
            ? 'The marketing agent will now execute and publish the content.' 
            : 'The agent has been notified. You can provide feedback for revision.'}</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Approval error:', err);
    res.status(500).send('Error processing approval');
  }
});

// ---- Dashboard Approve/Reject Outreach (POST from React UI) ----
app.post('/api/approve-email', async (req, res) => {
  const { campaignId, leadId, action, rejectionReason, notes, outreach } = req.body;
  const targetLeadId = leadId || campaignId; // Support both naming variants
  const finalNotes = notes || rejectionReason;

  if (!targetLeadId || !action) {
    return res.status(400).json({ success: false, error: 'leadId (or campaignId) and action are required' });
  }

  const validActions = ['approve', 'reject'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action. Use "approve" or "reject".' });
  }

  console.log(`\n📬 [Dashboard Approve] Lead ${targetLeadId} → ${action.toUpperCase()}`);

  try {
    const newStatus = action === 'approve' ? 'CONTACTED' : 'REJECTED';
    
    // If outreach copy was edited in the modal, persist it first
    if (outreach) {
      console.log(`  📝 Persisting edited outreach copy for ${targetLeadId}`);
      await updateLeadOutreach(targetLeadId, outreach);
    }

    // Update the final status
    const result = await updateOutreachStatus(targetLeadId, newStatus, finalNotes);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    console.log(`  ✅ Lead ${targetLeadId} → ${newStatus}`);
    res.json({ success: true, status: newStatus, lead: result });
  } catch (err) {
    console.error('Approve-email error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ============================================================
// LEAD PIPELINE ENDPOINTS
// ============================================================

// ---- End to End Pipeline (Macro-Flujo Asíncrono) ----
app.post('/api/campaign/pipeline', async (req, res) => {
  const { industry, city } = req.body;

  if (!industry || !city) {
    return res.status(400).json({ error: 'industry and city are required' });
  }

  res.json({ success: true, message: 'Pipeline started in background for first qualified lead.' });

  // Ejecución en segundo plano gobernada por el Agente Manager
  (async () => {
    try {
      console.log(`\n🚀 [Pipeline] Starting Macro-Flow via Manager Agent for ${industry} in ${city}...`);
      
      const managerPrompt = `Por favor, ejecuta un Macro-Flujo de prospectación (El Radar) para el Nicho: "${industry}" en la Ciudad: "${city}".

INSTRUCCIONES PARA TI (Orquestador):
1. Delega al agente 'scout' la tarea de buscar hasta 5 negocios para este nicho en esta ciudad usando scrapeGoogleMaps.
2. Pide a Scout que filtre, califique (HOT, WARM, etc.) y guarde los leads en la base de datos.
3. Cuando Scout regrese con los leads guardados, devuélveme un resumen estructurado indicando cuántos encontró y los mejores perfiles (HOT).

Recuerda: Este flujo es puro volumen y prospección. Solo interactúa con 'scout'. NO analices ni escribas correos todavía.`;

      // Aumentamos maxIterations a 20 para permitir delegación múltiple secuencial
      const result = await runtime.run('Manager', managerPrompt, { currentAgent: 'Manager', maxIterations: 20 });
      
      console.log(`\n✅ [Pipeline] Finalizado Exitosamente!\n\n=== REPORTE FINAL DEL MANAGER ===\n${result.response}\n`);
      
    } catch (err) {
      console.error('Pipeline error:', err);
    }
  })();
});

// ---- Launch Prospection ----
app.post('/api/prospect', async (req, res) => {
  const { metro, niche, limit = 20 } = req.body;

  if (!metro || !niche) {
    return res.status(400).json({ error: 'metro and niche are required (e.g. metro="Miami FL", niche="landscaping")' });
  }

  console.log(`\n🎯 [Prospect] Launching: ${niche} in ${metro} (limit: ${limit})`);

  try {
    const result = await runtime.run('scout',
      `Prospect for ${niche} businesses in ${metro}. Find up to ${limit} leads. Search both English and Spanish terms. Apply all GATE filters and scoring. Save qualified leads to the database. Provide a summary in Spanish.`,
      { currentAgent: 'scout' }
    );

    const { autoEnrich } = req.body;

    res.json({
      success: true,
      metro,
      niche,
      autoEnrich: !!autoEnrich,
      agent: result.agent,
      response: result.response,
      iterations: result.iterations,
    });

    if (autoEnrich) {
      autoEnrichBackgroundLoop(metro, niche);
    }
  } catch (err) {
    console.error('Prospect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Get Leads Stats ----
app.get('/api/leads/stats', async (req, res) => {
  try {
    const stats = await getLeadsStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching leads stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- List Leads (reads from prospects + campaign_enriched_data) ----
app.get('/api/leads', async (req, res) => {
  const { tier, metro, industry, outreach_status } = req.query;
  const limit = parseInt(req.query.limit) || 50;
  const page  = parseInt(req.query.page)  || 1;
  const offset = (page - 1) * limit;

  try {
    // ── Read from real production tables ──────────────────────────────────────
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch prospects
    let pQuery = sb
      .from('prospects')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (metro) pQuery = pQuery.ilike('city', `%${metro}%`);

    const { data: prospects, count: total, error: pError } = await pQuery;
    if (pError) throw pError;

    if (!prospects || prospects.length === 0) {
      return res.json({ total: 0, limit, page, leads: [] });
    }

    // 2. Fetch all campaign data for these prospects in one query
    const ids = prospects.map(p => p.id);
    const { data: campaigns, error: cError } = await sb
      .from('campaign_enriched_data')
      .select('*')
      .in('prospect_id', ids);

    if (cError) console.error('[Leads API] campaign fetch error:', cError.message);

    // 3. Build a map for fast lookup
    const campaignMap = {};
    (campaigns || []).forEach(c => {
      if (!campaignMap[c.prospect_id]) campaignMap[c.prospect_id] = [];
      campaignMap[c.prospect_id].push(c);
    });

    // 4. Load niches for label lookup
    const fs = await import('fs');
    const niches = JSON.parse(fs.default.readFileSync('./niches.json', 'utf8'));
    const nicheMap = {};
    niches.forEach(n => { nicheMap[n.id] = n; });

    // 5. Shape the response to match what the dashboard expects
    const leads = prospects.map(p => {
      const camp = (campaignMap[p.id] || []).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      )[0] || null;

      const nicheRow = nicheMap[p.niche_id] || {};
      const industry  = nicheRow.es || nicheRow.en || `Niche ${p.niche_id}`;
      const rawData   = p.raw_data || {};

      // Smart score: 85 default, or from raw_data if stored there
      const score = rawData.radar_parsed?.qualification_score || 85;

      // Determine tier
      let lead_tier = 'WARM';
      if (score >= 80) lead_tier = 'HOT';
      else if (score < 65) lead_tier = 'COLD';

      // Outreach status from campaign
      const outreachStatus = camp?.outreach_status || camp?.status || 'PENDING';

      // Build MEGA profile compatible structure from campaign_enriched_data
      let mega_profile = null;
      if (camp) {
        // Parse "Subject: ...\n\nBody..." format stored in outreach_copy
        let emailSubject = '';
        let emailBody = camp.outreach_copy || '';
        const subjectMatch = emailBody.match(/^Subject:\s*(.+?)(\n|$)/i);
        if (subjectMatch) {
          emailSubject = subjectMatch[1].trim();
          emailBody = emailBody.replace(/^Subject:\s*.+(\n|$)/i, '').trim();
        }

        mega_profile = {
          situational_summary: camp.radiography_technical || '',
          pain_points:         camp.attack_angle || '',
          sales_strategy:      camp.outreach_copy || '',
          outreach: {
            subject:   emailSubject,
            body:      emailBody,
            whatsapp:  '',
            instagram: '',
          },
        };
      }

      return {
        id:                  p.id,
        business_name:       p.business_name,
        owner_name:          null,
        industry,
        metro_area:          p.city,
        city:                p.city,
        rating:              p.rating || 4.5,
        review_count:        p.reviews_count || p.review_count || 0,
        reviews_count:       p.reviews_count || p.review_count || 0,
        qualification_score: score,
        score:               score,
        lead_tier,
        outreach_status:     outreachStatus,
        has_mega_profile:    !!mega_profile,
        mega_profile,
        phone:               p.phone,
        email:               camp?.email_sent_at ? 'sent' : null,
        website:             p.website,
        google_maps_url:     p.google_maps_url,
        facebook_url:        rawData.radar_parsed?.facebook_url || null,
        instagram_url:       rawData.radar_parsed?.instagram_url || null,
        linkedin_url:        rawData.radar_parsed?.linkedin_url || null,
        lead_magnet_path:    camp?.lead_magnets_data?.path || null,
        lead_magnet_status:  camp?.lead_magnet_status || null,
        campaign_id:         camp?.id || null,
        created_at:          p.created_at,
        campaign_enriched_data: campaignMap[p.id] || [],
        niche_id:            p.niche_id,
      };
    });

    res.json({ total: total || leads.length, limit, page, leads });
  } catch (err) {
    console.error('[Leads API] Error:', err.message);
    // Fallback to legacy getLeads if something fails
    try {
      const { data: fallbackLeads, total: fallbackTotal } = await getLeads({ limit: req.query.limit, page: req.query.page });
      res.json({ total: fallbackTotal, limit, page, leads: fallbackLeads || [] });
    } catch (fallbackErr) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ---- Get Lead Detail (MEGA Profile) ----
app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Enrich Lead (MEGA Profile) ----
app.post('/api/leads/:id/enrich', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    console.log(`\n🔬 [Enrich] Deep profiling: ${lead.business_name}`);

    // Run all specialist agents in sequence for deep analysis
    const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - MEGA Enrichment + Ventas) para este negocio (lead HOT):
- Negocio: ${lead.business_name}
- Industria: ${lead.industry || 'N/A'}
- Ciudad: ${lead.metro_area}
- Web: ${lead.website || 'Sin web'}
- Rating: ${lead.rating} (${lead.review_count} reseñas)
- Google Maps: ${lead.google_maps_url || 'N/A'}

INSTRUCCIONES DE DELEGACIÓN ESTRICTA EN ORDEN:
1. Delega a 'Helena', 'Sam' y 'Kai' para hacer una radiografía técnica del lead (SEO/Velocidad, Ads y Redes Sociales).
2. Con los hallazgos de esos tres agentes, delega a 'Carlos' para armar el 'Attack Angle' estratégico.
3. Con el Angle de Carlos listo, delega a 'Angela' para crear el copy de multi-contacto (Email, WhatsApp, Instagram).
4. Devuélveme todo consolidado en español (Markdown).

MANDATORIO: Al final de tu respuesta, DEBES incluir el bloque JSON con los borradores así:
OUTREACH_JSON_START
{
  "subject": "Email Subject",
  "body": "Email Body HTML",
  "whatsapp": "WhatsApp Msg",
  "instagram": "Instagram/FB DM"
}
OUTREACH_JSON_END`;

    const result = await runtime.run('Manager', enrichPrompt, {
      currentAgent: 'Manager',
      maxIterations: 30
    });

    // ---- Persistencia Estructurada ----
    let parsedOutreach = null;
    const jsonMatch = result.response.match(/OUTREACH_JSON_START([\s\S]*?)OUTREACH_JSON_END/);
    
    if (jsonMatch && jsonMatch[1]) {
      try {
        parsedOutreach = JSON.parse(jsonMatch[1].trim());
        console.log(`📦 [Enrich] Parsed outreach drafts for ${lead.business_name}`);
        
        // Save to DB
        await updateLeadOutreach(lead.id, parsedOutreach, 'PENDING');
      } catch (e) {
        console.error('❌ [Enrich] Failed to parse outreach JSON:', e.message);
      }
    }

    res.json({
      success: true,
      lead_id: lead.id,
      business_name: lead.business_name,
      enrichment: result.response,
      parsed_outreach: parsedOutreach,
      iterations: result.iterations,
    });
  } catch (err) {
    console.error('Enrich error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Regenerate Outreach (Angela) ----
app.post('/api/leads/:id/regenerate-outreach', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    console.log(`\n📬 [Regenerate] Rewriting copy for: ${lead.business_name}`);

    const prompt = `Re-write the outreach messages for this lead. 
    Use the findings in their MEGA profile: ${JSON.stringify(lead.mega_profile || {})}.
    
    Target: ${lead.business_name}
    Industry: ${lead.industry}
    Website: ${lead.website}
    
    INSTRUCTIONS:
    - Focus on a different 'Attack Angle' if possible.
    - Write: 1 Cold Email (Subject + Body), 1 SMS/WhatsApp message, 1 Instagram DM.
    - Respond strictly with a JSON object containing: { "subject": "...", "body": "...", "whatsapp": "...", "instagram": "..." }
    - Use Spanish (warm, professional, Empírika tone).`;

    const result = await runtime.run('Angela', prompt, {
      currentAgent: 'Angela'
    });

    let copy;
    try {
      // Try to parse JSON from Angela
      const jsonMatch = result.response.match(/\{[\s\S]*\}/);
      copy = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.warn('Angela did not return valid JSON, using raw response');
    }

    if (!copy) {
      // Fallback if not JSON
      copy = { body: result.response };
    }

    // Persist to leads.mega_profile.outreach
    await updateLeadOutreach(lead.id, copy);

    // Also sync to campaign_enriched_data so dashboard shows updated content
    try {
      const outreachText = copy.subject 
        ? `Subject: ${copy.subject}\n\n${copy.body || ''}` 
        : (copy.body || result.response);
      
      const { error: syncError } = await supabase
        .from('campaign_enriched_data')
        .update({ 
          outreach_copy: outreachText,
        })
        .eq('prospect_id', lead.id);
      
      if (syncError) console.warn('⚠️ Could not sync to campaign_enriched_data:', syncError.message);
      else console.log(`  ✅ [Sync] campaign_enriched_data updated for ${lead.business_name}`);
    } catch (syncErr) {
      console.warn('⚠️ campaign_enriched_data sync failed:', syncErr.message);
    }

    res.json({
      success: true,
      outreach: copy,
      provider: result.provider || 'unknown',
      fallbackUsed: result.fallbackUsed || false,
    });
  } catch (err) {
    console.error('Regenerate error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/leads/:id/outreach', async (req, res) => {
  const { status, notes, outreachData, outreach } = req.body;
  const targetOutreach = outreachData || outreach;
  const validStatuses = ['PENDING', 'CONTACTED', 'RESPONDED', 'MEETING_SET', 'CLOSED', 'NURTURING', 'DEAD', 'APPROVED', 'REJECTED', 'DRAFT'];

  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    let updated;
    
    // If full outreach data is provided, save it into the mega_profile
    if (targetOutreach) {
      updated = await updateLeadOutreach(req.params.id, targetOutreach, status, notes);
    } else {
      updated = await updateOutreachStatus(req.params.id, status, notes);
    }

    if (!updated) return res.status(404).json({ error: 'Lead not found' });

    console.log(`  📞 [Outreach] ${updated.business_name} updated to ${status}.`);
    res.json({ success: true, lead: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// OUTREACH PIPELINE ENDPOINTS
// ============================================================

/**
 * Full autonomous cycle (Sisyphus):
 * 1. Prospect (Scout)  → finds new leads
 * 2. Magnets (Worker)  → assigns niche screenshots from assets/landing_niches/
 * 3. Dispatch (Angela) → sends personalized emails
 */
app.post('/api/run-cycle', async (req, res) => {
  const {
    metro         = 'Miami FL',
    industry      = 'restaurant',
    prospect_limit = 5,
    skip_prospect  = false,
    skip_email     = false,
  } = req.body;

  // Respond immediately — pipeline runs in background
  res.json({
    success: true,
    message: 'Sisyphus cycle started in background.',
    config: { metro, industry, prospect_limit, skip_prospect, skip_email },
  });

  (async () => {
    console.log(`\n🔄 [RunCycle] ══════════════════════════════`);
    console.log(`   metro=${metro} | industry=${industry}`);
    console.log(`🔄 [RunCycle] ══════════════════════════════\n`);

    // ── Step 1: Prospect ───────────────────────────────────
    if (!skip_prospect) {
      console.log('🎯 [RunCycle] Step 1 — Prospecting...');
      try {
        await runtime.run('scout',
          `Prospect for ${industry} businesses in ${metro}. Find up to ${prospect_limit} leads. Apply all GATE filters and scoring. Save qualified leads to the database.`,
          { currentAgent: 'scout' }
        );
        console.log('✅ [RunCycle] Step 1 done.');
      } catch (e) {
        console.error('❌ [RunCycle] Step 1 failed:', e.message);
      }
    }

    // ── Step 2: Magnets ────────────────────────────────────
    console.log('🎨 [RunCycle] Step 2 — Generating lead magnets (DaVinci)...');
    try {
      await processIdleMagnets();
      console.log('✅ [RunCycle] Step 2 done.');
    } catch (e) {
      console.error('❌ [RunCycle] Step 2 failed:', e.message);
    }


    // ── Step 3: Email dispatch ─────────────────────────────
    if (!skip_email) {
      console.log('📬 [RunCycle] Step 3 — Dispatching outreach emails...');
      try {
        const emailStats = await dispatchPendingOutreach();
        console.log(`✅ [RunCycle] Step 3 done. Sent: ${emailStats.sent}`);
      } catch (e) {
        console.error('❌ [RunCycle] Step 3 failed:', e.message);
      }
    }

    console.log('\n🏁 [RunCycle] Full Sisyphus cycle complete.\n');
  })();
});

// ---- Manual outreach trigger ----
app.post('/api/outreach/dispatch', async (req, res) => {
  try {
    const stats = await dispatchPendingOutreach();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Outreach dispatch error:', err);
    res.status(500).json({ error: err.message });
  }
});



// ============================================================
// 3. CRON Scheduler — Autonomous task wakeup
// ============================================================

// Every hour: check for approved jobs and execute them
cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ [Cron] Checking for approved jobs...');
  
  try {
    const jobs = await getPendingJobs();
    const approvedJobs = jobs.filter(j => j.status === 'APPROVED');

    if (approvedJobs.length === 0) {
      console.log('  📭 No approved jobs to process.');
      return;
    }

    for (const job of approvedJobs) {
      console.log(`  🔄 Processing approved job: ${job.id} (${job.task_type})`);

      try {
        const result = await runtime.run(
          job.agent_name || 'Manager',
          `Job ${job.id} has been approved by the human. Execute the task: ${JSON.stringify(job.payload)}`,
          { currentAgent: job.agent_name, brandId: job.brand_id }
        );

        await updateJobStatus(job.id, 'EXECUTED', { agentResponse: result.response });
        console.log(`  ✅ Job ${job.id} executed successfully.`);
      } catch (err) {
        console.error(`  ❌ Job ${job.id} failed:`, err.message);
        await updateJobStatus(job.id, 'FAILED', { error: err.message });
      }
    }
  } catch (err) {
    console.error('Cron error:', err);
  }
});

// Every day at 9am: generate daily tasks for active brands
cron.schedule('0 9 * * *', async () => {
  console.log('\n🌅 [Daily] Generating daily marketing tasks...');

  const brands = await getActiveBrands();
  
  for (const brand of brands) {
    console.log(`  📋 Scheduling tasks for: ${brand.name}`);
    
    // Ask the Manager to plan the day's work
    try {
      await runtime.run('Manager', 
        `It's a new day. Review the brand "${brand.name}" (ID: ${brand.id}) and determine what marketing tasks should be done today. Consider: pending social posts, email sequences, content calendar, and any scheduled campaigns.`,
        { currentAgent: 'Manager', brandId: brand.id }
      );
    } catch (err) {
      console.error(`  ❌ Daily planning failed for ${brand.name}:`, err.message);
    }
  }
});

// Loop for independent background workers
console.log('\n⚙️ [Workers] Launching background workers...');

// Magnet generator — every 30s
setInterval(async () => {
  try { await processIdleMagnets(); }
  catch (e) { console.error('Interval error (magnets):', e.message); }
}, 30_000);



// Outreach dispatcher — every 15 minutes
setInterval(async () => {
  try { await dispatchPendingOutreach(); }
  catch (e) { console.error('Interval error (outreach):', e.message); }
}, 15 * 60_000);

startTranscriptionWorker();

// ============================================================
// 4. Serve Frontend & Start Server
// ============================================================
// Serve static built files from the dashboard
app.use(express.static(path.join(__dirname, 'dashboard/dist')));

// Fallback all other non-API routes to React's index.html
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'dashboard/dist/index.html'));
});

app.listen(port, () => {
  console.log(`\n${'═'.repeat(56)}`);
  console.log(`🤖 AGENCY — AI Marketing Fleet`);
  console.log(`${'─'.repeat(56)}`);
  console.log(`🌐 Server:     http://localhost:${port}`);
  console.log(`❤️  Health:     http://localhost:${port}/health`);
  console.log(`💬 Chat:       POST http://localhost:${port}/api/chat`);
  console.log(`📋 Dispatch:   POST http://localhost:${port}/api/dispatch`);
  console.log(`👥 Agents:     GET  http://localhost:${port}/api/agents`);
  console.log(`📊 Jobs:       GET  http://localhost:${port}/api/jobs`);
  console.log(`${'─'.repeat(56)}`);
  console.log(`🎯 Prospect:   POST http://localhost:${port}/api/prospect`);
  console.log(`📋 Leads:      GET  http://localhost:${port}/api/leads`);
  console.log(`📋 Lead:       GET  http://localhost:${port}/api/leads/:id`);
  console.log(`🔬 Enrich:     POST http://localhost:${port}/api/leads/:id/enrich`);
  console.log(`📞 Outreach:   POST http://localhost:${port}/api/leads/:id/outreach`);
  console.log(`${'─'.repeat(56)}`);
  console.log(`🔄 PIPELINE:   POST http://localhost:${port}/api/run-cycle`);
  console.log(`📬 Dispatch:   POST http://localhost:${port}/api/outreach/dispatch`);

  console.log(`${'─'.repeat(56)}`);
  console.log(`⏰ Crons: Hourly jobs + Daily 9am + Outreach 15min`);
  console.log(`${'═'.repeat(56)}\n`);
});

// ============================================================
// AUTO ENRICHMENT BACKGROUND LOOP
// ============================================================

async function autoEnrichBackgroundLoop(metro, niche) {
  console.log(`\n🤖 [Auto-Enrich] INICIANDO AUTOMATIZACIÓN EXTREMA: Esperando 5s a que Scout asiente DB...`);
  
  try {
    // Dar unos segundos para garantizar inserción
    await new Promise(r => setTimeout(r, 5000));

    // Obtener la data actual
    const { data: leads } = await getLeads({ limit: 100, metro, industry: niche });
    
    // Filtrar los que no tienen el mega profile o están en status nulo/vacio
    const pendingLeads = (leads || []).filter(l => !l.mega_profile && (!l.outreach_status || l.outreach_status === ''));

    console.log(`\n🤖 [Auto-Enrich] Encontrados ${pendingLeads.length} leads de ${niche} en ${metro} para procesar secuencialmente.`);

    for (let i = 0; i < pendingLeads.length; i++) {
      const lead = pendingLeads[i];
      console.log(`\n=============================================================`);
      console.log(`⏳ [Auto-Enrich] Procesando Lead [${i+1}/${pendingLeads.length}]: ${lead.business_name} (${lead.id})`);
      console.log(`=============================================================`);
      
      try {
        // --- 1. ENRICHMENT (MEGA PROFILE) ---
        const enrichPrompt = `Inicia el Macro-Flujo 2 (El Francotirador - MEGA Enrichment) para este negocio (lead HOT):
- Negocio: ${lead.business_name}
- Industria: ${lead.industry || 'N/A'}
- Ciudad: ${lead.metro_area || 'N/A'}
- Web: ${lead.website || 'Sin web'}

DELEGACIÓN:
1. Delega a 'Helena', 'Sam' y 'Kai' para analizar el negocio, debilidades SEO/Ads y extraer dolores.
2. Delega a 'Carlos' para armar el 'Attack Angle'.
3. OBLIGATORIO: Usa la herramienta update_mega_profile para guardar todos estos hallazgos consolidados en la Base de Datos.
4. Devuélveme a mí (el usuario) el reporte final.`;

        await runtime.run('Manager', enrichPrompt, {
          currentAgent: 'Manager',
          maxIterations: 20
        });

        console.log(`\n✅ [Auto-Enrich] Perfil Mega actualizado para ${lead.business_name}.`);

        // --- 2. COMPOSE EMAIL DRAFT (ANGELA) ---
        console.log(`\n✉️ [Auto-Enrich] Pasando información a Angela para redactar Outbound Draft...`);
        const angelaPrompt = `El prospecto con ID ${lead.id} ha sido analizado. Escribe su correo de prospección.
Business: ${lead.business_name}
Industry: ${lead.industry}
Website: ${lead.website}

Genera un HTML con el Asunto (Subject) en una línea H3 y el cuerpo del correo. Luego DEBES USAR LA HERRAMIENTA update_lead_outreach para guardar el HTML generado en el lead con status DRAFT.
Al hacerlo, usa el argumento lead_id: "${lead.id}" y en html_content el contenido redactado.`;

        await runtime.run('Angela', angelaPrompt, {
          currentAgent: 'Angela',
          maxIterations: 8
        });

        console.log(`✅ [Auto-Enrich] Email guardado en estado DRAFT para: ${lead.business_name}`);
        
        // Esperemos un poco entre calls a LLM para evitar Rate Limits drásticos
        await new Promise(r => setTimeout(r, 4000));

      } catch (err) {
        console.error(`❌ [Auto-Enrich-Failed] Error con lead ${lead.business_name}:`, err);
      }
    }
    
    console.log(`\n🎉 [Auto-Enrich] CICLO DE ${pendingLeads.length} LEADS COMPLETADO EXITOSAMENTE.`);
    
  } catch (err) {
    console.error(`❌ [Auto-Enrich-Critical] Loop colapsó:`, err);
  }
}

export { runtime, app };
