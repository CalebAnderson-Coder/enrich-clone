import fs from 'fs';
import PDFDocument from 'pdfkit';
import { supabase } from './supabaseUtils.js';

async function generateReport() {
    if (!supabase) {
        console.log("No hay conexión a Supabase configurada.");
        return;
    }

    console.log("1. Extrayendo los datos unificados (Radar + Francotirador)...");

    // Fetch the specific enriched lead: JLC Outdoors Inc.
    const leadId = 'd5be9c5a-a838-4b95-9595-4d4a1d976c89';

    const { data: leadData, error: leadErr } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

    const { data: enrichedData, error: enrichErr } = await supabase
        .from('campaign_enriched_data')
        .select('*')
        .eq('prospect_id', leadId)
        .single();

    if (leadErr || !leadData) {
        console.log("Error buscando lead en la BD:", leadErr);
        return;
    }

    const lead = leadData;
    const raw = lead.mega_profile || {};
    const radar = raw.radar_parsed || {};
    const enriched = enrichedData || {};

    const reportPath = `./reports/auditoria_alta_gama.pdf`;

    // Ensure directory
    if (!fs.existsSync('./reports')) {
        fs.mkdirSync('./reports');
    }

    console.log(`2. Renderizando Diseño Premium para: ${lead.business_name}...`);

    // Create a document with no margins so we can draw full-bleed elements easily
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const stream = fs.createWriteStream(reportPath);
    doc.pipe(stream);

    // PALETTE
    const PALETTE = {
        primary: '#0F172A', // Slate 900
        accent: '#2563EB',  // Blue 600
        bg: '#F8FAFC',      // Slate 50
        textDark: '#1E293B',// Slate 800
        textMuted: '#64748B'// Slate 500
    };

    // --- FUNCIONALIDADES DE DIBUJO ---
    function drawHeader() {
        doc.rect(0, 0, doc.page.width, 140).fill(PALETTE.primary);
        doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold').text('AUDITORÍA DE PROSPECCIÓN DIGITAL', 0, 45, { align: 'center' });
        doc.fillColor('#94A3B8').fontSize(12).font('Helvetica').text('Inteligencia de Negocio B2B', 0, 85, { align: 'center' });
    }

    // Dibujar Header
    drawHeader();
    doc.y = 170;
    doc.x = 50;

    // --- IDENTIDAD ---
    doc.fillColor(PALETTE.accent).fontSize(24).font('Helvetica-Bold').text(lead.business_name, 50, doc.y);
    doc.moveDown(0.2);
    
    doc.fontSize(14).fillColor(PALETTE.textMuted).font('Helvetica');
    doc.text(`Sector: ${lead.industry || 'Construcción / Servicios'}`);
    doc.text(`Ubicación: ${lead.metro_area || 'Desconocida'}`);
    doc.moveDown(2);

    // --- BLOQUE 1: DATOS RECOLECTADOS ---
    const drawBlock = (title, startY) => {
        doc.rect(50, startY, doc.page.width - 100, 30).fill(PALETTE.primary);
        doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold').text(title, 65, startY + 8);
        return startY + 40;
    };

    let localY = drawBlock('HUELLA DIGITAL Y CONTACTO', doc.y);

    // Cuadro de contactos (Fondo gris claro)
    doc.rect(50, localY, doc.page.width - 100, 100).fill(PALETTE.bg);
    doc.fillColor(PALETTE.textDark).font('Helvetica').fontSize(12);
    
    localY += 15;
    doc.text(`Sitio Web:    `, 65, localY, { continued: true }).font('Helvetica-Bold').fillColor(PALETTE.accent).text(lead.website || radar.website || 'No Detectado', { link: lead.website || '' });
    localY += 20;
    doc.font('Helvetica').fillColor(PALETTE.textDark).text(`Teléfono:     `, 65, localY, { continued: true }).font('Helvetica-Oblique').fillColor(PALETTE.textMuted).text(lead.phone || radar.phone || 'N/A');
    localY += 20;
    doc.font('Helvetica').fillColor(PALETTE.textDark).text(`Google Maps:  `, 65, localY, { continued: true }).font('Helvetica-Bold').fillColor(PALETTE.accent).text(lead.google_maps_url ? 'Ver Mapa' : 'No Encontrado', { link: lead.google_maps_url || '' });
    localY += 20;
    doc.font('Helvetica').fillColor(PALETTE.textDark).text(`LinkedIn:     `, 65, localY, { continued: true }).font('Helvetica-Bold').fillColor(PALETTE.accent).text(lead.linkedin_url ? 'Ver Perfil' : 'No Encontrado', { link: lead.linkedin_url || '' });
    
    doc.y = localY + 50;

    // --- BLOQUE 2: REPUTACIÓN ---
    localY = drawBlock('MÉTRICAS DE REPUTACIÓN Y SEO LOCAL', doc.y);
    doc.rect(50, localY, doc.page.width - 100, 70).fill(PALETTE.bg);
    
    localY += 15;
    const rating = lead.rating || radar.rating || 'N/A';
    const reviews = lead.review_count || radar.review_count || '0';
    
    doc.fillColor(PALETTE.textDark).font('Helvetica-Bold').fontSize(16).text(`⭐ ${rating} / 5.0`, 65, localY);
    doc.font('Helvetica').fontSize(12).fillColor(PALETTE.textMuted).text(`Puntaje de Satisfacción Promedio`, 65, localY + 20);

    doc.fillColor(PALETTE.textDark).font('Helvetica-Bold').fontSize(16).text(`📝 ${reviews} Opiniones`, doc.page.width / 2, localY);
    doc.font('Helvetica').fontSize(12).fillColor(PALETTE.textMuted).text(`Reseñas indexadas por el Radar`, doc.page.width / 2, localY + 20);

    doc.y = localY + 70;

    // --- BLOQUE 3: ESTRATEGIA (RADIOGRAFÍA Y ÁNGULO) ---
    // If we run out of space, create a new page
    if (doc.y > doc.page.height - 250) {
        doc.addPage();
        drawHeader();
        doc.y = 170;
    }

    if (enriched.radiography_technical || radar.radar_summary) {
        localY = drawBlock('DIAGNÓSTICO TÉCNICO (NUESTRA VISIÓN)', doc.y);
        doc.rect(50, localY, doc.page.width - 100, 100).fill(PALETTE.bg); // Background flexible, just drawing a fixed rect for style
        doc.fillColor(PALETTE.textDark).font('Helvetica-Oblique').fontSize(12);
        doc.text(enriched.radiography_technical || radar.radar_summary, 65, localY + 15, { width: doc.page.width - 130, align: 'justify', lineGap: 4 });
        doc.y = doc.y + 40;
    }

    if (enriched.attack_angle) {
        if (doc.y > doc.page.height - 150) {
            doc.addPage();
            drawHeader();
            doc.y = 170;
        }

        localY = drawBlock('LA OPORTUNIDAD: ÁNGULO DE VENTA', doc.y);
        doc.rect(50, localY, doc.page.width - 100, 100).fill('#EFF6FF'); // Light blue for opportunity
        doc.fillColor('#1E3A8A').font('Helvetica-Bold').fontSize(12);
        doc.text(enriched.attack_angle, 65, localY + 15, { width: doc.page.width - 130, align: 'justify', lineGap: 4 });
    }

    // --- PIE DE PÁGINA ---
    const range = doc.bufferedPageRange(); 
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(PALETTE.primary);
        doc.fontSize(9).font('Helvetica').fillColor('#FFFFFF').text(
            `Propiedad Exclusiva de Agencia IA. Generado el ${new Date().toLocaleDateString()}`,
            0,
            doc.page.height - 25,
            { align: 'center' }
        );
    }

    doc.end();

    stream.on('finish', () => {
        console.log(`\n✅ ¡PDF PREMIUM Generado con éxito!`);
        console.log(`📁 Ubicación: ${reportPath}`);
    });
}

generateReport();
