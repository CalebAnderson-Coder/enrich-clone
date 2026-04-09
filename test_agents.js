import dotenv from 'dotenv';
dotenv.config();

import { AgentRuntime } from './lib/AgentRuntime.js';
import { manager } from './agents/manager.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { carlos } from './agents/carlos.js';
import { scout } from './agents/scout.js';

const runtime = new AgentRuntime({
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-2.0-flash',
});

runtime.registerAgent(manager);
runtime.registerAgent(scout);
runtime.registerAgent(angela);
runtime.registerAgent(helena);
runtime.registerAgent(sam);
runtime.registerAgent(kai);
runtime.registerAgent(carlos);

const lead = {
  business_name: 'Gonzalez Landscaping',
  industry: 'Landscaping',
  metro_area: 'Miami, FL',
  website: 'https://gonzalezlandscapingFL.com',
  rating: 4.8,
  review_count: 42,
  google_maps_url: 'https://maps.google.com/?q=Gonzalez+Landscaping'
};

const enrichPrompt = `Inicia el Macro-Flujo 2 para este negocio (lead HOT):
- Negocio: ${lead.business_name}
- Industria: ${lead.industry}
- Ciudad: ${lead.metro_area}
- Web: ${lead.website}
- Rating: ${lead.rating} (${lead.review_count} reseñas)
- Google Maps: ${lead.google_maps_url}

INSTRUCCIONES DE DELEGACIÓN ESTRICTA EN ORDEN:
1. Delega a 'Helena', 'Sam' y 'Kai' para hacer una radiografía técnica simulada del lead (SEO, Ads, Redes Sociales en el mercado anglo para este negocio). No es necesario scraping real si falla, asume la radiografía básica de una empresa de paisajismo en Florida.
2. Delega a 'Carlos Empirika' para armar el 'Attack Angle' estratégico enfocado en este dueño hispano operando en USA.
3. Delega a 'Angela' para redactar un Cold Email y un WhatsApp bilingue/espanglish super empatizante, apalancándose en la cultura, para este dueño.
4. Devuélveme todo consolidado en Español.`;

console.log("🚀 Testing agents with Empírika Latino-focus prompts...");
(async () => {
    try {
        const result = await runtime.run('Manager', enrichPrompt, {
            currentAgent: 'Manager',
            brandId: 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
            maxIterations: 30
        });
        console.log("========== RESULTADOS DE EXPERIMENTACIÓN ==========");
        console.log(result.response);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
