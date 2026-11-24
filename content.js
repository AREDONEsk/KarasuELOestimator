(() => {
  const M = globalThis.KarasuEloModel;
  const BOX = "data-kee-box";
  const RANGE = { bad: 0.6, great: 1.6 };

  let settings = { on: true, rating: 1.0 };
  let lastKey = "";


  // ---------- reading the page ----------
  const ELO_INLINE = /^(\d{1,3}(?:[ ,.'\u00a0\u2009\u202f]?\d{3})*)\s*elo$/i;
  const toInt = (s) => parseInt(s.replace(/\D/g, ""), 10);

  // Karasu shows "Live" or "Finished" in the match panel's status line; fall back to any "Finished" label.
  const isFinished = () => {
    const status = document.querySelector(".match-room__panel-context");
    if (status) return /finished/i.test(status.textContent);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (/^finished$/i.test(n.nodeValue.trim()) && !n.parentElement.closest(`[${BOX}]`)) return true;
    }
    return false;
  };

  // Elo values inside one element: the smallest elements whose whole text is like "1,280 Elo".
  function elosIn(root) {
    const clean = (el) => el.textContent.replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest(`[${BOX}]`)) continue;
      const m = clean(el).match(ELO_INLINE);
      if (!m) continue;
      if ([...el.children].some((ch) => ELO_INLINE.test(clean(ch)))) continue; // a smaller element holds it
      const v = toInt(m[1]);
      if (v < 10000) out.push(v);
    }
    return out;
  }

  // Preferred: Karasu's match overview has one <article class="match-overview__team"> per team.
  function readFromOverview() {
    const cards = [...document.querySelectorAll("article.match-overview__team")];
    if (cards.length !== 2) return null;
    const teams = cards.map((card) => ({
      header: card.querySelector("header.match-overview__heading") || card.firstElementChild,
      name: (card.querySelector("h2, h3") || {}).textContent?.trim() || "Team",
      elos: elosIn(card.querySelector(".match-overview__roster") || card).slice(0, 5),
    }));
    return teams.every((t) => t.header && t.elos.length) ? teams : null;
  }

  function readTeams() {
    const teams = readFromOverview() || [];
    return { teams, finished: isFinished() };
  }

  // ---------- drawing ----------
  // Each box lives in a shadow root, so Karasu's own CSS can't bend it and ours can't leak.
  const CSS = `
    :host { all: initial; display: block; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .team { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .note { margin-top: 8px; font-size: 10.5px; font-weight: 500; color: #a1a1aa; }
    .card { --c: #4ade80; --c2: rgba(74,222,128,.14);
      position: relative; width: 100%; box-sizing: border-box;
      padding: 12px 14px 11px; border-radius: 12px; overflow: hidden;
      background: radial-gradient(120% 140% at 0% 0%, var(--c2), transparent 55%),
                  linear-gradient(180deg, #16181f, #0f1116);
      border: 1px solid rgba(255,255,255,.07);
      box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04);
      font: 600 12px/1.3 "Segoe UI", Inter, system-ui, sans-serif; color: #e7e7ea;
      animation: in .35s ease-out both; }
    .card.bad { --c: #f87171; --c2: rgba(248,113,113,.14); }
    .card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      background: var(--c); box-shadow: 0 0 12px var(--c); }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } }

    .head { display: flex; align-items: flex-end; justify-content: space-between; }
    .lbl { font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: #8a8b96; font-weight: 700; }
    .pct { font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: var(--c);
      text-shadow: 0 0 18px var(--c2); line-height: 1; margin-top: 3px; font-variant-numeric: tabular-nums; }
    .avg { text-align: right; }
    .avg b { display: block; font-size: 15px; color: #fff; margin-top: 3px; font-variant-numeric: tabular-nums; }
    .avg small { color: #6f707b; font-weight: 500; font-size: 10.5px; }

    .split { position: relative; height: 6px; margin: 10px 0 11px; border-radius: 4px;
      background: rgba(255,255,255,.08); overflow: hidden; }
    .split i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--c);
      box-shadow: 0 0 10px var(--c); animation: grow .6s cubic-bezier(.2,.8,.2,1) both; }
    .split::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px;
      background: rgba(255,255,255,.35); }
    @keyframes grow { from { width: 0 !important; } }

    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { padding: 8px 10px 9px; border-radius: 9px; border: 1px solid; }
    .tile.w { background: rgba(74,222,128,.07); border-color: rgba(74,222,128,.18); }
    .tile.l { background: rgba(248,113,113,.07); border-color: rgba(248,113,113,.18); }
    .big { font-size: 21px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .w .big { color: #4ade80; } .l .big { color: #f87171; }
    .meter { position: relative; height: 4px; margin: 7px 0 4px; border-radius: 3px; }
    .w .meter { background: linear-gradient(90deg, rgba(74,222,128,.15), rgba(74,222,128,.55)); }
    .l .meter { background: linear-gradient(90deg, rgba(248,113,113,.15), rgba(248,113,113,.55)); }
    .meter b { position: absolute; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
      border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px #0f1116, 0 0 8px rgba(255,255,255,.6); }
    .ends { display: flex; justify-content: space-between; font-size: 10px; font-weight: 500; color: #7a7b86;
      font-variant-numeric: tabular-nums; }
    .foot { margin-top: 9px; font-size: 10px; font-weight: 500; color: #62636e; }
    .foot b { color: #a1a1aa; font-weight: 600; }
    @media (prefers-reduced-motion: reduce) { .card, .split i { animation: none; } }`;

  const h = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };

  // Marker position of `at` inside [lo, hi], as a percentage.
  const pos = (at, lo, hi) => (hi === lo ? 50 : Math.max(0, Math.min(100, ((at - lo) / (hi - lo)) * 100)));

  function tile(kind, label, sign, at, worst, best) {
    const t = h("div", `tile ${kind}`);
    t.append(h("div", "lbl", label), h("div", "big", `${sign}${at}`));
    const m = h("div", "meter");
    const dot = h("b");
    dot.style.left = `${pos(at, worst, best)}%`;
    m.append(dot);
    const ends = h("div", "ends");
    ends.append(h("span", "", `${sign}${worst}`), h("span", "", `${sign}${best}`));
    t.append(m, ends);
    return t;
  }

  function buildCard(team, ownAvg, enemyAvg, finished) {
    const card = h("div", "card");
    const r = settings.rating;
    const now = M.estimate(ownAvg, enemyAvg, r);
    const bad = M.estimate(ownAvg, enemyAvg, RANGE.bad);
    const great = M.estimate(ownAvg, enemyAvg, RANGE.great);
    const pct = Math.round(now.chance * 100);
    if (pct < 50) card.classList.add("bad");

    const left = h("div");
    left.append(h("div", "lbl", "Win chance"), h("div", "pct", `${pct}%`));
    const avg = h("div", "avg");
    const diff = Math.round(ownAvg - enemyAvg);
    avg.append(h("div", "lbl", "Team avg"), h("b", "", String(Math.round(ownAvg))),
               h("small", "", `${diff >= 0 ? "+" : ""}${diff} vs enemy`));
    const head = h("div", "head");
    head.append(left, avg);

    const split = h("div", "split");
    const fill = h("i");
    fill.style.width = `${pct}%`;
    split.append(fill);

    const tiles = h("div", "tiles");
    // Win: a bad game gains least, a great game most. Loss: a great game loses least.
    tiles.append(tile("w", "If you win", "+", now.win, bad.win, great.win),
                 tile("l", "If you lose", "−", now.loss, bad.loss, great.loss));

    const foot = h("div", "foot");
    foot.append("At your ", h("b", "", r.toFixed(2)), " HLTV rating · ends = 0.6 to 1.6 game");
    card.append(h("div", "team", team.name), head, split, tiles, foot);
    if (finished) card.append(h("div", "note", "Match finished: Elo shown already includes the result, so this is approximate."));
    return card;
  }

  // One panel with both teams, placed just above Karasu's overview section.
  function drawPanel(teams, avg, finished) {
    const section = document.querySelector("section.match-overview");
    if (!section) return;
    const host = document.createElement("div");
    host.setAttribute(BOX, "");
    host.title = "Unofficial estimate based on real Karasu matches, usually within 1–2 Elo.";
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", "", CSS));
    const grid = h("div", "grid");
    grid.append(buildCard(teams[0], avg[0], avg[1], finished), buildCard(teams[1], avg[1], avg[0], finished));
    root.append(grid);
    section.insertAdjacentElement("beforebegin", host);
  }

  function refresh(force) {
    const old = document.querySelectorAll(`[${BOX}]`);
    if (!settings.on) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    const { teams, finished } = readTeams();
    if (teams.length !== 2) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    const avg = teams.map((t) => t.elos.reduce((a, b) => a + b, 0) / t.elos.length);
    const key = `${avg}|${finished}|${settings.rating}`;
    if (!force && key === lastKey && old.length === 1 && old[0].isConnected) return;
    old.forEach((b) => b.remove());
    drawPanel(teams, avg, finished);
    lastKey = key;
  }

  // Karasu is a single-page app: re-check when the page changes, at most ~4 times a second.
  let pending = false;
  new MutationObserver((records) => {
    if (records.every((r) => r.target.closest && r.target.closest(`[${BOX}]`))) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; refresh(false); }, 250);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  chrome.storage.sync.get({ on: true, rating: 1.0 }, (v) => { settings = v; refresh(true); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k of Object.keys(c)) settings[k] = c[k].newValue;
    refresh(true);
  });
})();
