const https = require('https');

async function getFacebookPageId(fbUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(fbUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    };

    const req = https.request(options, (res) => {
      // Follow redirect if 301/302
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getFacebookPageId(res.headers.location));
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const match = data.match(/"pageID":"(\d+)"/);
        const match2 = data.match(/fb:\/\/page\/(\d+)/);
        const match3 = data.match(/"entity_id":"(\d+)"/);
        console.log("Page ID Match 1:", match ? match[1] : null);
        console.log("Page ID Match 2:", match2 ? match2[1] : null);
        console.log("Page ID Match 3:", match3 ? match3[1] : null);
        resolve(data.length);
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

getFacebookPageId('https://www.facebook.com/FrankGayServices/')
  .then(len => console.log('Response size:', len))
  .catch(console.error);
