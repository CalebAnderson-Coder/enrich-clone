
async function testMobileFB() {
  try {
    const res = await global.fetch('https://m.facebook.com/FrankGayServices/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await res.text();
    const match = html.match(/"pageID":"(\d+)"/);
    const match2 = html.match(/page_id=(\d+)/);
    const match3 = html.match(/"entity_id":"(\d+)"/);
    console.log("HTML len:", html.length);
    console.log("1:", match?.[1], "2:", match2?.[1], "3:", match3?.[1]);
  } catch(e) {
    console.error(e);
  }
}
testMobileFB();
