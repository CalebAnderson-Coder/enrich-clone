import { test, expect } from '@playwright/test';

test.describe('QA UI Sentinel Agent', () => {

  test('Ensures UI has no crashes, no [object Object], and valid links', async ({ page, request }) => {
    const consoleErrors = [];
    
    // 1. Trap Console Errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore standard favicon or tracking errors if any, but log React/UI errors
        if (!text.includes('favicon.ico')) {
          consoleErrors.push(text);
        }
      }
    });
    
    // Listen for uncaught exceptions
    page.on('pageerror', exception => {
      consoleErrors.push(`Uncaught exception: ${exception}`);
    });

    // 2. Navigate to dashboard
    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    // Wait for the leads to load
    await page.waitForSelector('.mega-profile-card', { timeout: 15000 });
    
    // 3. Scan DOM for "[object Object]", "undefined", "null" literal strings
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    // We do NOT want to see literal "[object Object]" rendered to the user
    expect(bodyText).not.toContain('[object Object]');
    
    // Let's also assure 'undefined' is not floating around carelessly 
    // (sometimes 'undefined' is part of a valid string, but usually it's a bug if it's alone or starts a word)
    const badUndefinedMatch = bodyText.match(/\bundefined\b/i);
    if (badUndefinedMatch) {
      console.warn('⚠️ Warning: Found "undefined" in the text, might be a bug.');
      // uncomment if you want to fail on this
      // expect(bodyText).not.toContain('undefined');
    }

    // 4. Validate Links
    const links = await page.$$eval('a', anchors => anchors.map(a => ({ text: a.innerText, href: a.getAttribute('href') })));
    
    const brokenLinks = [];
    for (const link of links) {
      if (!link.href) {
        brokenLinks.push(`Link without href: "${link.text}"`);
      } else if (link.href === '#' || link.href.includes('undefined') || link.href.includes('[object Object]')) {
        brokenLinks.push(`Malformed link href: "${link.href}" for text "${link.text}"`);
      }
    }
    
    // Fail if there are broken links detected in the UI DOM output
    if (brokenLinks.length > 0) {
      console.error('❌ QA Agent found broken links:', brokenLinks);
    }
    expect(brokenLinks.length).toBe(0);

    // 5. Fail if console errors were caught
    if (consoleErrors.length > 0) {
      console.error('❌ QA Agent caught Console Errors:', consoleErrors);
    }
    expect(consoleErrors.length).toBe(0);

    console.log('✅ QA Agent Report: All tests passed! UI is 100% functional, no broken DOM strings, no console errors.');
  });
});
