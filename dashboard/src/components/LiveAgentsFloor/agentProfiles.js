// Human-readable profiles for the 9 Empírika AI Fleet agents.
// Tool lists mirror the actual `tools: [...]` arrays in agents/*.js as of 2026-04-17.

export const AGENT_PROFILES = {
  manager: {
    summary: 'Orquestador de la flota. Decide qué campañas correr, delega a agentes especializados y mantiene el pulso del pipeline de Empírika.',
    responsibilities: [
      'Lee el estado del pipeline (leads HOT/WARM/COOL) y prioriza el día.',
      'Crea jobs de marketing y los asigna a Scout, Helena, Ángela, Sam o Kai.',
      'Corre ciclos diarios 8/12/18/23 UTC: prospección, revisión, despacho, reporte.',
    ],
    tools: [
      { name: 'create_marketing_job', desc: 'Crea un job de marketing y lo encola para un agente.' },
      { name: 'get_leads_pipeline',   desc: 'Lee el estado de leads filtrando por tier/status/ciudad.' },
      { name: 'get_leads_pipeline_stats', desc: 'Conteos agregados (HOT/WARM/SENT/DRAFT, etc.).' },
      { name: 'read_brand_profile',   desc: 'ICP + positioning de Empírika guardado en DB.' },
      { name: 'save_memory / recall_memory', desc: 'Aprendizaje persistente entre ciclos.' },
    ],
  },
  scout: {
    summary: 'Prospectador de negocios latino-owned en USA. Escanea Google Maps, aplica gates ICP (reviews 20–300, rating 4.0+, Latino-owned) y guarda los que califican.',
    responsibilities: [
      'Extrae negocios reales de Google Maps vía Apify (review_count, rating, phone, website).',
      'Aplica hard-gate Latino-owned — apellido hispano, dueño latino, señales de categorías.',
      'Guarda leads con tier HOT/WARM/COOL/COLD según scoring del ICP.',
    ],
    tools: [
      { name: 'scrape_google_maps', desc: 'Apify compass/crawler-google-places — fuente principal.' },
      { name: 'search_web',         desc: 'DuckDuckGo/Gemini como fallback si Maps devuelve <5.' },
      { name: 'check_instagram',    desc: 'BrightData — handle, seguidores, engagement.' },
      { name: 'check_meta_ads',     desc: 'Verifica si corre ads activos en Meta Ad Library.' },
      { name: 'fetch_webpage',      desc: 'Lee HTML/texto de la web del negocio.' },
      { name: 'check_pagespeed',    desc: 'Google PageSpeed — score de calidad web.' },
      { name: 'save_lead',          desc: 'Persiste el lead calificado con brand_id Empírika.' },
      { name: 'save_memory / recall_memory', desc: 'Aprende qué nichos/ciudades rinden.' },
    ],
  },
  helena: {
    summary: 'Enriquecedora. Toma un lead crudo y genera un mega-perfil: propuesta de valor, dolores específicos, ángulos de venta, radar competitivo.',
    responsibilities: [
      'Profundiza en el website del lead con Firecrawl para extraer voice + servicios.',
      'Corre diagnóstico SEO + PageSpeed como munición para Ángela.',
      'Persiste el mega_profile en la DB para que Ángela escriba con contexto real.',
    ],
    tools: [
      { name: 'search_web',          desc: 'Research contextual del nicho y la ciudad.' },
      { name: 'fetch_webpage',       desc: 'Firecrawl con JS-rendered fallback.' },
      { name: 'check_pagespeed',     desc: 'Detecta oportunidades técnicas concretas.' },
      { name: 'request_approval',    desc: 'Pide luz verde para publicar artefactos premium.' },
      { name: 'publish_content',     desc: 'Publica el mega-perfil al sistema.' },
      { name: 'read_brand_profile',  desc: 'Lee el ICP + genoma de Empírika.' },
      { name: 'save_memory / recall_memory', desc: 'Memoria de patrones enriquecimiento.' },
    ],
  },
  angela: {
    summary: 'Copywriter outreach. Escribe secuencias de 3 emails (Observación → Prueba → Ask) 100% en español con tono Empírika. Nunca en inglés.',
    responsibilities: [
      'Genera subject + body + preview_text cumpliendo char limits por plataforma.',
      'Secuencia de 3 touches con timing día 0/3/4.',
      'Emite SPIN call_script para leads sin email (Path A phone/WhatsApp).',
    ],
    tools: [
      { name: 'send_email',          desc: 'Envío individual vía SMTP.' },
      { name: 'send_batch_emails',   desc: 'Envíos en batch a leads aprobados.' },
      { name: 'request_approval',    desc: 'Gate humano antes de enviar outbound masivo.' },
      { name: 'publish_content',     desc: 'Publica drafts al CMS / dashboard.' },
      { name: 'read_brand_profile',  desc: 'Lee tono, IRON RULE español, firma Ángela.' },
      { name: 'save_memory / recall_memory', desc: 'Aprende qué ángulos convierten.' },
    ],
  },
  sam: {
    summary: 'Social & paid strategist. Planifica posts orgánicos, campañas Meta/Google Ads y calendarios editoriales respetando char-limits por plataforma.',
    responsibilities: [
      'Produce copy de social ads con CTA claros y UTM coherentes.',
      'Calendario semanal multi-plataforma (IG, FB, LinkedIn).',
      'Audit competitivo rápido antes de proponer estrategia.',
    ],
    tools: [
      { name: 'search_web',          desc: 'Competitive intel + trending topics.' },
      { name: 'request_approval',    desc: 'Gate humano para activar campañas pagas.' },
      { name: 'publish_content',     desc: 'Publica posts/ad creative al dashboard.' },
      { name: 'read_brand_profile',  desc: 'Voice, colores, disqualifiers Empírika.' },
      { name: 'save_memory / recall_memory', desc: 'Memoria de qué hooks funcionan.' },
    ],
  },
  kai: {
    summary: 'Content creator. Genera posts self-contained (carruseles, blog seeds, hooks de video) listos para publicación sin edición humana.',
    responsibilities: [
      'Invariant: cada post es auto-contenido (no depende de contexto externo).',
      'Research + drafting en un solo flow.',
      'Respeta tono y lineamientos del brand profile.',
    ],
    tools: [
      { name: 'search_web',          desc: 'Research para sustentar claims.' },
      { name: 'request_approval',    desc: 'Draft → approval → publish.' },
      { name: 'publish_content',     desc: 'Post final al sistema.' },
      { name: 'read_brand_profile',  desc: 'Alinea con voice + ICP.' },
      { name: 'save_memory / recall_memory', desc: 'Memoria de ángulos que engagean.' },
    ],
  },
  carlos: {
    summary: 'Enlace con Empírika. Guarda y recuerda el conocimiento del cliente (qué vende, qué NO vende, preferencias, gotchas) para que el resto de la flota alinee.',
    responsibilities: [
      'Curaduría del knowledge base de Empírika (filosofía, genoma, walkthrough).',
      'Lee Instagram del cliente para extraer tono/voice real.',
      'Sirve como fuente de verdad cuando otro agente tiene dudas del brand.',
    ],
    tools: [
      { name: 'recall_carlos_knowledge', desc: 'Lee knowledge base de Empírika (ICP, genoma).' },
      { name: 'seed_carlos_knowledge',   desc: 'Actualiza/versiona el knowledge del cliente.' },
      { name: 'scrape_client_instagram', desc: 'Scrapea IG de Empírika para voice reference.' },
      { name: 'recall_client_knowledge', desc: 'Datos de clientes de Empírika (leads enriquecidos).' },
      { name: 'save_memory / recall_memory', desc: 'Memoria cross-ciclo.' },
    ],
  },
  davinci: {
    summary: 'Diseñador visual. Genera mockups 2K con Gemini Imagen 4.0 para ad campaigns (Meta/Google) e Instagram feed optimization.',
    responsibilities: [
      'Prompt engineering estricto: composición, paleta hex, tipografía, luz, textura.',
      'Copy en español integrado al visual (headlines + CTA).',
      'Minimum 100-word prompts — nada de "nice/good/beautiful".',
    ],
    tools: [
      { name: 'generate_gemini_imagen_visual', desc: 'Gemini Imagen 4.0 — mockup 2K PNG real para ads o IG.' },
    ],
  },
  verifier: {
    summary: 'Gate de calidad. Evalúa cada draft outbound con una rúbrica de 5 dimensiones y bloquea lo que no cumple el estándar Empírika.',
    responsibilities: [
      'Rubric 5-dim: claridad, tono, personalización, CTA, riesgo.',
      'Max 2 retries antes de marcar BLOCKED_LOW_QUALITY.',
      'No tiene tools externas — es juicio puro del LLM contra un schema Zod.',
    ],
    tools: [
      { name: '—', desc: 'Sin tools externas. Recibe el draft + contexto y emite verifier_report JSON validado.' },
    ],
  },
};

export function getAgentProfile(id) {
  return AGENT_PROFILES[id] || {
    summary: 'Agente sin perfil documentado.',
    responsibilities: [],
    tools: [],
  };
}
