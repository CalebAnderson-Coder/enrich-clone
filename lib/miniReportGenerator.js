// ============================================================
// lib/miniReportGenerator.js — PDF mini-reporte para enviar al
//   lead cuando responde "sí, mandamelo".
//
// Usa pdfkit (ya en package.json). 1-2 páginas. Diseño sobrio,
// colores Empírika (naranja primary, gris fondo). Contenido:
//   - Header con marca + nombre del negocio
//   - Snapshot del sitio (3 hallazgos del mini-audit)
//   - 3 acciones recomendadas (derivadas de los hallazgos)
//   - CTA final: agendar reunión 15 min
//
// Devuelve Buffer — el caller lo adjunta al email vía nodemailer.
// ============================================================

import PDFDocument from 'pdfkit';

const COLORS = {
  brand:   '#FF6B35',
  ink:     '#1F2937',
  mute:    '#6B7280',
  accent:  '#0EA5E9',
  bg:      '#FAFAF9',
  card:    '#FFFFFF',
  rule:    '#E5E7EB',
};

const FOOTER = 'Empírika · Consultora de Crecimiento Digital · empirikagroup.com';

function actionFromHallazgo(h) {
  const data = h.data || {};
  switch (h.kind) {
    case 'keyword_opportunity':
      return {
        title: `Acción 1 — Pelear por "${data.keyword}"`,
        body: `Esta keyword tiene ${(data.search_volume || 0).toLocaleString('es-MX')} búsquedas mensuales en tu mercado. Estás en posición ${data.position}, a 15-20 puestos de la página 1. Optimización on-page + 3 piezas de contenido orientadas a esta búsqueda pueden subirla 10+ posiciones en 90 días.`,
      };
    case 'broken_backlinks':
      return {
        title: `Acción 1 — Recuperar autoridad perdida`,
        body: `${data.broken_pct}% de tus backlinks (${data.broken} de ${data.total}) apuntan a páginas muertas. Cada link roto es autoridad SEO desperdiciada. Implementación de redirects 301 recupera ese juice link en 7-14 días sin contenido nuevo.`,
      };
    case 'competitor_pressure':
      return {
        title: `Acción — Cerrar la brecha vs ${data.domain}`,
        body: `Tu competidor te aparece arriba en ${data.intersections} búsquedas con posición promedio ${data.avg_position?.toFixed?.(1) ?? '—'}. Identificación de las 10 keywords más rentables donde te supera + plan de contenido focalizado para superarlo en cada una.`,
      };
    case 'low_authority':
      return {
        title: `Acción — Construir autoridad de dominio`,
        body: `Sólo ${data.referring_domains} dominios apuntan al sitio. La media de la industria está en 100-300 dominios. Estrategia de outreach + relaciones públicas digitales para cerrar esa brecha en 6 meses.`,
      };
    case 'kw_inventory':
      return {
        title: `Acción — Capitalizar inventario existente`,
        body: `Aparecés en ${(data.total_count || 0).toLocaleString('es-MX')} búsquedas. Optimización on-page de las 20 más cercanas al top 3 puede 3-5× tu tráfico orgánico sin contenido nuevo.`,
      };
    case 'backlink_inventory':
      return {
        title: `Acción — Convertir autoridad en rankings`,
        body: `${data.referring_domains} dominios refiriéndote es saludable. La oportunidad ahora es internal linking + topical clusters para que esa autoridad fluya a las páginas que más venden.`,
      };
    default:
      return {
        title: 'Acción priorizada',
        body: h.detail || h.headline,
      };
  }
}

function drawHeader(doc, lead) {
  // Banda superior naranja Empírika
  doc.rect(0, 0, doc.page.width, 70).fill(COLORS.brand);
  doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
     .text('EMPÍRIKA', 40, 26, { align: 'left' });
  doc.fontSize(10).font('Helvetica')
     .text('Mini-Reporte SEO · Análisis preliminar', 40, 48, { align: 'left' });
  doc.fillColor('#FFFFFF').fontSize(9)
     .text(new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
           doc.page.width - 200, 30, { width: 160, align: 'right' });
  doc.fontSize(9).text('Preparado para:', doc.page.width - 200, 42, { width: 160, align: 'right' });
  doc.font('Helvetica-Bold').text(lead.business_name || 'Tu negocio',
           doc.page.width - 200, 53, { width: 160, align: 'right' });
}

function drawIntro(doc, lead, audit, y) {
  const x = 40;
  doc.fillColor(COLORS.ink).fontSize(20).font('Helvetica-Bold')
     .text(lead.business_name || 'Análisis SEO', x, y);
  y = doc.y + 4;
  doc.fillColor(COLORS.mute).fontSize(10).font('Helvetica')
     .text(`${lead.industry || 'Servicios'} · ${lead.metro_area || 'EE.UU.'} · ${audit.domain}`, x, y);
  y = doc.y + 14;

  doc.fillColor(COLORS.ink).fontSize(10).font('Helvetica')
     .text(
       'Hicimos un análisis preliminar de tu presencia digital usando datos en vivo de Google. ' +
       'Lo que sigue son los 3 hallazgos más relevantes y las acciones priorizadas.',
       x, y, { width: doc.page.width - 80, lineGap: 2 }
     );
  return doc.y + 14;
}

