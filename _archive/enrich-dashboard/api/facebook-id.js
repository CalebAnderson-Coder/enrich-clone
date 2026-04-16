export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: 'Falta el parámetro username' });
  }

  try {
    // Usamos m.facebook.com con un User-Agent "Mobile" para obtener el HTML ligero
    const response = await fetch(`https://m.facebook.com/${encodeURIComponent(username)}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();
    
    // Facebook mobile siempre inyecta "pageID":"<numero>"
    const match = html.match(/"pageID":"(\d+)"/);
    const match2 = html.match(/page_id=(\d+)/);
    const match3 = html.match(/"entity_id":"(\d+)"/);

    const pageId = (match && match[1]) || (match2 && match2[1]) || (match3 && match3[1]);

    if (pageId) {
      return res.status(200).json({ success: true, pageId });
    } else {
      return res.status(404).json({ success: false, error: 'No se pudo encontrar el ID de la página automáticamente' });
    }
  } catch (error) {
    console.error('Error al obtener fb id:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
