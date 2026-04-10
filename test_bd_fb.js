import dotenv from 'dotenv';
dotenv.config();

const url = 'https://www.facebook.com/FrankGayServices/';
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;

async function run() {
  try {
    const response = await fetch('https://api.brightdata.com/dca/trigger?zone=web_unlocker', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: url })
    });
    
    const result = await response.json();
    console.log("Response:", result);
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
