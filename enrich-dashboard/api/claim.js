// ============================================================
// api/claim.js — CTA Click Tracking Endpoint
// When a lead clicks the email CTA, this updates their tag
// in both Supabase and GoHighLevel to "Interesado"
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).send('Missing campaign ID');
  }

  try {
    // 1. Fetch the campaign record to get GHL contact ID
    const { data: campaign, error: fetchError } = await supabase
      .from('campaign_enriched_data')
      .select('id, ghl_contact_id, ghl_tag, leads!inner(business_name)')
      .eq('id', id)
      .single();

    if (fetchError || !campaign) {
      console.error('Claim: campaign not found', id, fetchError?.message);
      return redirectToThankYou(res);
    }

    // 2. Update Supabase tag
    await supabase
      .from('campaign_enriched_data')
      .update({ ghl_tag: 'Interesado' })
      .eq('id', id);

    // 3. Update GHL tag if contact exists
    const GHL_API_KEY = process.env.GHL_API_KEY;
    if (GHL_API_KEY && campaign.ghl_contact_id) {
      try {
        // Add "Interesado en Recibir Pagina Web" tag
        await fetch(`https://services.leadconnectorhq.com/contacts/${campaign.ghl_contact_id}/tags`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({
            tags: ['Interesado en Recibir Pagina Web'],
          }),
        });
      } catch (ghlErr) {
        console.error('GHL tag update error (non-blocking):', ghlErr.message);
      }
    }

    console.log(`✅ [Claim] Lead ${campaign.leads?.business_name} clicked CTA → tag: Interesado`);

    // 4. Redirect to thank you page
    return redirectToThankYou(res, campaign.leads?.business_name);
  } catch (err) {
    console.error('Claim error:', err);
    return redirectToThankYou(res);
  }
}

function redirectToThankYou(res, businessName) {
  const name = businessName || 'tu negocio';
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>¡Gracias! — Empirika Group</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0D0D0D;
      font-family: 'Montserrat', sans-serif;
      color: #F3F4F6;
    }
    .container {
      text-align: center;
      max-width: 520px;
      padding: 48px 32px;
      background: rgba(26, 26, 26, 0.95);
      border: 1px solid rgba(255, 122, 0, 0.3);
      border-radius: 20px;
      box-shadow: 0 0 60px rgba(255, 122, 0, 0.08);
    }
    .logo { font-size: 32px; font-weight: 800; margin-bottom: 24px; }
    .logo span { color: #FF7A00; }
    .check { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    p { font-size: 16px; color: #9CA3AF; line-height: 1.6; margin-bottom: 8px; }
    .highlight { color: #FF7A00; font-weight: 600; }
    .cta { 
      display: inline-block; margin-top: 24px; padding: 14px 32px;
      background: linear-gradient(135deg, #FF7A00, #FF9A40);
      color: #0D0D0D; font-weight: 700; font-size: 16px;
      border-radius: 10px; text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,122,0,0.3); }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">agencia<span>.ia</span></div>
    <div class="check">✅</div>
    <h1>¡Excelente decisión!</h1>
    <p>Hemos registrado tu interés para <span class="highlight">${escapeHtml(name)}</span>.</p>
    <p>Un especialista de nuestro equipo se pondrá en contacto contigo <strong>en las próximas 24 horas</strong> para comenzar a trabajar en tu propuesta personalizada.</p>
    <a href="https://empirikagroup.com" class="cta">Conocer más sobre Empirika →</a>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
