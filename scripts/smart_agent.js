import dotenv from 'dotenv';
dotenv.config();

// Módulos especializados de la Agencia
import { db } from './db.js';
import { brightdata } from './brightdata.js';
import { stitchEngine } from './stitch.js';
import { emailEngine } from './email.js';

class SmartWebsiteAgent {
  constructor() {
    this.niche = 'Roofing Contractor';
    this.location = 'Miami, FL';
    console.log('[AGENT] 🤖 Inicializando SMART ORCHESTRATOR V2...');
  }

  async executeDailyRoutine() {
    console.log("=================================================");
    console.log("       INICIANDO CAMPAÑA DE PROSPECCIÓN          ");
    console.log("=================================================");
    try {
      const leads = await brightdata.searchProspects(this.niche, this.location);
      
      if (!leads || leads.length === 0) {
        console.log('[AGENT] No se encontraron leads con sitios caídos hoy.');
        return;
      }

      // 2. Insertar Leads Iniciales en el CRM Supabase Code-First
      console.log(`\\n[DB CRM] Guardando ${leads.length} nuevos leads descubiertos en Supabase (smart_agency_leads)...`);
      const insertedLeads = await db.insertLeads(leads);
      if (!insertedLeads) throw new Error("Fallo guardando datos en DB CRM");

      // 3. Loop de Acción (Generación Visual + Envío SMS)
      for(const leadRow of insertedLeads) {
        console.log(`\\n-------------------------------------------------`);
        console.log(`Procesando Lead UUID: ${leadRow.id} | ${leadRow.business_name}`);
        
        // 3a. Generar UI vía Stitch MCP
        const demoUrl = await stitchEngine.generateResponsiveSite(
          leadRow.business_name,
          leadRow.city,
          leadRow.industry,
          leadRow.phone
        );

        // 3b. Actualizar Stage del Pipeline en CRM
        await db.updatePipelineStage(leadRow.id, 'DEMO_GENERATED', demoUrl);

        // 3c. Disparar Email de Outreach con propuesta visual
        const emailRes = await emailEngine.sendEmail(leadRow, demoUrl);

        // 3d. Finalizar Stage de Outreach Integrado
        await db.updateEmailOutreachStatus(leadRow.id, emailRes.status, emailRes.messageId);
        await db.updatePipelineStage(leadRow.id, 'EMAIL_SENT');
        
        console.log(`✅ Lead Finalizado en Status 'EMAIL_SENT'`);
      }
      
      console.log("\\n=================================================");
      console.log("✅ Pipeline Total Finalizado. Agente volviendo a sleep.");
      console.log("=================================================");
    } catch (error) {
      console.error("💥 Error Crítico en orquestador:", error);
    }
  }
}

// Para ejecutar el agente localmente desde terminal
const isMainModule = process.argv[1] && process.argv[1].endsWith('smart_agent.js');

if (isMainModule) {
  const agent = new SmartWebsiteAgent();
  agent.executeDailyRoutine();
}

export default SmartWebsiteAgent;
