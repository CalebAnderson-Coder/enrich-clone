import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { davinci } from '../agents/davinci.js';
import { renderMagnetEmail } from '../lib/emailRenderer.js';
import nodemailer from 'nodemailer';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function run() {
  console.log('Obteniendo un lead real de Supabase...');
  
  // Try to find a real lead with some info
  const { data: leads, error } = await supabase
    .from('prospects')
    .select('*')
    .limit(5);

  if (error || !leads || leads.length === 0) {
    console.error('Error fetching leads:', error || 'No leads in DB.');
    return;
  }

  // Picking the best lead... maybe one with website or real business name
  const lead = leads.find(l => l.website_url) || leads[0];
  console.log(`Lead Seleccionado: ${lead.business_name} (${lead.website_url || 'sin web'})`);

  const runtime = new AgentRuntime({
    geminiApiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-flash' // using whatever internal is set, or default
  });
  
  runtime.registerAgent(davinci);

  const testEmail = "brian@agentlead.online";
  const types = ['LANDING', 'ADS', 'INSTAGRAM'];

  for (const type of types) {
    console.log(`\n======================================================`);
    console.log(`🤖 Generando Lead Magnet tipo: ${type}`);
    console.log(`======================================================`);

    const promptContext = `
      OBLIGATORIO: Tu objetivo es generar un JSON de Lead Magnet ESTRICTAMENTE del tipo: ${type}.
      Analiza esta empresa y genera el activo visual correspondiente y el copy para Ángela.

      [DATOS DEL PROSPECTO]
      Empresa: ${lead.business_name}
      Website: ${lead.website_url || 'No disponible'}
      Ubicación: ${lead.city || 'Desconocida'}
      Industria: ${lead.industry || 'Desconocida'}
    `;

    try {
      const result = await runtime.run('DaVinci', promptContext);
      
      // Parse the JSON block from the agent response
      let jsonStr = result.response;
      // remove markdown code blocks if any
      jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      
      let magnetData;
      try {
        magnetData = JSON.parse(jsonStr);
      } catch(e) {
        // Find JSON inside text
        const match = result.response.match(/\{[\s\S]*\}/);
        if (match) {
          magnetData = JSON.parse(match[0]);
        } else {
            throw new Error('Agent response was not valid JSON');
        }
      }

      console.log(`✅ Asset URL/Preview: ${magnetData.visual_asset_url || magnetData.stitch_preview_url}`);
      
      // Send the email
      const { subject, html, attachments } = renderMagnetEmail(magnetData, lead);
      
      const info = await transporter.sendMail({
        from: `"Angela de Empírika" <${process.env.SMTP_USER}>`,
        to: process.env.REPORT_TO || testEmail,
        subject: `[PRO REEL - ${type}] ${subject}`,
        html: html,
        attachments: attachments
      });
      console.log(`✅ Mail enviado con éxito para ${type}: ${info.messageId}`);
      
    } catch(err) {
      console.error(`❌ Fallo procesando ${type}:`, err);
    }
  }
}

run();
