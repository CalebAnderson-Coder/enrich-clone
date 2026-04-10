import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();

/**
 * Email Outreach Module (PRODUCCIÓN)
 * Llama al servidor de SMTP configurado (Gmail / Resend).
 */
export const emailEngine = {
  transporter: nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false, // true para puerto 465
    auth:   { 
      user: process.env.SMTP_USER, 
      pass: process.env.SMTP_PASS?.trim() 
    },
    tls:    { rejectUnauthorized: false },
  }),

  async sendEmail(lead, previewUrl) {
    console.log(`\\n[EMAIL OUTREACH] Preparando envío para: ${lead.business_name} (${lead.email_address || 'Sin email'})`);
    
    // Si no hay email, marcamos el error interno
    if (!lead.email_address) {
      console.warn(`[EMAIL OUTREACH] ⚠️ ${lead.business_name} no tiene email_address. Saltando envío.`);
      return { status: 'SKIPPED_NO_EMAIL', messageId: null };
    }

    const senderFirstName = (process.env.SMTP_FROM_NAME || 'Brian').split(' ')[0];
    
    // El texto ultra-corto idéntico al del mensaje de texto, pero sin links y con mejor formato visual
    const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 30px; }
    .card { background: #fff; border-radius: 12px; max-width: 600px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1e3a5f 0%, #2d6a4f 100%); color: #fff; padding: 36px 32px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header p  { margin: 8px 0 0; opacity: 0.85; font-size: 14px; }
    .body { padding: 32px; color: #374151; line-height: 1.65; }
    .body h2 { font-size: 18px; margin: 0 0 12px; color: #1e3a5f; }
    .cta { display: inline-block; margin-top: 24px; background: #2d6a4f; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; }
    .footer { border-top: 1px solid #f0f0f0; padding: 20px 32px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🚀 A fresh new look for ${lead.business_name}</h1>
      <p>I built this prototype for you.</p>
    </div>
    <div class="body">
      <p>Hey, it's ${senderFirstName} from Empírika Digital.</p>
      <p>I looked up <strong>${lead.business_name}</strong> and decided to put together a quick preview of how a modern, high-converting website could look for your business.</p>
      <p>You can view the live prototype I built for you using the link below:</p>
      <a class="cta" href="${previewUrl}">View Your Live Prototype →</a>
      <p style="margin-top: 30px; font-size: 13px; color: #6b7280;">If you're not interested, just reply STOP and I won't bother you again.</p>
    </div>
    <div class="footer">
      Sent by ${senderFirstName} · Empírika Digital 
    </div>
  </div>
</body>
</html>
    `.trim();

    try {
      const info = await this.transporter.sendMail({
        from:    `"${process.env.SMTP_FROM_NAME || 'Smart Agency'}" <${process.env.SMTP_USER}>`,
        to:      lead.email_address, // Puedes poner process.env.SMTP_USER en fallback si necesitas testear auto
        subject: `I built a new website for ${lead.business_name}`,
        html:    htmlTemplate,
      });

      console.log(`[EMAIL OUTREACH] ✅ ¡Mail enviado exitosamente a ${lead.email_address}! MessageID: ${info.messageId}`);
      
      return {
        status: 'SENT',
        messageId: info.messageId
      };
      
    } catch (error) {
      console.error(`[EMAIL OUTREACH] ❌ Falló el envío de correo.`, error);
      return {
        status: 'FAILED',
        messageId: null,
        error: error.message
      };
    }
  }
};
