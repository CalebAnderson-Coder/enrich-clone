// ============================================================
// lib/emailRenderer.js — Hybrid Email Renderer
// Supports BOTH:
//   1. Legacy DaVinci AI format (angela_email_body, visual_asset_url)
//   2. New niche-based website_screenshot format (image_path, niche_folder)
// ============================================================

import fs from 'fs';
import path from 'path';

// ── Niche-specific email templates ──────────────────────────
// Each template has a subject line and body paragraphs tailored
// to the ICP pain points of that specific trade niche.
// Variables: {{businessName}} is replaced at render time.
// ────────────────────────────────────────────────────────────
const NICHE_TEMPLATES = {
  '1. Limpieza (cleaning)': {
    subject: '{{businessName}}, diseñamos esta página web para tu negocio de limpieza',
    body: [
      'Hola, encontré tu negocio {{businessName}} buscando servicios de limpieza en tu zona y me tomé la libertad de diseñar un concepto de página web profesional que podría ayudarte a captar más clientes.',
      'El 72% de los clientes buscan servicios de limpieza en Google antes de llamar. Sin una página web profesional, esos clientes terminan contactando a tu competencia.',
      'Tu nueva página incluiría: formulario de cotización instantánea, galería de antes/después, reseñas de clientes verificados y un botón de WhatsApp directo.',
      'Adjunto un preview del diseño que preparé especialmente para {{businessName}}. Es 100% gratis y sin compromiso — solo responde este correo si te interesa recibirla.',
    ],
  },
  '2. Construcción (construction)': {
    subject: '{{businessName}} — tu página web profesional de construcción lista',
    body: [
      'Hola, busqué contratistas de construcción en tu área y encontré {{businessName}}. Me pareció una empresa con excelente potencial y diseñé un concepto de página web para ti.',
      'Los contratistas con presencia web profesional cierran un 40% más de contratos que los que dependen solo del boca a boca o tarjetas de presentación.',
      'El diseño que preparé incluye: portafolio de proyectos con fotos HD, formulario de estimados gratuitos, sección de licencias y seguros, y testimonios de clientes.',
      'Mira el preview adjunto — lo diseñé pensando específicamente en los servicios de {{businessName}}. Responde si quieres recibirla sin costo.',
    ],
  },
  '3. Techado (roofing)': {
    subject: '{{businessName}}, diseñé esta página web para tu empresa de roofing',
    body: [
      'Hola, encontré {{businessName}} mientras investigaba empresas de techado en tu zona. Me impresionó tu trabajo y quise hacer algo para ayudarte a crecer.',
      'Después de una tormenta, el 89% de los propietarios buscan "roof repair near me" en Google. Si no apareces con una página web profesional, pierdes esos trabajos.',
      'Diseñé un concepto que incluye: botón de inspección gratuita, galería de trabajos completados, integración con reseñas de Google y un formulario de emergencia 24/7.',
      'Te adjunto el preview del diseño para {{businessName}}. Es completamente gratis — solo responde si te gustaría implementarla.',
    ],
  },
  '4. Remodelación (remodeling)': {
    subject: '{{businessName}} — tu nueva página web de remodelación',
    body: [
      'Hola, estuve buscando empresas de remodelación en tu zona y encontré {{businessName}}. Me pareció que tu negocio merece una presencia online a la altura de tu trabajo.',
      'Los clientes de remodelación investigan un promedio de 3 semanas online antes de elegir contratista. Una página web con portafolio profesional es lo que marca la diferencia.',
      'El diseño incluye: galería antes/después interactiva, calculadora de presupuesto, sección de cocinas/baños/interiores y un sistema de citas online.',
      'Adjunto un preview exclusivo para {{businessName}}. Sin costo, sin compromiso — responde y te la entrego lista.',
    ],
  },
  '5. Handyman': {
    subject: '{{businessName}}, mira esta página web que diseñé para tu negocio',
    body: [
      'Hola, encontré {{businessName}} buscando servicios de mantenimiento en tu zona y quise hacer algo especial: diseñé un concepto de página web profesional para tu negocio.',
      'El problema #1 de los handymen es que los clientes no los encuentran online. El 65% de las personas buscan "handyman near me" en Google antes de contratar a alguien.',
      'Tu página incluiría: lista de todos tus servicios con precios base, botón de chat directo, zona de servicio con mapa y reseñas de clientes satisfechos.',
      'Te adjunto el preview — lo hice pensando en {{businessName}}. Es gratis y sin compromiso. Solo responde si te interesa.',
    ],
  },
  '6. Pintura (painting)': {
    subject: '{{businessName}} — diseñé esta página web para tu empresa de pintura',
    body: [
      'Hola, busqué pintores profesionales en tu área y encontré {{businessName}}. Tu trabajo se ve increíble y merece una presencia web que lo refleje.',
      'Los clientes de pintura son muy visuales: necesitan ver tu trabajo antes de contratarte. Una galería profesional online convierte visitantes en llamadas.',
      'El diseño que preparé incluye: galería de colores y acabados, portafolio de proyectos completados, cotizador rápido y botón de WhatsApp directo.',
      'Mira el preview adjunto para {{businessName}}. Es completamente gratis — responde y te explico cómo obtener tu página web profesional.',
    ],
  },
  '7. Paisajismo (landscaping)': {
    subject: '{{businessName}}, tu nueva página web de paisajismo está lista',
    body: [
      'Hola, encontré {{businessName}} investigando empresas de paisajismo en tu zona. Me tomé la libertad de diseñar un concepto de página web para tu negocio.',
      'El 78% de los propietarios buscan servicios de landscaping en Google. Sin una web profesional, esos clientes terminan llamando a empresas que sí aparecen online.',
      'Tu página incluiría: galería de jardines y proyectos, planes de mantenimiento con precios, estimador de costos y formulario de "diseño de jardín gratis".',
      'Adjunto un preview exclusivo para {{businessName}}. Es gratis, sin compromiso — solo responde si te interesa implementarla.',
    ],
  },
  '8. Electricidad': {
    subject: '{{businessName}} — tu página web profesional de electricista',
    body: [
      'Hola, busqué electricistas certificados en tu zona y encontré {{businessName}}. Me pareció un negocio sólido que podría beneficiarse de una presencia web profesional.',
      'El 60% de las emergencias eléctricas se buscan en Google. "Electrician near me" es una de las búsquedas más frecuentes y los que no aparecen, pierden ese trabajo.',
      'Diseñé un concepto con: lista de servicios (residencial/comercial), sección de licencias y certificaciones, formulario de emergencia 24/7 y botón de llamada directa.',
      'Te adjunto el preview para {{businessName}}. Sin costo, sin compromiso — responde si te gustaría tener tu página web funcionando.',
    ],
  },
  '9. Plomería (plumbing)': {
    subject: '{{businessName}}, diseñé esta página web para tu negocio de plomería',
    body: [
      'Hola, encontré {{businessName}} buscando plomeros en tu área. Las emergencias de plomería no esperan, y los clientes tampoco: buscan en Google y llaman al primero que ven.',
      'El hecho es simple: los plomeros con página web reciben 3x más llamadas que los que solo dependen de Google My Business o referencias.',
      'El diseño que preparé incluye: botón de servicio de emergencia 24/7, lista de servicios y precios transparentes, galería de trabajos y un formulario de cita rápida.',
      'Te adjunto el preview exclusivo para {{businessName}}. Es 100% gratis — solo responde si te interesa.',
    ],
  },
  '10. Aire acondicionado (HVAC)': {
    subject: '{{businessName}} — tu página web profesional de HVAC',
    body: [
      'Hola, busqué empresas de aire acondicionado en tu zona y encontré {{businessName}}. Con la temporada de calor acercándose, ahora es el momento perfecto para tener presencia online.',
      'El 85% de los propietarios buscan "AC repair near me" cuando su sistema falla. Sin una página web, esas llamadas de emergencia van directo a tu competencia.',
      'Diseñé un concepto que incluye: servicios de instalación/reparación/mantenimiento, planes de servicio anual, formulario de diagnóstico gratuito y botón de emergencia.',
      'Adjunto el preview para {{businessName}}. Gratis y sin compromiso — responde y te explico cómo implementarla.',
    ],
  },
};

