// ============================================================
// scripts/twilio.js — Twilio SMS module (Sprint 5)
//
// Two entry points:
//   sendSMS({ to, body, from? })  — module-level used by dispatcher
//   twilioEngine.sendSMS(lead, demoUrl) — legacy campaign hook
//
// Silent-fail contract: when credentials are missing or the send
// fails, the function returns a structured error object instead
// of throwing so the dispatcher can fall through to the next
// channel (CALL_SCHEDULED).
// ============================================================

import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

/**
 * Module-level sender used by outreach_dispatcher.js.
 * @param {object} params
 * @param {string} params.to         E.164 phone
 * @param {string} params.body       SMS body (Spanish-only for Empírika)
 * @param {string} [params.from]     Override (default TWILIO_FROM_NUMBER / TWILIO_PHONE_NUMBER)
 * @returns {Promise<{messageSid?:string, status:string, error?:string}>}
 */
export async function sendSMS({ to, body, from } = {}) {
  const fromPhone = from || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  if (!twilioClient) {
    return { status: 'failed', error: 'twilio_not_configured' };
  }
  if (!fromPhone) {
    return { status: 'failed', error: 'twilio_from_missing' };
  }
  if (!to)   return { status: 'failed', error: 'to_missing' };
  if (!body) return { status: 'failed', error: 'body_missing' };

  try {
    const message = await twilioClient.messages.create({ to, from: fromPhone, body });
    return { messageSid: message.sid, status: message.status || 'queued' };
  } catch (err) {
    // Common carrier filter codes (non-A2P) → surface as structured error.
    const filtered = [30034, 30022, 30032].includes(err?.code);
    return {
      status: 'failed',
      error: filtered ? 'carrier_filtered' : (err?.message || 'twilio_api_error'),
      code:  err?.code || null,
    };
  }
}

/**
 * Legacy campaign hook (kept intact for launch_campaign.js / tests).
 */
export const twilioEngine = {
  async sendSMS(lead, demoUrl) {
    console.log(`[TWILIO-PROD] Preparando envío para: ${lead?.business_name} | Teléfono: ${lead?.phone}`);

    if (!twilioClient) {
      console.warn('[TWILIO-PROD] ⚠️ Credenciales Twilio faltantes.');
      return { status: 'FAILED_AUTH', sid: null };
    }

    const fromPhone = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;
    if (!fromPhone) {
      console.warn('[TWILIO-PROD] ⚠️ Faltante: TWILIO_PHONE_NUMBER.');
      return { status: 'FAILED_CONFIG', sid: null };
    }

    const messageBody = `Hey, it's Carlos. Looked up ${lead.business_name} and couldn't find your website online. My team and I put together a quick preview of how it could look: ${demoUrl}. Text YES if you want to see it live, or STOP to opt-out.`;

    try {
      const message = await twilioClient.messages.create({
        body: messageBody,
        from: fromPhone,
        to:   lead.phone,
      });
      console.log(`[TWILIO-PROD] 📱 SMS Expedido. SID: ${message.sid}`);
      return { status: 'SENT', sid: message.sid };
    } catch (error) {
      if ([30034, 30022, 30032].includes(error.code)) {
        console.error('[TWILIO-PROD] 🚨 BLOQUEO DE CARRIER (no A2P 10DLC).');
        return { status: 'FAILED_CARRIER_FILTERED', sid: null };
      }
      console.error('[TWILIO-PROD] ❌ Fallo el envío general:', error.message);
      return { status: 'FAILED_API', sid: null };
    }
  },
};
