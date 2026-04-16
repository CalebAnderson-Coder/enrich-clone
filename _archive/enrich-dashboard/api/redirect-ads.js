export default async function handler(req, res) {
  const { fb_url, query } = req.query;

  const fallbackRedirect = () => {
    res.redirect(302, `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(query || '')}&search_type=keyword_exact_phrase`);
  };

  if (!fb_url) {
    return fallbackRedirect();
  }

  try {
    let username = fb_url;
    // Si pasaron una URL completa, extraemos lo último
    if (username.includes('facebook.com/')) {
      const parts = username.split('facebook.com/');
      let relative = parts[1].split('?')[0];
      if (relative.endsWith('/')) {
        relative = relative.slice(0, -1);
      }
      
      // Si la URL es de profile.php?id=123
      if (fb_url.includes('profile.php?id=')) {
        const idMatch = fb_url.match(/id=(\d+)/);
        if (idMatch) {
          return res.redirect(302, `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=${idMatch[1]}&search_type=page`);
        }
      }
      
      username = relative;
    }

    if (!username || username === 'pages') {
       return fallbackRedirect();
    }

    // Usamos la app móvil ligera
    const response = await fetch(`https://m.facebook.com/${encodeURIComponent(username)}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();
    
    // Facebook mobile inyecta IDs en varios lugares
    const match = html.match(/"pageID":"(\d+)"/);
    const match2 = html.match(/page_id=(\d+)/);
    const match3 = html.match(/"entity_id":"(\d+)"/);

    const pageId = (match && match[1]) || (match2 && match2[1]) || (match3 && match3[1]);

    if (pageId) {
      return res.redirect(302, `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=${pageId}&search_type=page`);
    } else {
      return fallbackRedirect();
    }
  } catch (error) {
    console.error('Error in redirect-ads:', error);
    return fallbackRedirect();
  }
}
