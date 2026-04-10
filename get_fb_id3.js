

async function getFacebookPageId(fbUrl) {
  try {
    const res = await fetch(fbUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const data = await res.text();
    const match = data.match(/"pageID":"(\d+)"/);
    const match2 = data.match(/fb:\/\/page\/(\d+)/);
    const match3 = data.match(/"entity_id":"(\d+)"/);
    
    console.log("Page ID Match 1:", match ? match[1] : null);
    console.log("Page ID Match 2:", match2 ? match2[1] : null);
    console.log("Page ID Match 3:", match3 ? match3[1] : null);
    console.log("Response size:", data.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

getFacebookPageId('https://www.facebook.com/FrankGayServices/');
