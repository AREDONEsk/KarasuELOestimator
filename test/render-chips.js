// Renders the team cards (content.js) on test/match-finished.html, a trimmed copy of a real finished
// Karasu match, and saves test/chips.png. Pass "noscoreboard" to test the approximate path.
// Usage: node test/render-chips.js [noscoreboard]
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1140, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const sync = { on: true, rating: 1.02, ratingAuto: true, myElo: null, ratingLow: 0.52, ratingHigh: 1.41 };
    const area = (data) => ({ get: (d, cb) => cb({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in data).map((k) => [k, data[k]])) }), set: () => {} });
    window.chrome = { runtime: { id: "demo" }, storage: { sync: area(sync), local: area({}), onChanged: { addListener() {} } } };
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto("file://" + path.join(__dirname, "match-finished.html"));
  if (process.argv[2] === "noscoreboard") await page.evaluate(() => document.querySelector("table.match-scoreboard").remove());
  await page.addScriptTag({ path: path.join(__dirname, "..", "model.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "content.js") });
  const box = page.locator("[data-kee-box]");
  await box.waitFor();
  await page.waitForTimeout(600);
  console.log(await page.evaluate(() => [...document.querySelector("[data-kee-box]").shadowRoot.querySelectorAll(".card")]
    .map((c) => c.querySelector(".pct").textContent + " " + (c.querySelector(".sub")?.textContent || "") + " | "
      + [...c.querySelectorAll(".chip")].map((x) => x.querySelector(".nm").textContent + " " + x.querySelector(".cw").textContent).join(", ")).join("\n")));
  await box.screenshot({ path: path.join(__dirname, process.argv[2] === "noscoreboard" ? "chips-approx.png" : "chips.png") });
  await browser.close();
})();
