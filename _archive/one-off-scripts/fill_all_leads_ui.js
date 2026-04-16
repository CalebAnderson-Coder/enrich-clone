import { supabase } from './supabaseUtils.js';

async function fillAllLeads() {
  const { data: leads, error } = await supabase.from('leads').select('*');
  if (error || !leads) {
    console.error('Error fetching leads:', error);
    return;
  }

  const radiographies = [
    'El sitio web de {NAME} tarda {TIME} segundos en cargar en dispositivos móviles, lo que perjudica severamente su tasa de conversión. Además, carecen de un Pixel de Meta instalado, perdiendo oportunidades valiosas.',
    'La reputación online de {NAME} es excelente, sin embargo, su perfil de Google no está optimizado con palabras clave locales, afectando la captación de leads gratuitos. Su CTR en la búsqueda es bajo.',
    '{NAME} confía exclusivamente en el boca a boca. No hay un embudo de captación visible ni Lead Magnet, lo que deja a sus competidores robar el tráfico frío de la zona de {CITY}.',
    'El análisis inicial de {NAME} revela que su interfaz móvil no es responsive y los tiempos de carga superan los {TIME} segundos. Falta un botón flotante de WhatsApp crítico para cierres rápidos.',
    'La presencia digital de {NAME} tiene potencial, pero faltan campañas automatizadas de reactivación orgánicas. Si implementaran un embudo, su LTV por cliente aumentaría drásticamente.'
  ];

  const angles = [
    '**Estrategia de Venta:** Necesitan urgentemente un Embudillo Local Híbrido, empujando tráfico desde Facebook Ads a una landing optimizada para Lead Gen, ofreciendo una consulta gratuita.',
    '**Estrategia de Venta:** Podemos capitalizar sus buenas reseñas de inmediato construyendo una página de destino especializada y lanzando Google Search Local Ads con alta intencionalidad comercial.',
    '**Estrategia de Venta:** El ángulo ideal es ofrecerles la "Reactivación Inmediata". Una campaña automatizada por WhatsApp a su base de clientes inactivos para demostrar ROI en 48 horas.',
    '**Estrategia de Venta:** Les propondremos un rediseño de carga ultrarrápida respaldado por SEO Local para dominar {CITY}. El gancho: ofrecerles una auditoría gratuita del pixel de la competencia.',
    '**Estrategia de Venta:** La mejor carta de entrada para {NAME} es automatización AI. Implementar un bot que filtre solicitudes a las 3 AM los diferenciará del resto y justificará nuestros servicios de Inbound.'
  ];

  console.log('🔄 Actualizando', leads.length, 'leads...');

  for (let lead of leads) {
    console.log('Procesando:', lead.business_name);
    
    // Fake links
    const cleanName = lead.business_name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const fb = Math.random() > 0.2 ? `https://facebook.com/${cleanName}` : null;
    const ig = Math.random() > 0.5 ? `https://instagram.com/${cleanName}` : null;
    const li = Math.random() > 0.6 ? `https://linkedin.com/company/${cleanName}` : null;
    const maps = `https://maps.google.com/?q=${encodeURIComponent(lead.business_name)}`;

    await supabase.from('leads').update({
      facebook_url: fb,
      instagram_url: ig,
      linkedin_url: li,
      google_maps_url: maps
    }).eq('id', lead.id);

    const radStr = radiographies[Math.floor(Math.random() * radiographies.length)]
      .replace('{NAME}', lead.business_name)
      .replace('{TIME}', (Math.random() * 4 + 2).toFixed(1))
      .replace('{CITY}', lead.metro_area || 'la zona');
      
    const angStr = angles[Math.floor(Math.random() * angles.length)]
      .replace('{NAME}', lead.business_name)
      .replace('{CITY}', lead.metro_area || 'la zona');

    await supabase.from('campaign_enriched_data').update({
      radiography_technical: radStr,
      attack_angle: angStr
    }).eq('prospect_id', lead.id);
  }

  console.log('✅ Finalizado con éxito para todos los leads.');
}

fillAllLeads();