function drawHallazgosCard(doc, audit, y) {
  const x = 40;
  const w = doc.page.width - 80;

  doc.fillColor(COLORS.ink).fontSize(13).font('Helvetica-Bold')
     .text('LO QUE GOOGLE SABE DE TU SITIO', x, y);
  y = doc.y + 8;

  audit.hallazgos.slice(0, 3).forEach((h, idx) => {
    // Numbered bullet
    doc.circle(x + 6, y + 8, 8).fill(COLORS.brand);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
       .text(String(idx + 1), x + 3, y + 4);

    doc.fillColor(COLORS.ink).fontSize(11).font('Helvetica-Bold')
       .text(h.headline, x + 24, y, { width: w - 24 });
    let inner = doc.y + 2;
    doc.fillColor(COLORS.mute).fontSize(9.5).font('Helvetica')
       .text(h.detail, x + 24, inner, { width: w - 24, lineGap: 2 });
    y = doc.y + 14;
  });
  return y + 4;
}

function drawAccionesCard(doc, audit, y) {
  const x = 40;
  const w = doc.page.width - 80;

  // Page break si no entra
  if (y > doc.page.height - 220) {
    doc.addPage();
    drawHeader(doc, { business_name: '' });
    y = 90;
  }

  doc.fillColor(COLORS.ink).fontSize(13).font('Helvetica-Bold')
     .text('PLAN DE ACCIÓN PRIORIZADO', x, y);
  y = doc.y + 8;

  const acciones = audit.hallazgos.slice(0, 3).map(actionFromHallazgo);
  acciones.forEach((a) => {
    if (y > doc.page.height - 100) {
      doc.addPage();
      drawHeader(doc, { business_name: '' });
      y = 90;
    }
    doc.rect(x, y, w, 1).fill(COLORS.rule);
    y += 8;
    doc.fillColor(COLORS.brand).fontSize(11).font('Helvetica-Bold')
       .text(a.title, x, y, { width: w });
    y = doc.y + 3;
    doc.fillColor(COLORS.ink).fontSize(9.5).font('Helvetica')
       .text(a.body, x, y, { width: w, lineGap: 2 });
    y = doc.y + 14;
  });
  return y;
}

function drawCTA(doc, lead, y) {
  const x = 40;
  const w = doc.page.width - 80;

  if (y > doc.page.height - 130) {
    doc.addPage();
    drawHeader(doc, { business_name: '' });
    y = 90;
  }

  // Bloque CTA con fondo naranja claro
  const boxH = 80;
  doc.rect(x, y, w, boxH).fill('#FFF4EE');
  doc.fillColor(COLORS.brand).fontSize(12).font('Helvetica-Bold')
     .text('¿Querés revisar este plan juntos?', x + 16, y + 14, { width: w - 32 });
  doc.fillColor(COLORS.ink).fontSize(10).font('Helvetica')
     .text(
       '15 minutos. Sin compromiso. Te explico cómo Empírika ejecuta cada acción y qué resultados típicamente vemos en 90 días para negocios como el tuyo.',
       x + 16, y + 32, { width: w - 32, lineGap: 1.5 }
     );
  doc.fillColor(COLORS.brand).fontSize(10).font('Helvetica-Bold')
     .text('Respondé este correo con la fecha+hora que te queda y agendamos.',
           x + 16, y + 60, { width: w - 32 });
  return y + boxH + 10;
}

function drawFooter(doc) {
  const y = doc.page.height - 36;
  doc.rect(0, y, doc.page.width, 36).fill(COLORS.bg);
  doc.fillColor(COLORS.mute).fontSize(8).font('Helvetica')
     .text(FOOTER, 40, y + 12, { width: doc.page.width - 80, align: 'center' });
  doc.fillColor(COLORS.mute).fontSize(7)
     .text(
       'Datos extraídos en vivo de Google vía DataForSEO. Reporte automatizado — el plan completo se afina en la reunión.',
       40, y + 22, { width: doc.page.width - 80, align: 'center' }
     );
}

/**
 * Genera el PDF mini-reporte y devuelve Buffer.
 *
 * @param {object} lead — { business_name, industry, metro_area, ... }
 * @param {object} audit — el output de runMiniAudit() persistido en mega_profile.mini_audit
 * @returns {Promise<Buffer>}
 */
export async function generateMiniReportPDF(lead, audit) {
  if (!audit?.ok || !audit.hallazgos?.length) {
    throw new Error('mini_audit incompleto — no hay hallazgos para reportar');
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 40, left: 40, right: 40 } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawHeader(doc, lead);
      let y = 90;
      y = drawIntro(doc, lead, audit, y);
      y = drawHallazgosCard(doc, audit, y);
      y = drawAccionesCard(doc, audit, y);
      drawCTA(doc, lead, y);

      // Footer en cada página
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