// Default template for niches not in the map
const DEFAULT_TEMPLATE = {
  subject: '{{businessName}}, diseñé esta página web profesional para tu negocio',
  body: [
    'Hola, encontré {{businessName}} buscando negocios de servicio en tu zona y me tomé la libertad de diseñar un concepto de página web profesional.',
    'Hoy en día, el 80% de los clientes buscan en Google antes de contratar un servicio. Sin una página web, pierdes esos clientes frente a la competencia que sí aparece online.',
    'Tu nueva página incluiría: portafolio de trabajos, formulario de cotización, reseñas de clientes y botón de contacto directo por WhatsApp.',
    'Te adjunto el preview del diseño para {{businessName}}. Es 100% gratis y sin compromiso — responde si te interesa recibirla.',
  ],
};

/**
 * Renders a professional HTML email.
 * Auto-detects format:
 *   - 'website_screenshot' → niche templates + local image attachment
 *   - Legacy DaVinci         → angela AI body + visual_asset_url
 *
 * @param {Object} magnetData - From campaign_enriched_data.lead_magnets_data
 * @param {Object} lead - The lead record (business_name, industry, email_address)
 * @param {Object} [options] - { angelaSubject, angelaBody }
 * @returns {{ subject: string, html: string, attachments: Array }}
 */
