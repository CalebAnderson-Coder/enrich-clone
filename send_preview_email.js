import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';
import { renderMagnetEmail } from './lib/emailRenderer.js';

async function sendPreviewEmail() {
  console.log('Generando preview de email...');

  // Mock Magnet Data (similar a test_davinci)
  const magnetData = {
    magnet_type: 'LANDING',
    visual_asset_url: 'assets/landing_niches/4. Remodelación (remodeling)/screencapture-html-occidensential-grahaprime-2026-03-30-15_24_21.png',
    angela_email_subject: 'Landing page gratis para Tacos El Patrón',
    angela_email_body: 'Hola Brian,\n\nVi que Tacos El Patrón tiene muy buenas reseñas en Google, ¡felicidades! Pero noté que no tienen una página web propia para mostrar todo su potencial.\n\nAsí que le pedí a nuestro equipo de diseño que preparara una landing page de alta conversión para ustedes...\n\nAquí tienes un mockup diseñado específicamente para Tacos El Patrón. Imagina captar todos esos clientes que buscan tacos en línea.\n\n¿Te gustaría que la pongamos en marcha? Solo responde este correo.\n\nSaludos,\n\nÁngela, Especialista Digital @ Agentic AI',
    visual_strategy: {
      target_emotion: 'calidez'
    }
  };

  const lead = {
    business_name: 'Tacos El Patrón'
  };

  const { subject, html, attachments } = await renderMagnetEmail(magnetData, lead);

  console.log('Email HTML generado exitosamente. Configurando nodemailer...');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false, // STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS.trim(),
    },
  });

  const targetEmail = process.argv[2] || 'brianagency@gmail.com';

  const mailOptions = {
    from: `"Ángela · Agentic AI" <${process.env.SMTP_USER}>`,
    to: targetEmail,
    subject: `[PREVIEW] ${subject}`,
    html: html,
    attachments: attachments
  };

  console.log(`Enviando correo de prueba a: ${mailOptions.to}`);

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Correo enviado con éxito!');
    console.log('Mensaje ID: %s', info.messageId);
  } catch (error) {
    console.error('❌ Error enviando correo:', error.message);
  }
}

sendPreviewEmail();
