import { db } from './db.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Agent Tools Hub
 * Estas son las herramientas (Functions) que se enrutan a Groq/Gemini.
 * Cuando el prospecto contesta al SMS de Twilio, el Agente evalúa el mensaje
 * y puede disparar estas funciones de forma autónoma.
 */
export const AgentTools = {
  
  /**
   * Genera y devuelve un link de pago único de Stripe para el valor exacto ($297 USD).
   */
  generateCheckoutLink: {
    description: "Generates a $297 USD checkout link when the prospect is ready to buy the website.",
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The UUID of the lead in the database." },
      },
      required: ["leadId"]
    },
    execute: async ({ leadId }) => {
      console.log(`[AGENT TOOL] Ejecutando generateCheckoutLink para lead: ${leadId}...`);
      // Lógica a la API de Stripe
      // const session = await stripe.checkout.sessions.create({ line_items: [{ price: 'price_297', quantity: 1 }]})
      
      const sessionUrl = `https://checkout.stripe.com/pay/cs_test_mock_${leadId.substring(0,6)}_297usd`;
      
      // Guardar status de facturación en el CRM
      await db.updatePipelineStage(leadId, 'NEGOTIATION');
      
      return `Link de cobro de $297 generado: ${sessionUrl}`;
    }
  },

  /**
   * Permite al agente consultar si el sitio demo del cliente ya está fabricado o en qué estado está,
   * en caso de que el prospecto pregunte "¿Dónde puedo ver el demo que hicieron?".
   */
  getDemoUrl: {
    description: "Fetches the previously generated Demo Website URL for the prospect.",
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The UUID of the prospect." }
      },
      required: ["leadId"]
    },
    execute: async ({ leadId }) => {
      console.log(`[AGENT TOOL] Ejecutando getDemoUrl para leer la DB...`);
      // Retornar datos mock en base a arquitectura:
      return "https://demo-stitch-roofing.netlify.app"; 
    }
  },

  /**
   * Agendar directamente la implementación
   */
  bookImplementationMeeting: {
    description: "Books a 15 min onboarding call over Calendly after payment or if requested.",
    parameters: {
      type: "object",
      properties: {
        leadName: { type: "string", description: "The name of the business owner." },
        timePrefix: { type: "string", description: "AM or PM preference." }
      },
      required: ["leadName"]
    },
    execute: async ({ leadName, timePrefix }) => {
      console.log(`[AGENT TOOL] Ejecutando bookImplementationMeeting para ${leadName}...`);
      return `Hemos reservado internamente un espacio. Su link de confirmación es: https://calendly.com/tu-agencia/15min`;
    }
  }
};

/**
 * Array exportado en formato OpenAI/Gemini Schema 
 * para pasarlo directamente al parámetro `tools` del SDK.
 */
export const agentToolsSchema = Object.keys(AgentTools).map(key => ({
  type: "function",
  function: {
    name: key,
    description: AgentTools[key].description,
    parameters: AgentTools[key].parameters
  }
}));
