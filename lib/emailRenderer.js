// ============================================================
// lib/emailRenderer.js — HTML Email Renderer for DaVinci Magnets
// Converts DaVinci's text output into a professional HTML email
// with embedded visual asset and Empirika branding.
// ============================================================

import fs from 'fs';
import path from 'path';

/**
 * Renders a professional HTML email from DaVinci's magnet output.
 * @param {Object} magnetData - The parsed JSON output from DaVinci agent
 * @param {Object} lead - The lead record from Supabase (business_name, industry, etc.)
 * @returns {{ subject: string, html: string }}
 */
export function renderMagnetEmail(magnetData, lead) {
  const {
    magnet_type,
    visual_asset_url,
    stitch_preview_url,
    angela_email_subject,
    angela_email_body,
    visual_strategy,
  } = magnetData;

  const businessName = lead.business_name || 'tu negocio';
  const subject = angela_email_subject || `Propuesta para ${businessName}`;

  // ── Brand Guidelines (Black & Orange) ──────────────
  const brand = {
    primaryDark: '#0D0D0D',       // Jet Black background
    secondaryDark: '#1A1A1A',     // Card background
    primaryOrange: '#FF7A00',     // Vibrant Orange
    textLight: '#F3F4F6',         // Off-white for main text
    textMuted: '#9CA3AF',         // Gray for secondary text
    fontFamily: "'Montserrat', Arial, sans-serif"
  };

  // Clean up LLM's body to ensure it doesn't include raw file paths or raw URLs
  let rawBody = angela_email_body || '';
  // Remove absolute file paths (Windows or Unix)
  rawBody = rawBody.replace(/(?:file:\/\/\/?)?[A-Za-z]:\\[\w\\\-\s.]+\.\w+/gi, '');
  rawBody = rawBody.replace(/(?:file:\/\/\/)?[/]?Users\/[\w\/\-\s.]+\.\w+/gi, '');
  // Remove bracketed URLs like [ https://stitch.google.com/... ]
  rawBody = rawBody.replace(/\[\s*https?:\/\/[^\s\]]+\s*\]/gi, '');
  // Remove standalone stitch links
  rawBody = rawBody.replace(/https?:\/\/stitch\.google\.com[^\s]*/gi, '');

  const bodyParagraphs = rawBody
    .split('\n')
    .filter(line => line.trim())
    // Remove auto-generated emojis if any were in the text
    .map(line => line.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim())
    .filter(line => line.length > 0)
    .map(line => `<p style="margin:0 0 16px 0; color:${brand.textLight}; font-size:16px; line-height:1.7; font-weight: 400;">${escapeHtml(line)}</p>`)
    .join('\n');

  // ── Build visual block ────────────────────────────────────
  let visualBlock = '';
  const attachments = [];
  
  let currentAssetUrl = visual_asset_url;
  
  // Fallback for landing pages missing an image
  if (magnet_type === 'LANDING' && !currentAssetUrl) {
    // Beautiful abstract tech/design placeholder for landing pages that don't have a generated visual
    currentAssetUrl = 'https://images.unsplash.com/photo-1547658719-da2b511591bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
  }

  // Create the image HTML if we have a visual_asset_url
  let imageHtml = '';
  if (currentAssetUrl) {
    if (isLocalPath(currentAssetUrl)) {
      try {
        const cid = 'visual_asset_' + Date.now() + '@empirika.com';
        attachments.push({
          filename: path.basename(visual_asset_url),
          path: visual_asset_url,
          cid: cid
        });
        imageHtml = `<img src="cid:${cid}" alt="Propuesta para ${escapeHtml(businessName)}" style="width:100%; max-width:600px; border-radius:8px; border:1px solid #333333; margin-bottom: 24px;" />`;
      } catch (e) {
        console.warn(`  ⚠️ [emailRenderer] No se pudo leer el asset local: ${visual_asset_url}`);
      }
    } else {
      imageHtml = `<img src="${currentAssetUrl}" alt="Propuesta para ${escapeHtml(businessName)}" style="width:100%; max-width:600px; border-radius:8px; border:1px solid #333333; margin-bottom: 24px;" />`;
    }
  }

  if (imageHtml) {
    // Normal asset (ADS / INSTAGRAM / LANDING)
    visualBlock = `
      <div style="text-align:center; margin:32px 0; background:${brand.secondaryDark}; padding:32px 24px; border-radius:12px; border: 1px solid #2A2A2A;">
        <h3 style="margin: 0 0 24px 0; color: ${brand.textLight}; font-size: 20px; font-weight: 700;">Propuesta Visual para ${escapeHtml(businessName)}</h3>
        ${imageHtml}
      </div>`;
  }

  // ── Full HTML template ────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <!-- Import Montserrat font matching Empirika Group -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <!-- Outlook conditional comments for fallback font -->
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

          <!-- Header (White background to match logo branding and reveal black SVG) -->
          <tr>
            <td style="background-color: #FFFFFF; padding: 28px 0; border-bottom: 4px solid ${brand.primaryOrange}; border-radius: 8px 8px 0 0; text-align:center;">
              <!-- Styling on the img tag acts as a perfect visual fallback if SVG fails to load -->
              <a href="https://empirikagroup.com" style="text-decoration:none; outline:none;">
                <img src="https://empirikagroup.com/wp-content/uploads/2022/11/Logo-Empirika-Group.svg" 
                     width="240" 
                     alt="empirika." 
                     style="display:inline-block; border:none; outline:none; color:#0B0B0B; font-family:'Montserrat', Arial, sans-serif; font-weight:800; font-size:42px; letter-spacing:-1.5px; text-transform:lowercase; text-decoration:none;" />
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
                    <p style="margin:4px 0 0 0; font-size:13px; color:${brand.textMuted};">Empírika Group</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bottom Footer -->
          <tr>
            <td style="padding:40px 0; border-top:1px solid #333333;">
              <p style="margin:0 0 16px 0; font-size:14px; font-weight: 600; color:${brand.textMuted}; line-height:1.6; text-align:center; font-style:italic;">
                "Los números siempre son importantes y en Empirika nos respaldan,<br/>generan confianza y credibilidad."
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

function getAccentColor(emotion) {
  const map = {
    urgencia:  '#ef4444', // red
    confianza: '#3b82f6', // blue
    prestigio: '#1a1a2e', // near-black
    calidez:   '#f59e0b', // amber
    emoción:   '#8b5cf6', // purple
  };
  return map[emotion] || '#111827';
}
