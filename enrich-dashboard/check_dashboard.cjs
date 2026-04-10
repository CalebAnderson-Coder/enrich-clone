const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log('Navigating to dashboard...');
  await page.goto('https://enrich-dashboard-seven.vercel.app/', { waitUntil: 'networkidle' });
  
  // Wait a bit for React to render and fetch data
  await page.waitForTimeout(3000);
  
  const screenshotPath = 'dashboard-screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);
  
  // Check if there are any buttons with text "Draft de Correo"
  const draftButtons = await page.$$("button:has-text('Draft de Correo')");
  console.log(`Found ${draftButtons.length} "Draft de Correo" buttons on the Leads view.`);
  
  await browser.close();
})();
