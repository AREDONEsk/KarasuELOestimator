// Renders test/match-finished.html as if it were served at a karasu.live match address, with the
// lineup API answer mocked so that two premades show up, and saves test/parties.png (chips + rows).
// Usage: node test/render-parties.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const MATCH = "https://karasu.live/matches/ae894e7f-0000-4000-8000-000000000000";
const team = (names, parties) => ({ lineup_players: names.map((name, i) => ({ party_id: parties[i], player: { name, country: "SK", steam_id: String(i) } })) });
const lineup = { data: { matches_by_pk: {
  lineup_1: team(["rdo1337", "AREDONE", "Hrdina", "Killua", "Vlasticekk"], ["p1", "p1", "s1", "p2", "p2"]),
  lineup_2: team(["hidan", "Sannis Livisa enjoyer", "xBUGx", "Sevollta", "Torturak"], ["p3", "p3", "p3", "s2", "s3"]) } } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1140, height: 1500 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const sync = { on: true, rating: 1.02, ratingAuto: true, myElo: null, ratingLow: 0.52, ratingHigh: 1.41 };
    const area = (data) => ({ get: (d, cb) => cb({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in data).map((k) => [k, data[k]])) }), set: () => {} });
    window.chrome = { runtime: { id: "demo" }, storage: { sync: area(sync), local: area({}), onChanged: { addListener() {} } } };
  });
  let calls = 0;
  await page.route("https://karasu.live/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(path.join(__dirname, "match-finished.html")) }));
  await page.route("https://api.karasu.live/**", (r) => {
    calls++;
    const body = r.request().postData() || "";
    r.fulfill({ contentType: "application/json", body: JSON.stringify(body.includes("matches_by_pk") ? lineup : { data: { v_player_match_map_hltv: [] } }) });
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(MATCH);
  await page.addScriptTag({ path: path.join(__dirname, "..", "model.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "content.js") });
  await page.locator("[data-kee-box]").waitFor();
  await page.waitForTimeout(1200);
  console.log(await page.evaluate(() => ({
    chips: [...document.querySelector("[data-kee-box]").shadowRoot.querySelectorAll(".chip")].map((c) => c.querySelector(".nm").textContent + ":" + (c.querySelector(".pty")?.textContent || "-")).join(" "),
    rows: [...document.querySelectorAll('[data-kee-row="party"]')].map((x) => x.closest("li").querySelector(".match-overview__player-name").textContent.trim() + ":" + x.shadowRoot.querySelector(".pty").textContent).join(" "),
  })), "API calls:", calls);
  await page.screenshot({ path: path.join(__dirname, "parties.png"), fullPage: true });
  await browser.close();
})();
