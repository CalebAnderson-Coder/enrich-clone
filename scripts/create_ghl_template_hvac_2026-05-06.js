// ============================================================
// scripts/create_ghl_template_hvac_2026-05-06.js
//
// Creates a reusable HTML email template in GoHighLevel for the
// HVAC niche pitch, so José Sánchez can send it 1:1 from the
// CRM UI without depending on the custom Node mailer script.
//
// Template title: "Empírika HVAC FL — pitch 1:1 v1"
// Idempotent: if a template with that title already exists,
// logs "already exists, skipping" and exits clean.
//
// Mirrors the exact two-step flow from:
//   C:\Users\Agencia IA\mcp\ghl-mcp\main.py → create_email_template
//     Step 1: POST /emails/builder  → get templateId from .redirect or .id
//     Step 2: POST /emails/builder/data → save html + previewText
// ============================================================

import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'uQPxZOmT4zVlMHfOGRw2';
const TOKEN       = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;
const API_VERSION = '2021-07-28';

const TEMPLATE_TITLE   = 'Empírika HVAC FL — pitch 1:1 v1';
const PREVIEW_TEXT     = 'Diseñé esta página web pensando en {{contact.company_name}}';
const BOOKING_URL      = 'https://api.leadconnectorhq.com/widget/booking/calendario-empirika';

