// Draws the real in-match team cards (content.js) on store/match-demo.html with demo players,
// and saves them as store/match-cards.png for store/match-showcase.html.
// Usage: node store/render-cards.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1140, height: 700 }, deviceScaleFactor: 3 });
  await page.addInitScript(() => {
    const sync = { on: true, rating: 1.05, ratingAuto: true, myElo: 1646, ratingLow: 0.78, ratingHigh: 1.36 };
    const area = (data) => ({ get: (d, cb) => cb({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in data).map((k) => [k, data[k]])) }), set: () => {} });
    window.chrome = { runtime: { id: "demo" }, storage: { sync: area(sync), local: area({}), onChanged: { addListener() {} } } };
  });
  await page.goto("file://" + path.join(__dirname, "match-demo.html"));
  await page.addScriptTag({ path: path.join(__dirname, "..", "model.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "content.js") });
  const box = page.locator("[data-kee-box]");
  await box.waitFor();
  await page.waitForTimeout(600);
  await box.screenshot({ path: path.join(__dirname, "match-cards.png") });
  await browser.close();
})();
