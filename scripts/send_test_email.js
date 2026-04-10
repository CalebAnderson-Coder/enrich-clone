import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { renderMagnetEmail } from '../lib/emailRenderer.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// SMTP Setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function runTest() {
  const testEmail = "brian@agentlead.online";
  
  const businessName = "Empírika Digital";

  const magnetVariations = [
    {
      magnet_type: 'LANDING',
      stitch_preview_url: 'https://preview.stitch.test/tu-landing',
      visual_asset_url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=600&auto=format&fit=crop', 
      angela_email_subject: 'Ideas de crecimiento reales para Empírika',
      angela_email_body: 'Hola equipo,\n\nEstuve revisando su huella digital y el potencial que tienen es tremendo. Sin embargo, noté que la experiencia de usuario (UX) actual podría optimizarse para capturar muchos más leads.\n\nEn lugar de enviarles un simple pitch, nuestro equipo se tomó la libertad de programar una maqueta completa y funcional específicamente para ustedes.\n\nSi les gusta lo que ven, el código ya está listo para transferirse. ¡Díganme qué opinan!',
    },
    {
      magnet_type: 'ADS',
      visual_asset_url: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?q=80&w=600&auto=format&fit=crop', 
      angela_email_subject: 'Una propuesta de anuncio de alto rendimiento para Empírika',
      angela_email_body: 'Hola equipo,\n\nAnalizando sus anuncios actuales, descubrí que hay un ángulo que no están atacando y que suele duplicar el ROAS de las agencias de marketing.\n\nDecidí que en lugar de contárselos, era mejor mostrárselos. Hemos diseñado un set de creativos de alta conversión listos para pautar.\n\nLa imagen principal de la campaña la pueden ver justo aquí abajo. Si les interesa probarla, les paso los copys.',
    },
    {
      magnet_type: 'INSTAGRAM',
      visual_asset_url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=600&auto=format&fit=crop',
      angela_email_subject: 'Tu rediseño de perfil de Instagram está listo',
      angela_email_body: 'Hola equipo,\n\nEl contenido de su Instagram es muy bueno, pero me di cuenta de que el feed podría tener una cohesión visual mucho más fuerte que transmita autoridad como agencia de marketing premium.\n\nNuestro equipo creativo se puso a trabajar y rediseñó las portadas, estéticas y el grid de su perfil para generar ese factor "Wow" inmediato en las visitas.\n\nLes dejo la previsualización del feed aquí mismo. ¡Espero que les guste la propuesta!',
    }
  ];

  console.log(`Enviando 3 tests a ${testEmail} para negocio ${businessName}...`);

  for (const magnetData of magnetVariations) {
    const { subject, html } = renderMagnetEmail(magnetData, { business_name: businessName });
    
    try {
      const info = await transporter.sendMail({
        from: `"Angela de Empírika" <${process.env.SMTP_USER}>`,
        to: testEmail,
        subject: `[TEST ${magnetData.magnet_type}] ${subject}`,
        html: html
      });
      console.log(`✅ Mail [${magnetData.magnet_type}] enviado con éxito: ${info.messageId}`);
    } catch (err) {
      console.error(`❌ Error enviando mail [${magnetData.magnet_type}]:`, err.message);
    }
  }
}

runTest();
