// Renders the store graphics (1280x800, Chrome Web Store screenshot size):
//   promo.html          -> promo-1280x800.png   (all levels)
//   popup-showcase.html -> popup-1280x800.png   (the popup; run render-popup.js first)
//   match-showcase.html -> match-1280x800.png   (team cards; run render-cards.js first)
// Usage: node store/render.js   (needs Playwright with Chromium)
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const [src, out] of [["promo.html", "promo-1280x800.png"], ["popup-showcase.html", "popup-1280x800.png"], ["match-showcase.html", "match-1280x800.png"]]) {
    await page.goto("file://" + path.join(__dirname, src));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, out) });
  }
  await browser.close();
})();