if (!TOKEN) {
  console.error('FATAL: GHL_PRIVATE_TOKEN (or EMPIRIKA_GHL_KEY) missing from env');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Version: API_VERSION,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// ── HVAC body paragraphs (extracted verbatim from lib/emailRenderer.js)
// NICHE_TEMPLATES['10. Aire acondicionado (HVAC)'].body
// Variable substituted: {{businessName}} → GHL merge tag {{contact.company_name}}
const HVAC_PARAGRAPHS = [
  'Hola, busqué empresas de aire acondicionado en tu zona y encontré {{contact.company_name}}. Con la temporada de calor acercándose, ahora es el momento perfecto para tener presencia online.',
  'El 85% de los propietarios buscan "AC repair near me" cuando su sistema falla. Sin una página web, esas llamadas de emergencia van directo a tu competencia.',
  'Diseñé un concepto que incluye: servicios de instalación/reparación/mantenimiento, planes de servicio anual, formulario de diagnóstico gratuito y botón de emergencia.',
  'Adjunto el preview para {{contact.company_name}}. Gratis y sin compromiso — responde y te explico cómo implementarla.',
];

// ── HVAC subject (from NICHE_TEMPLATES['10. Aire acondicionado (HVAC)'].subject)
const HVAC_SUBJECT = '{{contact.company_name}} — tu página web profesional de HVAC';

// ── Brand palette (matches lib/emailRenderer.js)
const BRAND = {
  primaryDark:    '#0D0D0D',
  secondaryDark:  '#1A1A1A',
  primaryOrange:  '#FF7A00',
  textLight:      '#F3F4F6',
  textMuted:      '#9CA3AF',
  fontFamily:     "'Montserrat', Arial, sans-serif",
};

// ── Build HTML ────────────────────────────────────────────────
function buildHtml() {
  const bodyParagraphsHtml = HVAC_PARAGRAPHS
    .map(p => `<p style="margin:0 0 16px 0; color:${BRAND.textLight}; font-size:16px; line-height:1.7; font-weight:400;">${p}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${HVAC_SUBJECT}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, h1, h2, h3, a, span {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${BRAND.primaryDark}; font-family:${BRAND.fontFamily};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.primaryDark}; padding:40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px; width:100%; background-color:${BRAND.primaryDark};">

          <!-- Header -->
          <tr>
            <td style="background-color:#FFFFFF; padding:28px 0; border-bottom:4px solid ${BRAND.primaryOrange}; border-radius:8px 8px 0 0; text-align:center;">
              <a href="#" style="text-decoration:none; outline:none; color:#0B0B0B; font-family:'Montserrat', Arial, sans-serif; font-weight:800; font-size:36px; letter-spacing:-1px;">
                emp<span style="color:${BRAND.primaryOrange};">írika</span>
              </a>
            </td>
          </tr>

          <!-- Body paragraphs -->
          <tr>
            <td style="padding:40px 0 0 0;">
              ${bodyParagraphsHtml}
            </td>
          </tr>

          <!-- Screenshot placeholder block -->
          <tr>
            <td style="text-align:center; margin:32px 0; background:${BRAND.secondaryDark}; padding:32px 24px; border-radius:12px; border:1px solid #2A2A2A;">
              <h3 style="margin:0 0 16px 0; color:${BRAND.textLight}; font-size:18px; font-weight:700;">
                Propuesta Visual para {{contact.company_name}}
              </h3>
              <p style="margin:0; color:${BRAND.textMuted}; font-size:14px;">
                [Adjunta aquí el screenshot de la landing page de HVAC antes de enviar]
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:32px 0; text-align:center;">
              <a href="${BOOKING_URL}"
                 target="_blank"
                 style="display:inline-block; padding:16px 40px; background:linear-gradient(135deg, ${BRAND.primaryOrange}, #FF9A40); color:#0D0D0D; font-family:${BRAND.fontFamily}; font-size:18px; font-weight:700; text-decoration:none; border-radius:10px; letter-spacing:0.02em;">
                Agenda 15 minutos →
              </a>
              <p style="margin:12px 0 0 0; font-size:13px; color:${BRAND.textMuted};">Sin compromiso • Solo haz clic para reservar tu llamada gratuita</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0;">
              <hr style="border:none; border-top:1px solid #333333; margin:40px 0 32px 0;" />
            </td>
          </tr>

          <!-- Signature — José -->
          <tr>
            <td style="padding:0 0 24px 0;">
              <p style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:${BRAND.textLight};">José Sánchez</p>
              <p style="margin:0; font-size:14px; font-weight:600; color:${BRAND.primaryOrange}; text-transform:uppercase; letter-spacing:0.05em;">Estratega Digital</p>
              <p style="margin:4px 0 0 0; font-size:13px; color:${BRAND.textMuted};">Empírika</p>
            </td>
          </tr>

          <!-- Bottom Footer -->
          <tr>
            <td style="padding:40px 0; border-top:1px solid #333333;">
              <p style="margin:0 0 16px 0; font-size:14px; font-weight:600; color:${BRAND.textMuted}; line-height:1.6; text-align:center; font-style:italic;">
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
}

// ── GHL helpers ───────────────────────────────────────────────
async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: HEADERS });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function ghlPost(path, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log('=== Empírika HVAC — crear template GHL ===\n');

  // ── Step 0: Check if template already exists (idempotency)
  console.log('Buscando templates existentes...');
  let skip = 0;
  const limit = 100;
  let found = null;

  while (true) {
    const data = await ghlGet('/emails/builder', {
      locationId: LOCATION_ID,
      limit,
      skip,
    });

    // API returns { builders: [...], total: N }
    // Items use "name" field (not "title")
    const items = data.builders || data.templates || data.data || data.list || [];
    for (const t of items) {
      if (t.name === TEMPLATE_TITLE || t.title === TEMPLATE_TITLE) {
        found = t;
        break;
      }
    }
    if (found) break;

    // Pagination: if fewer items than limit were returned, we've seen all
    if (items.length < limit) break;
    skip += limit;
  }

  if (found) {
    console.log(`already exists, skipping — id: ${found.id || found._id}`);
    process.exit(0);
  }

  // ── Step 1: Create the template record (metadata only)
  console.log('Creando template (paso 1 — registro)...');
  const createResult = await ghlPost('/emails/builder', {
    locationId: LOCATION_ID,
    title: TEMPLATE_TITLE,
    name: TEMPLATE_TITLE,
    type: 'html',
  });

  console.log('Step 1 response:', JSON.stringify(createResult, null, 2));

  // Extract templateId exactly as main.py does:
  // template_id = result_data.get("redirect") or result_data.get("id")
  const templateId = createResult.redirect || createResult.id;
  if (!templateId) {
    console.error('FATAL: no se obtuvo templateId del paso 1. Respuesta completa arriba.');
    process.exit(1);
  }

  console.log(`Template ID obtenido: ${templateId}`);

  // ── Step 2: Save the HTML content
  console.log('\nGuardando contenido HTML (paso 2)...');
  const html = buildHtml();

  const saveBody = {
    locationId: LOCATION_ID,
    templateId,
    updatedBy: LOCATION_ID,
    html,
    editorType: 'html',
    dnd: { elements: [], attrs: {}, templateSettings: {} },
    previewText: PREVIEW_TEXT,
  };

  const saveResult = await ghlPost('/emails/builder/data', saveBody);
  console.log('Step 2 response:', JSON.stringify(saveResult, null, 2));

  // ── Summary
  const finalId = saveResult.id || saveResult.templateId || templateId;
  console.log('\n=== RESULTADO ===');
  console.log(`Titulo:       ${TEMPLATE_TITLE}`);
  console.log(`Template ID:  ${finalId}`);
  console.log(`Preview text: ${PREVIEW_TEXT}`);
  console.log(`\nSubject sugerido para 1:1:`);
  console.log(`  ${HVAC_SUBJECT}`);
  console.log(`\nParrafos del cuerpo:`);
  HVAC_PARAGRAPHS.forEach((p, i) => console.log(`  [${i + 1}] ${p.slice(0, 80)}...`));
  console.log('\nTemplate listo en GHL. Jose puede usarlo desde CRM UI → Contacts → Send Email.');
})().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(2);
});
