import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
dotenv.config();

// Inicializamos la App de FireCrawl con tu API Key
const apiKey = process.env.FIRECRAWL_API_KEY;
const app = apiKey ? new FirecrawlApp({ apiKey: apiKey }) : null;

/**
 * FireCrawl Module (PRODUCCIÓN)
 * Llama a la API oficial pasándole tu token.
 */
export const firecrawlEngine = {
  async searchProspects(niche, location) {
    if (!app) {
      console.warn(`[FIRECRAWL] ⚠️ No se detectó FIRECRAWL_API_KEY en el .env.`);
      return null;
    }

    // Buscamos directamente "Empresas en Miami" ignorando páginas genéricas
    const prompt = `${niche} local businesses in ${location} -site:yelp.com -site:bbb.org -site:angi.com`;
    console.log(`[FIRECRAWL] Pidiendo a FireCrawl buscar: "${prompt}"...`);

    try {
      // Firecrawl permite realizar búsquedas en Google nativamente con `/search`
      // y opcionalmente extraer los datos estructurados en el mismo paso.
      const searchResult = await app.search(prompt, {
        limit: 10,  // Cuántos prospectos analizar de un golpe
        scrapeOptions: { formats: ['markdown'] } // Queremos la info lista para la IA
      });

      if (!searchResult.success) {
        console.error(`[FIRECRAWL] Fallo en la búsqueda:`, searchResult.error);
        return [];
      }

      console.log(`[FIRECRAWL] ¡Extracción exitosa cruzando ${searchResult.data.length} webs!`);

      // Filtramos prospectos a los que Firecrawl detectó que no tienen contenido útil
      // o que directamente no tenían un enlace HTTPS de una empresa real.
      const rawLeads = searchResult.data.map(lead => ({
        business_name: lead.title,
        industry: niche,
        city: location,
        phone: process.env.TWILIO_PHONE_NUMBER || "+10000000000", 
        email_address: process.env.SMTP_USER, // Para fines de testing envíalo a tu propio mail
        original_website: lead.url,
        firecrawl_markdown: lead.markdown
      }));

      // A simple vista, si el markdown devuelto es muy deficiente (ej. < 100 caracteres), la web es mala.
      const leadsAdapted = rawLeads.filter(
        l => !l.original_website || !l.firecrawl_markdown || l.firecrawl_markdown.length < 500
      );

      console.log(`[FIRECRAWL] Se detectaron ${leadsAdapted.length} empresas con webs muy deficientes o rotas. Listas para el Outreach.`);
      return leadsAdapted;

    } catch (error) {
      console.error(`[FIRECRAWL] Error de Red conectando a FireCrawl:`, error.message);
      return [];
    }
  }
};
