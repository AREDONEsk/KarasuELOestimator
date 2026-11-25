// Renders store/promo.html to store/promo-1280x800.png (Chrome Web Store screenshot size).
// Usage: node store/render.js   (needs Playwright with Chromium)
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("file://" + path.join(__dirname, "promo.html"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, "promo-1280x800.png") });
  await browser.close();
})();