export function renderMagnetEmail(magnetData, lead, options = {}) {
  const businessName = lead.business_name || 'tu negocio';
  const attachments = [];
  const { angelaSubject, angelaBody } = options;

  let subject, bodyParagraphs, imageHtml;

  // ── Route to the correct renderer ──────────────────────────
  if (magnetData.magnet_type === 'website_screenshot') {
    // ══════════════════════════════════════════════════════════
    // NEW PATH: Niche-based deterministic screenshots
    // ══════════════════════════════════════════════════════════
    const template = NICHE_TEMPLATES[magnetData.niche_folder] || DEFAULT_TEMPLATE;

    // Use Angela's AI generated copy if provided, otherwise fallback to template
    subject = angelaSubject || template.subject.replace(/\{\{businessName\}\}/g, businessName);

    if (angelaBody) {
      bodyParagraphs = angelaBody
        .split('\n')
        .map(line => line.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim())
        .filter(line => line.length > 0)
        .map(line => `<p style="margin:0 0 16px 0; color:#F3F4F6; font-size:16px; line-height:1.7; font-weight: 400;">${escapeHtml(line)}</p>`)
        .join('\n');
    } else {
      bodyParagraphs = template.body
        .map(line => line.replace(/\{\{businessName\}\}/g, businessName))
        .map(line => `<p style="margin:0 0 16px 0; color:#F3F4F6; font-size:16px; line-height:1.7; font-weight: 400;">${escapeHtml(line)}</p>`)
        .join('\n');
    }

    // Embed local image as CID attachment
    imageHtml = '';
    if (magnetData.image_path) {
      const absolutePath = path.resolve(magnetData.image_path);
      if (fs.existsSync(absolutePath)) {
        const cid = 'niche_screenshot_' + Date.now() + '@empirika.com';
        attachments.push({
          filename: magnetData.image_file || path.basename(absolutePath),
          path: absolutePath,
          cid: cid,
        });
        imageHtml = `<img src="cid:${cid}" alt="Propuesta para ${escapeHtml(businessName)}" style="width:100%; max-width:600px; border-radius:8px; border:1px solid #333333; margin-bottom: 24px;" />`;
      } else {
        console.warn(`  ⚠️ [emailRenderer] Asset not found: ${absolutePath}`);
      }
    }

  } else {
    // ══════════════════════════════════════════════════════════
    // LEGACY PATH: DaVinci AI-generated content
    // ══════════════════════════════════════════════════════════
    const {
      visual_asset_url,
      angela_email_subject,
      angela_email_body,
    } = magnetData;

    subject = angela_email_subject || `Propuesta para ${businessName}`;

    // Clean up LLM's body
    let rawBody = angela_email_body || '';
    rawBody = rawBody.replace(/(?:file:\/\/\/?)?[A-Za-z]:\\[\w\\\-\s.]+\.\w+/gi, '');
    rawBody = rawBody.replace(/(?:file:\/\/\/)?[/]?Users\/[\w\/\-\s.]+\.\w+/gi, '');
    rawBody = rawBody.replace(/\[\s*https?:\/\/[^\s\]]+\s*\]/gi, '');
    rawBody = rawBody.replace(/https?:\/\/stitch\.google\.com[^\s]*/gi, '');

    bodyParagraphs = rawBody
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim())
      .filter(line => line.length > 0)
      .map(line => `<p style="margin:0 0 16px 0; color:#F3F4F6; font-size:16px; line-height:1.7; font-weight: 400;">${escapeHtml(line)}</p>`)
      .join('\n');

    // Process visual asset
    imageHtml = '';
    let currentAssetUrl = visual_asset_url;
    if (magnetData.magnet_type === 'LANDING' && !currentAssetUrl) {
      currentAssetUrl = 'https://images.unsplash.com/photo-1547658719-da2b511591bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    }

    if (currentAssetUrl) {
      if (isLocalPath(currentAssetUrl)) {
        try {
          const cid = 'visual_asset_' + Date.now() + '@agency.com';
          attachments.push({
            filename: path.basename(currentAssetUrl),
            path: currentAssetUrl,
            cid: cid,
          });
          imageHtml = `<img src="cid:${cid}" alt="Propuesta para ${escapeHtml(businessName)}" style="width:100%; max-width:600px; border-radius:8px; border:1px solid #333333; margin-bottom: 24px;" />`;
        } catch (e) {
          console.warn(`  ⚠️ [emailRenderer] No se pudo leer el asset local: ${currentAssetUrl}`);
        }
      } else {
        imageHtml = `<img src="${currentAssetUrl}" alt="Propuesta para ${escapeHtml(businessName)}" style="width:100%; max-width:600px; border-radius:8px; border:1px solid #333333; margin-bottom: 24px;" />`;
      }
    }
  }

  // ── Build visual block ────────────────────────────────────
  let visualBlock = '';
  if (imageHtml) {
    visualBlock = `
      <div style="text-align:center; margin:32px 0; background:#1A1A1A; padding:32px 24px; border-radius:12px; border: 1px solid #2A2A2A;">
        <h3 style="margin: 0 0 24px 0; color: #F3F4F6; font-size: 20px; font-weight: 700;">Propuesta Visual para ${escapeHtml(businessName)}</h3>
        ${imageHtml}
      </div>`;
  }

  // ── Brand Guidelines (Black & Orange) ──────────────────────
  const brand = {
    primaryDark: '#0D0D0D',
    secondaryDark: '#1A1A1A',
    primaryOrange: '#FF7A00',
    textLight: '#F3F4F6',
    textMuted: '#9CA3AF',
    fontFamily: "'Montserrat', Arial, sans-serif",
  };

  // ── Full HTML template ────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, h1, h2, h3, a, span {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${brand.primaryDark}; font-family:${brand.fontFamily};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${brand.primaryDark}; padding:40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px; width:100%; background-color:${brand.primaryDark};">

          <!-- Header (White background to match logo branding and reveal text) -->
          <tr>
            <td style="background-color: #FFFFFF; padding: 28px 0; border-bottom: 4px solid ${brand.primaryOrange}; border-radius: 8px 8px 0 0; text-align:center;">
              <a href="#" style="text-decoration:none; outline:none; color:#0B0B0B; font-family:'Montserrat', Arial, sans-serif; font-weight:800; font-size:36px; letter-spacing:-1px;">
                emp<span style="color:${brand.primaryOrange};">írika</span>
              </a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 0 0 0;">
              ${bodyParagraphs}
            </td>
          </tr>

          <!-- Visual asset -->
          <tr>
            <td style="padding:0;">
              ${visualBlock}
            </td>
          </tr>

          <!-- CTA Button (Trackable) -->
          ${options.campaignId && options.baseUrl ? `
          <tr>
            <td style="padding:24px 0; text-align:center;">
              <a href="${options.baseUrl}/api/claim?id=${options.campaignId}"
                 target="_blank"
                 style="display:inline-block; padding:16px 40px; background:linear-gradient(135deg, ${brand.primaryOrange}, #FF9A40); color:#0D0D0D; font-family:${brand.fontFamily}; font-size:18px; font-weight:700; text-decoration:none; border-radius:10px; letter-spacing:0.02em;">
                 Quiero Recibir Mi Página Web Gratis →
              </a>
              <p style="margin:12px 0 0 0; font-size:13px; color:${brand.textMuted};">Sin compromiso • Solo haz clic para confirmar tu interés</p>
            </td>
          </tr>
          ` : ''}

          <!-- Divider -->
          <tr>
            <td style="padding:0;">
              <hr style="border:none; border-top:1px solid #333333; margin:40px 0 32px 0;" />
            </td>
          </tr>

          <!-- Custom Footer Sign-off -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:${brand.textLight};">Ángela</p>
                    <p style="margin:0; font-size:14px; font-weight:600; color:${brand.primaryOrange}; text-transform:uppercase; letter-spacing:0.05em;">Estratega Digital</p>
                    <p style="margin:4px 0 0 0; font-size:13px; color:${brand.textMuted};">Empírika</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bottom Footer -->
          <tr>
            <td style="padding:40px 0; border-top:1px solid #333333;">
              <p style="margin:0 0 16px 0; font-size:14px; font-weight: 600; color:${brand.textMuted}; line-height:1.6; text-align:center; font-style:italic;">
                "Los números siempre son importantes y en nuestra agencia nos respaldan,<br/>generan confianza y credibilidad."
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, attachments };
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isLocalPath(str) {
  return str && !str.startsWith('http') && !str.startsWith('data:');
}
