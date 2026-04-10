import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

// Inicializa el cliente Twilio Real
// Si no están las variables en .env, inicializa nulo para evitar crashear al levantar la app.
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

/**
 * Twilio SMS Outreach (PRODUCCIÓN)
 */
export const twilioEngine = {
  async sendSMS(lead, demoUrl) {
    console.log(`[TWILIO-PROD] Preparando envío para: ${lead.business_name} | Teléfono: ${lead.phone}`);
    
    if (!twilioClient) {
      console.warn(`[TWILIO-PROD] ⚠️ ADVERTENCIA: Credenciales de Twilio SID/TOKEN no encontradas en .env. Se registrará estado PENDING-AUTH.`);
      return { status: 'FAILED_AUTH', sid: null };
    }

    const fromPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!fromPhone) {
      console.warn(`[TWILIO-PROD] ⚠️ Faltante: No hay TWILIO_PHONE_NUMBER en .env configurado.`);
      return { status: 'FAILED_CONFIG', sid: null };
    }

    // El mensaje debe ser ultra-natural para tratar de bypasear los filtros
    // ya que no hay A2P 10DLC activo.
    const messageBody = `Hey, it's Carlos. Looked up ${lead.business_name} and couldn't find your website online. My team and I put together a quick preview of how it could look: ${demoUrl}. Text YES if you want to see it live, or STOP to opt-out.`;
    
    try {
      console.log(`[TWILIO-PROD] Drenando mensaje a red celular (Sin registro A2P)...`);
      const message = await twilioClient.messages.create({
        body: messageBody,
        from: fromPhone,
        to: lead.phone
      });

      console.log(`[TWILIO-PROD] 📱 SMS Expedido exitosamente. SID: ${message.sid}`);
      return { status: 'SENT', sid: message.sid };

    } catch (error) {
      // Manejo específico de Errores de Carrier / Filtrado de Spam en USA
      if (error.code === 30034 || error.code === 30022 || error.code === 30032) {
        console.error(`[TWILIO-PROD] 🚨 BLOQUEO DE CARRIER. Como el número NO es A2P 10DLC, la operadora filtró el SMS por Spam Risk.`);
        return { status: 'FAILED_CARRIER_FILTERED', sid: null };
      }
      
      console.error(`[TWILIO-PROD] ❌ Fallo el envío general:`, error.message);
      return { status: 'FAILED_API', sid: null };
    }
  }
};
