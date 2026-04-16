import axios from 'axios';

async function getFacebookPageId(fbUrl) {
  try {
    const response = await axios.get(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const html = response.data;
    // Look for common patterns
    const match1 = html.match(/"pageID":"(\d+)"/);
    const match2 = html.match(/fb:\/\/page\/(\d+)/);
    const match3 = html.match(/"page_id":"(\d+)"/);
    const match4 = html.match(/content="fb:\/\/page\/(\d+)"/);
    
    console.log("Match1:", match1 ? match1[1] : null);
    console.log("Match2:", match2 ? match2[1] : null);
    console.log("Match3:", match3 ? match3[1] : null);
    console.log("Match4:", match4 ? match4[1] : null);

  } catch (error) {
    console.error("Error fetching FB page:", error.message);
  }
}

getFacebookPageId('https://www.facebook.com/FrankGayServices/');
