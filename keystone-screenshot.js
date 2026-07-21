const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1000);
  
  // Navigate to active-work route
  await page.goto('http://localhost:5173/active-work');
  await page.waitForTimeout(2000);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/active-work.png', fullPage: true });
  console.log('Screenshot saved to /tmp/active-work.png');
  
  // Also grab console logs
  const logs = await page.evaluate(() => {
    return window.document.body.innerHTML.substring(0, 3000);
  });
  console.log('\n--- Page HTML (first 3000 chars) ---');
  console.log(logs);
  
  await browser.close();
})();
