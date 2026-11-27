// Screenshots the real popup.html with sample data (used by store/popup-showcase.html).
// Usage: node store/render-popup.js
const { chromium } = require("playwright");
const path = require("path");
const shots = [
  { name: "popup-closed", sync: { myElo: 1646, rating: 1.05, ratingAuto: true, ratingLow: 0.78, ratingHigh: 1.36, autoAccept: true, acceptDelay: 2 }, open: false },
  { name: "popup-levels", sync: { myElo: 2530, rating: 1.2, ratingAuto: true, ratingLow: 0.91, ratingHigh: 1.52, autoAccept: false, acceptDelay: 2 }, open: true },
];
(async () => {
  const browser = await chromium.launch();
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: 300, height: 600 }, deviceScaleFactor: 3 });
    await page.addInitScript((sync) => {
      const local = { myEloSeen: Date.now() - 3 * 60000, ratingSeen: Date.now() - 3 * 60000 };
      const area = (data) => ({ get: (d, cb) => cb({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in data).map((k) => [k, data[k]])) }), set: () => {} });
      window.chrome = { runtime: { id: "demo" }, storage: { sync: area(sync), local: area(local), onChanged: { addListener() {} } } };
    }, s.sync);
    await page.goto("file://" + path.join(__dirname, "..", "popup.html"));
    await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
    if (s.open) await page.click("#lvBtn");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, s.name + ".png"), fullPage: true });
    await page.close();
  }
  await browser.close();
})();
