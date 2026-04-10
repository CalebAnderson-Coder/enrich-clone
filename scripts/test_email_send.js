// scripts/test_email_send.js — Sends a real test email via the dispatcher's email renderer
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();

const TEST_TO = process.env.SMTP_USER; // Send to José himself as a test

const html = `
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
      <h1>🚀 Pipeline Activo — Sisyphus-as-a-Service</h1>
      <p>Email enviado automáticamente por el Agente DaVinci</p>
    </div>
    <div class="body">
      <h2>¡Conexión SMTP verificada!</h2>
      <p>Este es un email de prueba enviado desde el pipeline autónomo de <strong>Empírika Digital</strong>.</p>
      <p>Cuando el sistema detecte un lead con magnet <code>COMPLETED</code>, el dispatcher enviará automáticamente un correo personalizado como este — sin intervención humana.</p>
      <p>Transportes configurados:</p>
      <ul>
        <li>✅ Gmail SMTP (primario) — Jsanchez@empirikagroup.com</li>
        <li>⏸️ Resend API (fallback)</li>
      </ul>
      <a class="cta" href="https://empirikagroup.com">Ver Dashboard Empírika →</a>
    </div>
    <div class="footer">
      Empírika Digital · Sistema Autónomo de Outreach · ${new Date().toLocaleString('es-MX')}
    </div>
  </div>
</body>
</html>`;

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS?.trim() },
  tls:    { rejectUnauthorized: false },
});

console.log(`\n📧 Sending test email to ${TEST_TO}...`);

const info = await transporter.sendMail({
  from:    `"Ángela · Empírika Digital" <${process.env.SMTP_USER}>`,
  to:      TEST_TO,
  subject: '✅ Pipeline Activo — Sisyphus-as-a-Service (Test)',
  html,
});

console.log(`✅ Email enviado! ID: ${info.messageId}`);
console.log(`   Respuesta SMTP: ${info.response}`);
