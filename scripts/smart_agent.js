import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class SmartWebsiteAgent {
  constructor() {
    this.apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
    // Aquí pondríamos el cliente de base de datos Supabase o una Queue JSON
    this.demoTemplates = {
      'roofing': `<div class="bg-blue-900 text-white p-10"><h1 class="text-4xl font-bold">{{BUSINESS_NAME}}</h1><p>Serving {{CITY}} with top-tier roofing services.</p><button>Call us: {{PHONE}}</button></div>`,
      'default': `<div><h1>{{BUSINESS_NAME}}</h1><p>We provide the best services in {{CITY}}.</p></div>`
    };
  }

  /**
   * PASO 1: CAPA DE SCRAPING
   * Extrae negocios de Google Maps por Nicho. Reemplaza el paso manual de Outscraper.
   */
  async findProspects(niche, location, maxResults = 5) {
    console.log(`Buscando prospectos de "${niche}" en "${location}" usando APIFY...`);
    const run = await this.apify.actor('compass/google-maps-scraper').call({
      searchStringsArray: [`${niche} in ${location}`],
      maxCrawledPlaces: maxResults,
      language: "en",
    });
    
    const { items } = await this.apify.dataset(run.defaultDatasetId).listItems();
    console.log(`Encontrados ${items.length} negocios.`);
    
    // Filtrar: Negocios sin web
    const filtered = items.filter(lead => !lead.website || lead.website.trim() === '');
    console.log(`De los cuales ${filtered.length} NO TIENEN SITIO WEB! Perfectos prospectos.`);
    
    return filtered;
  }

  /**
   * PASO 2: GENERACIÓN DE SITIOS WEB EN 30 SEGUNDOS (REEMPLAZA GHL SITES)
   * Crea un sitio estático e invoca a Netlify / Supabase Storage para hostearlo y darnos URL.
   */
  async generateDemoWebsite(businessName, city, phone, type = 'default') {
    console.log(`Generando Web Demo en 30s para: ${businessName}`);
    let html = this.demoTemplates[type] || this.demoTemplates['default'];
    
    html = html.replace('{{BUSINESS_NAME}}', businessName || 'Your Business')
               .replace('{{CITY}}', city || 'Your City')
               .replace('{{PHONE}}', phone || 'Call Now');

    // Aquí iría el API call real a Netlify / Vercel para subir el fichero.
    // Para esta prueba, devolvemos una mock URL.
    const mockUrl = `https://${businessName.replace(/\\s+/g, '-').toLowerCase()}-demo.netlify.app`;
    console.log(`✅ Web Desplegada en: ${mockUrl}`);
    return mockUrl;
  }

  /**
   * PASO 3: OUTREACH ENGINE (REEMPLAZA A GHL AUTOMATIONS)
   * Envía el mensaje conectándose a WhatsApp (Evolution API) o Twilio SMS
   */
  async sendOutreachCampaign(prospects) {
    console.log(`\\nIniciando Campaña Outreach para ${prospects.length} leads...`);
    for(const lead of prospects) {
      if(!lead.phone) continue;
      
      const demoUrl = await this.generateDemoWebsite(lead.title, lead.city, lead.phone, 'roofing');
      
      const message = `Hey, soy Carlos. Estaba mirando tu negocio ${lead.title} en Google y vi que no tienen página web. Es un poco random, pero ya me adelanté y les armé una nueva. ¿Quieres que te pase el link para verla? La verdad quedó genial y se vería excelente para sus clientes de ${lead.city}.`;
      
      console.log(`\\n📱 ENVIANDO SMS a ${lead.phone} -> Mensaje armado:\\n"${message}"`);
      // Twilio.messages.create() o axios.post('http://tu-evolution-api/instance/sendText')
    }
  }

  /**
   * RUTINA DIARIA DEL AGENTE
   */
  async executeDailyRoutine() {
    console.log("======================================");
    console.log("🚀 EJECUTANDO SMART WEBSITE AGENT V2");
    console.log("======================================");
    try {
      // 1. Prospectar
      const leads = await this.findProspects('Roofing Contractor', 'Miami, FL', 5);
      
      // 2. Ejecutar embudo (Contacto Masivo + Webs Instantáneas)
      await this.sendOutreachCampaign(leads);
      
      console.log("✅ Rutina Diaria Finalizada.");
    } catch (error) {
      console.error("💥 Error en el agente:", error);
    }
  }
}

// Para ejecutar el agente localmente desde terminal
const currentFileUrl = import.meta.url;
const isMainModule = process.argv[1] && currentFileUrl.includes(process.argv[1].replace(/\\\\/g, '/').split('/').pop());

if (isMainModule) {
  const agent = new SmartWebsiteAgent();
  agent.executeDailyRoutine();
}

export default SmartWebsiteAgent;
