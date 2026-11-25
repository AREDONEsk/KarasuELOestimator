(() => {
  const M = globalThis.KarasuEloModel;
  const BOX = "data-kee-box";
  const RANGE = { bad: 0.6, great: 1.6 };

  let settings = { on: true, rating: 1.0, ratingAuto: false, myElo: null };
  let lastKey = "";


  // ---------- reading the page ----------
  const ELO_INLINE = /^(\d{1,3}(?:[ ,.'\u00a0\u2009\u202f]?\d{3})*)\s*elo$/i;
  const toInt = (s) => parseInt(s.replace(/\D/g, ""), 10);
  // A player's Elo change in Karasu's scoreboard, e.g. "+44" or "-19".
  const DELTA = /^([+\-−])\s?(\d{1,3})$/;

  // Karasu keeps hidden copies of some Elo text in the page; only read what's actually on screen.
  const visible = (el) => (el.checkVisibility
    ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })
    : el.offsetParent !== null);

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
  // Values inside one element: the smallest visible elements whose whole text matches `re`.
  function valuesIn(root, re, read) {
    const clean = (el) => el.textContent.replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest(`[${BOX}]`)) continue;
      const m = clean(el).match(re);
      if (!m) continue;
      if ([...el.children].some((ch) => re.test(clean(ch)))) continue; // a smaller element holds it
      if (!visible(el)) continue;
      const v = read(m);
      if (v !== null) out.push(v);
    }
    return out;
  }
  const elosIn = (root) => valuesIn(root, ELO_INLINE, (m) => { const v = toInt(m[1]); return v < 10000 ? v : null; });

  // Player names in one overview card: the first piece of text in each player's identity block.
  function namesIn(card) {
    const names = [];
    for (const id of card.querySelectorAll(".match-overview__identity")) {
      const w = document.createTreeWalker(id, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const v = t.nodeValue.trim();
        if (v) { names.push(v); break; }
      }
    }
    return names;
  }

  // Finished match. The overview cards show each player's Elo as it is *now*, which drifts as
  // they play more games. The scoreboard (a separate view on Karasu) has their Elo right after
  // this match plus the change ("+44"), so pre-match Elo = that Elo - change. The scoreboard and
  // the overview are never on screen together, so rows are saved per match when the scoreboard
  // is open and used once you're back on the overview.
  const SB_KEY = "scoreboards";
  const SB_KEEP = 50;
  let saved = {};
  const matchId = () => location.pathname;

  // Each scoreboard row: its text (holds the player's name) and that player's pre-match Elo.
  function readScoreboardRows() {
    const rows = [];
    for (const tr of document.querySelectorAll("table.match-scoreboard tr")) {
      const badge = [...tr.querySelectorAll("span")]
        .find((sp) => !sp.children.length && DELTA.test(sp.textContent.trim()));
      if (!badge) continue;
      const m = badge.textContent.trim().match(DELTA);
      const delta = (m[1] === "+" ? 1 : -1) * Number(m[2]);
      const elo = elosIn(tr)[0];
      if (elo === undefined) continue;
      rows.push({ text: tr.textContent.replace(/\s+/g, " ").trim().slice(0, 80), pre: elo - delta });
    }
    return rows;
  }

  function rememberScoreboard() {
    const rows = readScoreboardRows();
    if (!rows.length) return;
    const id = matchId();
    if (JSON.stringify(saved[id]?.rows) === JSON.stringify(rows)) return;
    saved[id] = { at: Date.now(), rows };
    const ids = Object.keys(saved).sort((a, b) => saved[b].at - saved[a].at);
    for (const old of ids.slice(SB_KEEP)) delete saved[old];
    chrome.storage.local.set({ [SB_KEY]: saved });
  }

  // [avgTeam0, avgTeam1] from the live or saved scoreboard, matched to teams by player name,
  // or null if this match's scoreboard hasn't been seen yet.
  function scoreboardPre(teams) {
    const live = readScoreboardRows();
    const rows = live.length ? live : saved[matchId()]?.rows;
    if (!rows) return null;
    const names = teams.map((t) => namesIn(t.card));
    const pre = [[], []];
    for (const row of rows) {
      // The team whose longest player name appears in this row (longest, so "mls" can't steal a longer name's row).
      let best = -1, bestLen = 0;
      names.forEach((list, i) => list.forEach((n) => {
        if (n.length > bestLen && row.text.includes(n)) { best = i; bestLen = n.length; }
      }));
      if (best >= 0) pre[best].push(row.pre);
    }
    if (pre.some((p) => !p.length)) return null;
    return pre.map((p) => p.reduce((a, b) => a + b, 0) / p.length);
  }

  // Preferred: Karasu's match overview has one <article class="match-overview__team"> per team.
  function readFromOverview() {
    const cards = [...document.querySelectorAll("article.match-overview__team")];
    if (cards.length !== 2) return null;
    const teams = cards.map((card) => ({
      header: card.querySelector("header.match-overview__heading") || card.firstElementChild,
      name: (card.querySelector("h2, h3") || {}).textContent?.trim() || "Team",
      elos: elosIn(card.querySelector(".match-overview__roster") || card).slice(0, 5),
      card,
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
    .lvl { display: inline-block; margin: 3px 0 2px; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; font-weight: 700; letter-spacing: .03em; color: var(--lc);
      background: color-mix(in srgb, var(--lc) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--lc) 30%, transparent); }
    .lvl.ult { background-image: linear-gradient(100deg, #0ea5c9, #67e8f9 35%, #fff 50%, #67e8f9 65%, #0ea5c9);
      background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
      box-shadow: 0 0 8px rgba(14,165,201,.35); animation: shine 2.4s linear infinite, zap 3.4s infinite; }
    @keyframes shine { to { background-position: -220% 0; } }
    @keyframes zap { 0%, 85%, 89%, 100% { filter: none; } 87%, 91% { filter: brightness(2) drop-shadow(0 0 6px #67e8f9); } }
    .lvl.l10 { background-image: linear-gradient(100deg, #f59e0b, #fbbf24 35%, #fde68a 50%, #fb923c 65%, #f59e0b);
      background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
      animation: shine 4s linear infinite, flame 2.6s ease-in-out infinite; }
    @keyframes flame { 0%, 100% { box-shadow: 0 0 4px rgba(245,158,11,.25); } 30% { box-shadow: 0 0 8px rgba(249,115,22,.4); }
      75% { box-shadow: 0 0 7px rgba(251,191,36,.35); } }
    .proj { margin-top: 6px; font-size: 10.5px; font-weight: 600; color: #a1a1aa; font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .me { --lc: #8a8b96; display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 10px 14px;
      border-radius: 12px; border: 1px solid rgba(255,255,255,.07);
      background: radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--lc) 12%, transparent), transparent 55%),
                  linear-gradient(180deg, #16181f, #0f1116);
      font: 600 12px/1.3 "Segoe UI", Inter, system-ui, sans-serif; color: #e7e7ea; animation: in .35s ease-out both; }
    .hex { position: relative; width: 32px; height: 35px; flex: none;
      filter: drop-shadow(0 0 6px color-mix(in srgb, var(--lc) 45%, transparent)); }
    .hex svg { display: block; width: 100%; height: 100%; }
    .hex path { fill: color-mix(in srgb, var(--lc) 18%, #111319); stroke: var(--lc); stroke-width: 2.5; }
    .hex span { position: absolute; inset: 0; display: grid; place-items: center; color: var(--lc); font-size: 13px; font-weight: 800; }
    .me .info { flex: 1; min-width: 0; }
    .me .name span { color: var(--lc); font-size: 14px; font-weight: 800; }
    .me .name small { margin-left: 8px; color: #8a8b96; font-size: 11px; font-weight: 600; }
    .me .bar { height: 4px; margin: 5px 0 3px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
    .me .bar i { display: block; height: 100%; border-radius: 3px; background: var(--lc); box-shadow: 0 0 6px var(--lc); }
    .me .next { font-size: 10.5px; font-weight: 500; color: #7a7b86; }
    .me.ult .name span { background-image: linear-gradient(100deg, #0ea5c9, #67e8f9 35%, #fff 50%, #67e8f9 65%, #0ea5c9);
      background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
      animation: shine 2.4s linear infinite; }
    .me.ult .hex { animation: zap 3.4s infinite; }
    .me.l10 .name span { background-image: linear-gradient(100deg, #f59e0b, #fbbf24 35%, #fde68a 50%, #fb923c 65%, #f59e0b);
      background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
      animation: shine 4s linear infinite; }
    .me.l10 .hex { animation: flameh 2.6s ease-in-out infinite; }
    @keyframes flameh { 0%, 100% { filter: drop-shadow(0 0 5px rgba(245,158,11,.4)); }
      30% { filter: drop-shadow(0 0 9px rgba(249,115,22,.55)); } 75% { filter: drop-shadow(0 0 8px rgba(251,191,36,.5)); } }
    @media (prefers-reduced-motion: reduce) { .lvl.ult, .lvl.l10, .me, .me .name span, .me .hex { animation: none; } }

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

  // Your Elo as last read from Karasu's sidebar, or null if it hasn't been seen yet.
  const myElo = () => {
    const v = settings.myElo;
    return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
  };

  const HEX = "M21 2 39 12.5v21L21 44 3 33.5v-21Z";
  const tierClass = (label) => (label === "Ultimate" ? "ult" : label === "Level 10" ? "l10" : "");

  // Where a win or loss would leave you: "→ 1,646 · Level 5", or "▼ Level 4" if it changes level.
  function proj(elo, change) {
    const after = Math.max(0, elo + change);
    const was = M.level(elo), now = M.level(after);
    const p = h("div", "proj", `→ ${after.toLocaleString()} · `);
    const lb = h("b", "", now.label === was.label ? now.label : `${change > 0 ? "▲" : "▼"} ${now.label}`);
    lb.style.color = now.color;
    p.append(lb);
    return p;
  }

  // Your badge, level and progress, shown above the two team cards.
  function meStrip(elo) {
    const lv = M.level(elo);
    const box = h("div", `me ${tierClass(lv.label)}`);
    box.style.setProperty("--lc", lv.color);
    const hex = h("div", "hex");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 42 46");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", HEX);
    svg.append(path);
    hex.append(svg, h("span", "", lv.next ? lv.label.replace("Level ", "") : "★"));
    const name = h("div", "name");
    name.append(h("span", "", lv.label), h("small", "", `You · ${elo.toLocaleString()} Elo`));
    const bar = h("div", "bar");
    const fill = h("i");
    fill.style.width = `${lv.next ? ((elo - lv.min) / (lv.next.at - lv.min)) * 100 : 100}%`;
    bar.append(fill);
    const info = h("div", "info");
    info.append(name, bar, h("div", "next", lv.next ? `${lv.next.toGo} Elo to ${lv.next.label}` : "Top level reached"));
    box.append(hex, info);
    return box;
  }

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

  function buildCard(team, ownAvg, enemyAvg, finished, approx) {
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
    const lv = M.level(ownAvg);
    const num = h("b", "", String(Math.round(ownAvg)));
    num.style.color = lv.color;
    const pill = h("span", "lvl", lv.label);
    pill.style.setProperty("--lc", lv.color);
    if (lv.next) pill.title = `${lv.next.toGo} Elo to ${lv.next.label}`;
    else pill.classList.add("ult");
    if (lv.label === "Level 10") pill.classList.add("l10");
    const tagRow = h("div");
    tagRow.append(pill);
    avg.append(h("div", "lbl", "Team avg"), num, tagRow,
               h("small", "", `${diff >= 0 ? "+" : ""}${diff} vs enemy`));
    const head = h("div", "head");
    head.append(left, avg);

    const split = h("div", "split");
    const fill = h("i");
    fill.style.width = `${pct}%`;
    split.append(fill);

    const tiles = h("div", "tiles");
    // Win: a bad game gains least, a great game most. Loss: a great game loses least.
    const tw = tile("w", "If you win", "+", now.win, bad.win, great.win);
    const tl = tile("l", "If you lose", "−", now.loss, bad.loss, great.loss);
    const me = myElo();
    if (me !== null && !finished) { tw.append(proj(me, now.win)); tl.append(proj(me, -now.loss)); }
    tiles.append(tw, tl);

    const foot = h("div", "foot");
    foot.append("At your ", h("b", "", r.toFixed(2)), " HLTV rating · ends = 0.6 to 1.6 game");
    card.append(h("div", "team", team.name), head, split, tiles, foot);
    if (approx) card.append(h("div", "note", "Match finished: approximate, using players' current Elo. Open the Scoreboard once, then come back here for the exact pre-match numbers."));
    else if (finished) card.append(h("div", "note", "Match finished: using each player's Elo from before the match."));
    return card;
  }

  // One panel with both teams, placed just above Karasu's overview section.
  function drawPanel(teams, avg, finished, approx) {
    const section = document.querySelector("section.match-overview");
    if (!section) return;
    const host = document.createElement("div");
    host.setAttribute(BOX, "");
    host.title = "Unofficial estimate based on real Karasu matches, usually within 1–2 Elo.";
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", "", CSS));
    const grid = h("div", "grid");
    grid.append(buildCard(teams[0], avg[0], avg[1], finished, approx), buildCard(teams[1], avg[1], avg[0], finished, approx));
    if (myElo() !== null) root.append(meStrip(myElo()));
    root.append(grid);
    section.insertAdjacentElement("beforebegin", host);
  }

  function refresh(force) {
    const old = document.querySelectorAll(`[${BOX}]`);
    rememberMyElo();
    rememberMyRating();
    if (!settings.on) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    rememberScoreboard();
    const { teams, finished } = readTeams();
    if (teams.length !== 2) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    // Finished match: rebuild pre-match Elo from the scoreboard. If it can't be read, fall back
    // to the overview's (current) Elo and mark the estimate approximate.
    const shownAvg = (t) => t.elos.reduce((a, b) => a + b, 0) / t.elos.length;
    const pre = finished ? scoreboardPre(teams) : null;
    const exact = !!pre;
    const avg = pre || teams.map(shownAvg);
    const approx = finished && !exact;
    const key = `${avg}|${finished}|${approx}|${settings.rating}|${settings.myElo}`;
    if (!force && key === lastKey && old.length === 1 && old[0].isConnected) return;
    old.forEach((b) => b.remove());
    drawPanel(teams, avg, finished, approx);
    lastKey = key;
  }

  // Your own Elo, from the user block at the bottom of Karasu's left sidebar:
  //   <button aria-label="ELO, primary Level 3 894"><span>894</span></button>
  // Other players can get the same button, so take the visible one lowest down the left edge.
  // Karasu removes the sidebar on narrow windows; then nothing is read and the last value stays.
  let meBlock = null; // your sidebar user block, once found
  function readMyElo() {
    let best = null, bestTop = -1;
    for (const b of document.querySelectorAll('button[aria-label^="ELO"]')) {
      if (b.closest(`[${BOX}]`) || !visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.left > 340 || r.top < innerHeight * 0.5 || r.top < bestTop) continue;
      const v = toInt(b.textContent);
      if (Number.isFinite(v) && v < 10000) {
        best = v; bestTop = r.top;
        meBlock = b.closest(".min-w-0:has(.truncate)") || b.parentElement?.parentElement?.parentElement;
      }
    }
    return best;
  }

  // Save it when it changes; note when it was last seen at most once a minute.
  let seenWritten = 0;
  function rememberMyElo() {
    const v = readMyElo();
    if (v === null) return;
    const now = Date.now();
    if (v !== settings.myElo) {
      settings.myElo = v;
      chrome.storage.sync.set({ myElo: v });
    } else if (now - seenWritten < 60000) return;
    seenWritten = now;
    chrome.storage.local.set({ myEloSeen: now });
  }

  // Your name, from the sidebar block: <div class="truncate min-w-0"><span>AREDONE</span></div>.
  const myName = () => meBlock?.querySelector(".truncate")?.textContent.trim() || null;

  // True only on your own profile (/players/<your Steam ID>). The sidebar's "My Stats" link points
  // there if Karasu gives it an address; otherwise the profile must show your sidebar name.
  function onMyProfile() {
    const m = location.pathname.match(/^\/players\/([^/?#]+)/);
    if (!m) return false;
    for (const a of document.querySelectorAll('a[href*="/players/"]')) {
      if (/my stats/i.test(a.textContent)) return a.getAttribute("href").split("/players/")[1].split(/[/?#]/)[0] === m[1];
    }
    const name = myName();
    if (!name) return false;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (t.nodeValue.trim() === name && !meBlock.contains(t) && !t.parentElement.closest(`[${BOX}]`)) return true;
    }
    return false;
  }

  // Your average HLTV rating over the last 30 games, from your profile's "Last 30 games" box:
  //   <div class="profile-form-tile"><dt>Rating</dt><dd>1.03 <span>Average</span></dd></div>
  let ratingSeenWritten = 0;
  function rememberMyRating() {
    if (!onMyProfile()) return;
    const tile = [...document.querySelectorAll(".profile-form-tile")]
      .find((t) => /^rating$/i.test(t.querySelector("dt")?.textContent.trim() || ""));
    const m = tile?.querySelector("dd")?.textContent.match(/\d+\.\d+/);
    if (!m) return;
    const r = Math.round(Math.min(2.5, Math.max(0.3, Number(m[0]))) * 100) / 100;
    const now = Date.now();
    if (r !== settings.rating || !settings.ratingAuto) {
      settings.rating = r;
      settings.ratingAuto = true;
      chrome.storage.sync.set({ rating: r, ratingAuto: true });
    } else if (now - ratingSeenWritten < 60000) return;
    ratingSeenWritten = now;
    chrome.storage.local.set({ ratingSeen: now });
  }

  // Karasu is a single-page app: re-check when the page changes, at most ~4 times a second.
  let pending = false;
  new MutationObserver((records) => {
    if (records.every((r) => r.target.closest && r.target.closest(`[${BOX}]`))) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; refresh(false); }, 250);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  chrome.storage.local.get({ [SB_KEY]: {} }, (v) => { saved = v[SB_KEY] || {}; refresh(true); });
  chrome.storage.sync.get({ on: true, rating: 1.0, ratingAuto: false, myElo: null }, (v) => { settings = v; refresh(true); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k of Object.keys(c)) settings[k] = c[k].newValue;
    refresh(true);
  });
})();
