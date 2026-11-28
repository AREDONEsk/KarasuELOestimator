(() => {
  const M = globalThis.KarasuEloModel;
  const BOX = "data-kee-box";
  const RANGE = { bad: 0.6, great: 1.69 };

  let settings = { on: true, rating: 1.0, ratingAuto: false, myElo: null, ratingLow: null, ratingHigh: null };
  let lastKey = "";

  // After the extension is reloaded or updated, this copy of the script keeps running in tabs that
  // were already open but can no longer reach chrome.storage ("Extension context invalidated").
  // Every storage write goes through save(), which does nothing then instead of throwing.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const save = (area, data) => {
    if (!alive()) return;
    try { chrome.storage[area].set(data); } catch { /* extension reloaded meanwhile */ }
  };


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
    save("local", { [SB_KEY]: saved });
  }

  // { avg: [avgTeam0, avgTeam1], byName: Map(player name -> pre-match Elo) } from the live or saved
  // scoreboard, matched to teams by player name, or null if this match's scoreboard hasn't been seen yet.
  function scoreboardPre(teams) {
    const live = readScoreboardRows();
    const rows = live.length ? live : saved[matchId()]?.rows;
    if (!rows) return null;
    const names = teams.map((t) => namesIn(t.card));
    const pre = [[], []];
    const byName = new Map();
    for (const row of rows) {
      // The team whose longest player name appears in this row (longest, so "mls" can't steal a longer name's row).
      let best = -1, bestLen = 0, bestName = "";
      names.forEach((list, i) => list.forEach((n) => {
        if (n.length > bestLen && row.text.includes(n)) { best = i; bestLen = n.length; bestName = n; }
      }));
      if (best >= 0) { pre[best].push(row.pre); byName.set(bestName, row.pre); }
    }
    if (pre.some((p) => !p.length)) return null;
    return { avg: pre.map((p) => p.reduce((a, b) => a + b, 0) / p.length), byName };
  }

  // Each player in one overview card: name, shown Elo, and Karasu's own last-30 HLTV rating with
  // how many games it covers, from
  //   <li class="match-overview__player"> ... <button class="match-overview__player-name">Name</button>
  //   ... 1,525 Elo ... <dl class="match-overview__history" aria-label="Based on 30 completed matches, ...">
  //   <div class="match-overview__rating"><dt>Rating</dt><dd>1.50</dd></div>
  function playersIn(card) {
    const out = [];
    const names = namesIn(card);
    const rows = card.querySelectorAll(".match-overview__player, .match-overview__roster > li");
    [...new Set(rows)].forEach((li, i) => {
      const elo = elosIn(li)[0];
      if (elo === undefined) return;
      const name = li.querySelector(".match-overview__player-name")?.textContent.trim() || names[i] || "";
      const rating = parseFloat(li.querySelector(".match-overview__rating dd")?.textContent.replace(",", ".") || "");
      const hist = li.querySelector(".match-overview__history");
      const games = parseInt((hist?.getAttribute("aria-label") || hist?.title || "").match(/(\d+)\s+(?:completed\s+|rated\s+)?match/i)?.[1] ?? "", 10);
      out.push({ name, elo, rating: rating > 0 && rating < 5 ? rating : NaN, games });
    });
    return out.slice(0, 5);
  }

  // Preferred: Karasu's match overview has one <article class="match-overview__team"> per team.
  function readFromOverview() {
    const cards = [...document.querySelectorAll("article.match-overview__team")];
    if (cards.length !== 2) return null;
    const teams = cards.map((card) => ({
      header: card.querySelector("header.match-overview__heading") || card.firstElementChild,
      name: (card.querySelector("h2, h3") || {}).textContent?.trim() || "Team",
      elos: elosIn(card.querySelector(".match-overview__roster") || card).slice(0, 5),
      players: playersIn(card),
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
    .w .meter.rng { background: rgba(74,222,128,.13); } .l .meter.rng { background: rgba(248,113,113,.13); }
    .meter i { position: absolute; top: -2px; bottom: -2px; border-radius: 4px; }
    .w .meter i { background: #4ade80; box-shadow: 0 0 10px rgba(74,222,128,.55); }
    .l .meter i { background: #f87171; box-shadow: 0 0 10px rgba(248,113,113,.55); }
    .meter.rng b { width: 6px; height: 6px; margin: -3px 0 0 -3px; box-shadow: 0 0 0 2px #0f1116; }
    .fire { margin-left: 5px; letter-spacing: 0; font-size: 11px; filter: drop-shadow(0 0 4px rgba(251,146,60,.7)); }
    .big .to { font-size: 14px; font-weight: 700; color: #7a7b86; margin: 0 4px; }
    .ends { display: flex; justify-content: space-between; font-size: 10px; font-weight: 500; color: #7a7b86;
      font-variant-numeric: tabular-nums; }
    .foot { margin-top: 9px; font-size: 10px; font-weight: 500; color: #62636e; }
    .foot b { color: #a1a1aa; font-weight: 600; }
    .sub { font-size: 10.5px; font-weight: 600; color: #8a8b96; margin-top: 2px; }
    .sub b { font-weight: 800; }
    .avg small.fsub { display: block; margin-top: 2px; }
    .up-t { color: #4ade80; } .dn-t { color: #f87171; }
    .chips { display: flex; gap: 6px; margin: 10px 0 2px; }
    .chip { position: relative; flex: 1; min-width: 0; padding: 6px 7px 7px; border-radius: 8px; box-sizing: border-box;
      background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); font-variant-numeric: tabular-nums; }
    .chip.you { border-color: color-mix(in srgb, var(--lc) 45%, transparent); }
    .chip .cn { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: #e7e7ea; }
    .chip .nm { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip .hr { display: flex; align-items: center; gap: 4px; }
    .chip .hr .ht { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip .flag { margin-left: auto; flex: none; font-size: 12px; line-height: 1;
      font-family: "Twemoji Country Flags", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
    .chip .cw { font-size: 15px; font-weight: 800; margin-top: 2px; letter-spacing: -.01em; }
    .chip .ce { font-size: 9.5px; font-weight: 600; color: #7a7b86; margin-top: 1px; line-height: 1.35; }
    .chip .ce .hl { color: #d4d4d8; font-weight: 700; } .chip .ce .hl.hot { color: #fbbf24; } .chip .ce .hl.cold { color: #8a8b96; }
    .chip .mb { position: relative; height: 3px; border-radius: 2px; margin-top: 5px; background: rgba(255,255,255,.07); overflow: hidden; }
    .chip .mb i { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
    .mhex { position: relative; flex: none; width: 17px; height: 19px;
      filter: drop-shadow(0 0 4px color-mix(in srgb, var(--lc) 45%, transparent)); }
    .mhex svg { display: block; width: 100%; height: 100%; }
    .mhex path { fill: color-mix(in srgb, var(--lc) 18%, #111319); stroke: var(--lc); stroke-width: 3.5; }
    .mhex b { position: absolute; inset: 0; display: grid; place-items: center; color: var(--lc); font-size: 9px; font-weight: 800; }
    .legend { margin-top: 6px; }
    .chip { cursor: pointer; transition: border-color .15s, background .15s, box-shadow .15s; }
    .chip:hover { border-color: rgba(255,255,255,.22); }
    .chip:focus-visible { outline: 2px solid rgba(255,255,255,.5); outline-offset: 1px; }
    .chip.sel { border-color: rgba(255,255,255,.7); background: rgba(255,255,255,.07);
      box-shadow: 0 0 0 1px rgba(255,255,255,.35), 0 0 12px rgba(255,255,255,.12); }
    .tile .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

  // A win or loss tile. With your usual rating range known, the big number is the range of
  // Elo from your usual bad game to your usual good game, the meter highlights that band and
  // a small dot marks your average. Without it, one number and a dot at your average.
  function tile(kind, label, sign, at, worst, best, usual, flame) {
    const t = h("div", `tile ${kind}`);
    const big = h("div", "big");
    const m = h("div", "meter");
    if (usual) {
      // Same order as the bar: your weak game (left end side) first, your strong game second.
      const a = usual.lo, b = usual.hi;
      if (a === b) big.textContent = `${sign}${a}`;
      else big.append(`${sign}${a}`, h("span", "to", "to"), `${sign}${b}`);
      m.classList.add("rng");
      const band = h("i");
      const p1 = pos(usual.lo, worst, best), p2 = pos(usual.hi, worst, best);
      band.style.left = `${Math.min(p1, p2)}%`;
      band.style.width = `${Math.max(Math.abs(p2 - p1), 2)}%`;
      m.append(band);
    } else big.textContent = `${sign}${at}`;
    const lbl = h("div", "lbl", label);
    if (flame) {
      const f = h("span", "fire", "🔥");
      f.title = `Flame game (HLTV ${M.FLAME_RATING}+): the win is worked out as a 2.00 rating`;
      lbl.append(f);
    }
    t.append(lbl, big);
    const dot = h("b");
    dot.style.left = `${pos(at, worst, best)}%`;
    dot.title = `At your average: ${sign}${at}`;
    m.append(dot);
    const ends = h("div", "ends");
    ends.append(h("span", "", `${sign}${worst}`), h("span", "", `${sign}${best}`));
    t.append(m, ends);
    return t;
  }

  // Small level hexagon, like the big one in your strip.
  function miniHex(lv) {
    const hex = h("span", "mhex");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 42 46");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", HEX);
    svg.append(path);
    hex.append(svg, h("b", "", lv.next ? lv.label.replace("Level ", "") : "★"));
    return hex;
  }

  // One chip per player: level, name, how much win chance they add vs a team-average player
  // (using HLTV form), their Elo and last-30 HLTV, and their country flag bottom right.
  // Clicking a chip shows that player's win/lose Elo in the tiles above; clicking it again
  // (or your own chip) goes back to you.
  function playerChips(form, selected, onPick) {
    const wrap = h("div", "chips");
    const me = myName();
    for (const p of form.players) {
      const lv = M.level(p.pre);
      const isMe = !!me && p.name === me;
      const chip = h("div", "chip");
      if (isMe) chip.classList.add("you");
      const isSel = selected ? p.name === selected : isMe;
      if (isSel) chip.classList.add("sel");
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-pressed", String(isSel));
      const pick = () => onPick(isMe || p.name === selected ? null : p.name);
      chip.addEventListener("click", pick);
      chip.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
      chip.style.setProperty("--lc", lv.color);
      const n = h("div", "cn");
      n.append(miniHex(lv), h("span", "nm", p.name));
      const imp = Math.round(p.impact * 10) / 10;
      const w = h("div", `cw ${imp >= 0 ? "up-t" : "dn-t"}`, `${imp >= 0 ? "+" : "−"}${Math.abs(imp).toFixed(1)}%`);
      const e = h("div", "ce", `${Math.round(p.pre).toLocaleString()} Elo`);
      // HLTV row, with the country flag at its right end.
      const hr = h("div", "hr");
      const ht = h("span", "ht");
      if (Number.isFinite(p.rating)) {
        ht.append("HLTV ", h("b", `hl${p.rating >= 1.25 ? " hot" : p.rating < 0.95 ? " cold" : ""}`, p.rating.toFixed(2)));
      } else ht.append("HLTV –");
      hr.append(ht);
      const cc = lineupInfo(p.name)?.country;
      if (cc) {
        const f = h("span", "flag", flagEmoji(cc));
        f.title = countryName(cc);
        hr.append(f);
      }
      e.append(hr);
      const mb = h("div", "mb");
      const bar = h("i");
      const frac = Math.min(1, Math.abs(p.vsAvg) / 200) * 50;
      bar.style.cssText = p.vsAvg >= 0 ? `left:50%;width:${frac}%;background:#4ade80` : `right:50%;width:${frac}%;background:#f87171`;
      mb.append(bar);
      chip.title = `${p.name}: ${Number.isFinite(p.rating) ? `HLTV ${p.rating.toFixed(2)}` : "no HLTV rating"}`
        + `${Number.isFinite(p.games) ? ` over ${p.games} game${p.games === 1 ? "" : "s"}` : ""}`
        + `${Number.isFinite(p.games) && p.games < M.FORM_FULL_GAMES ? ` (counted as ${M.formRating(p.rating, p.games).toFixed(2)}: few games)` : ""}`
        + ` · form Elo ${Math.round(p.eff).toLocaleString()} · bar = form vs team average`
        + (isMe ? "" : isSel ? " · click to show yours again" : " · click to see their win/lose Elo");
      chip.append(n, w, e, mb);
      wrap.append(chip);
    }
    return wrap;
  }

  // The win/lose tiles and the line explaining them, for you (who = null) or for a player picked
  // from the chips. A picked player is worked out at their last-30 HLTV average (1.00 if Karasu
  // shows none), with their own usual range once it has loaded from Karasu's API.
  function rangeParts(ownAvg, enemyAvg, finished, who) {
    const other = who && Number.isFinite(who.rating) ? who.rating : 1;
    const r = who ? r2(other) : settings.rating;
    const now = M.estimate(ownAvg, enemyAvg, r);
    const theirs = who && playerRanges.get(lineupInfo(who.name)?.steam);
    const range = who ? (theirs && Number.isFinite(who.rating) ? [Math.min(theirs[0], r), Math.max(theirs[1], r)] : null) : usualRange();
    // Bar ends: a 0.6 and a 1.69 game, widened to take in the range and average, so the
    // range in the big number never sits outside the bar.
    const lowR = Math.min(RANGE.bad, r, ...(range ? [range[0]] : []));
    const highR = Math.max(RANGE.great, r, ...(range ? [range[1]] : []));
    const bad = M.estimate(ownAvg, enemyAvg, lowR);
    const great = M.estimate(ownAvg, enemyAvg, highR);
    const lo = range && M.estimate(ownAvg, enemyAvg, range[0]);
    const hi = range && M.estimate(ownAvg, enemyAvg, range[1]);

    const tiles = h("div", "tiles");
    // Win: a bad game gains least, a great game most. Loss: a great game loses least.
    // 🔥 when the average, or the top of your usual range, reaches the flame threshold.
    const flame = (range ? range[1] : r) >= M.FLAME_RATING;
    const nm = who ? who.name : "you";
    const tw = tile("w", `If ${nm} win${who ? "s" : ""}`, "+", now.win, bad.win, great.win, range && { lo: lo.win, hi: hi.win }, flame);
    const tl = tile("l", `If ${nm} lose${who ? "s" : ""}`, "−", now.loss, bad.loss, great.loss, range && { lo: lo.loss, hi: hi.loss });
    if (who) [tw, tl].forEach((t) => t.querySelector("b").title = `At ${who.name}'s ${r.toFixed(2)} average`);
    const elo = who ? Math.round(who.pre) : myElo();
    if (elo !== null && !finished) { tw.append(proj(elo, now.win)); tl.append(proj(elo, -now.loss)); }
    tiles.append(tw, tl);

    const foot = h("div", "foot");
    const ends = ` · ends = ${lowR.toFixed(2)} to ${highR.toFixed(2)} game`;
    if (who) {
      foot.append(h("b", "", who.name), range ? "'s usual HLTV " : " at ");
      if (range) foot.append(h("b", "", `${range[0].toFixed(2)}–${range[1].toFixed(2)}`), " · dot = their ", h("b", "", r.toFixed(2)), " average");
      else if (Number.isFinite(who.rating)) foot.append("their last-30 HLTV ", h("b", "", r.toFixed(2)),
        Number.isFinite(who.games) ? ` (${who.games} game${who.games === 1 ? "" : "s"})` : "");
      else foot.append("HLTV ", h("b", "", "1.00"), " (no rating shown)");
      foot.append(`${ends} · click again for yours`);
    } else if (range) foot.append("Your usual HLTV ", h("b", "", `${range[0].toFixed(2)}–${range[1].toFixed(2)}`),
      " · dot = your ", h("b", "", r.toFixed(2)), ` average${ends}`);
    else foot.append("At your ", h("b", "", r.toFixed(2)), ` HLTV rating${ends}`);
    return { tiles, foot };
  }

  // Which chip is picked in each team card, kept across redraws until you leave the match page.
  const picked = { path: "", names: [null, null] };
  const pickedFor = (i) => (picked.path === location.pathname ? picked.names[i] : null);
  function setPicked(i, name) {
    if (picked.path !== location.pathname) picked.names = [null, null];
    picked.path = location.pathname;
    picked.names[i] = name;
  }

  function buildCard(team, ownAvg, enemyAvg, finished, approx, form, idx) {
    const card = h("div", "card");
    const now = M.estimate(ownAvg, enemyAvg, settings.rating);
    // The big win chance uses HLTV form when Karasu shows ratings; the win/lose tiles stay on plain
    // Elo, because Karasu works out the Elo change from plain Elo averages.
    const eloPct = Math.round(now.chance * 100);
    const pct = form ? Math.round(M.winChance(form.own, form.enemy) * 100) : eloPct;
    if (pct < 50) card.classList.add("bad");

    const left = h("div");
    left.append(h("div", "lbl", "Win chance"), h("div", "pct", `${pct}%`));
    if (form) {
      const d = pct - eloPct;
      const sub = h("div", "sub", `Elo only ${eloPct}% · HLTV form `);
      sub.append(h("b", d >= 0 ? "up-t" : "dn-t", `${d >= 0 ? "+" : "−"}${Math.abs(d)}%`));
      sub.title = "Win chance with each player's Elo adjusted for their last-30 HLTV rating (0.10 HLTV ≈ 50 Elo)";
      left.append(sub);
    }
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
    if (form) {
      const fd = Math.round(form.own - form.enemy);
      avg.append(h("small", "fsub", `form avg ${Math.round(form.own)} · ${fd >= 0 ? "+" : ""}${fd} vs enemy`));
    }
    const head = h("div", "head");
    head.append(left, avg);

    const split = h("div", "split");
    const fill = h("i");
    fill.style.width = `${pct}%`;
    split.append(fill);

    // A picked player the page no longer shows falls back to you.
    const whoFor = (name) => (name && form?.players.find((p) => p.name === name)) || null;
    let who = whoFor(pickedFor(idx));
    let { tiles, foot } = rangeParts(ownAvg, enemyAvg, finished, who);
    card.append(h("div", "team", team.name), head, split, tiles);
    if (form && form.players.length) {
      // Picking a chip swaps only the tiles, chips and footer line, so nothing else re-animates.
      let chips;
      const pick = (name, again) => {
        if (!again) setPicked(idx, name);
        else if (pickedFor(idx) !== name || !card.isConnected) return;
        who = whoFor(name);
        if (who && !again) loadPlayerRange(lineupInfo(who.name)?.steam).then((got) => got && pick(name, true));
        const next = rangeParts(ownAvg, enemyAvg, finished, who);
        tiles.replaceWith(next.tiles); foot.replaceWith(next.foot);
        ({ tiles, foot } = next);
        const c = playerChips(form, who && who.name, pick);
        chips.replaceWith(c); chips = c;
        if (!again) chips.querySelector(".chip.sel")?.focus({ preventScroll: true });
      };
      chips = playerChips(form, who && who.name, pick);
      if (who) loadPlayerRange(lineupInfo(who.name)?.steam).then((got) => got && pick(who.name, true));
      card.append(chips);
      const legend = h("div", "foot legend", "Impact = Elo + last-30 HLTV form (0.10 HLTV ≈ 50 Elo) · click a player to see their win/lose Elo");
      card.append(legend);
    }
    card.append(foot);
    if (approx) card.append(h("div", "note", "Match finished: approximate, using players' current Elo. Open the Scoreboard once, then come back here for the exact pre-match numbers."));
    else if (finished) card.append(h("div", "note", "Match finished: using each player's Elo from before the match."));
    return card;
  }

  // One panel with both teams, placed just above Karasu's overview section.
  function drawPanel(teams, avg, finished, approx, forms) {
    const section = document.querySelector("section.match-overview");
    if (!section) return;
    const host = document.createElement("div");
    host.setAttribute(BOX, "");
    host.title = "Unofficial estimate based on real Karasu matches, usually within 1–2 Elo.";
    const root = host.attachShadow({ mode: "open" });
    root.append(h("style", "", CSS));
    const grid = h("div", "grid");
    grid.append(buildCard(teams[0], avg[0], avg[1], finished, approx, forms && forms[0], 0),
                buildCard(teams[1], avg[1], avg[0], finished, approx, forms && forms[1], 1));
    if (myElo() !== null) root.append(meStrip(myElo()));
    root.append(grid);
    section.insertAdjacentElement("beforebegin", host);
  }

  // HLTV form for both teams, or null when Karasu shows no ratings at all.
  // Each player's Elo is their pre-match Elo when the scoreboard gave it; otherwise their shown Elo,
  // shifted so the team still averages `avg`. Team form average = avg + the mean form bonus.
  function teamForms(teams, avg, sb) {
    if (!teams.some((t) => t.players.some((p) => Number.isFinite(p.rating)))) return null;
    const bonus = (p) => M.formElo(0, p.rating, p.games);
    const base = teams.map((t, i) => {
      const ps = t.players;
      if (!ps.length) return { own: avg[i], players: [] };
      const shift = avg[i] - ps.reduce((s, p) => s + p.elo, 0) / ps.length;
      const players = ps.map((p) => {
        const pre = sb?.byName.get(p.name) ?? p.elo + shift;
        return { ...p, pre, eff: pre + bonus(p) };
      });
      return { own: avg[i] + players.reduce((s, p) => s + bonus(p), 0) / players.length, players };
    });
    return base.map((f, i) => {
      const enemy = base[1 - i].own;
      const chance = M.winChance(f.own, enemy);
      const n = f.players.length;
      const players = f.players.map((p) => ({
        ...p,
        vsAvg: p.eff - f.own,
        // Win chance this player adds compared with a team-average player in their place.
        impact: (chance - M.winChance(f.own - (p.eff - f.own) / n, enemy)) * 100,
      }));
      return { own: f.own, enemy, players };
    });
  }

  function refresh(force) {
    if (!alive()) return;
    const old = document.querySelectorAll(`[${BOX}]`);
    rememberMyElo();
    rememberMyRating();
    rememberMyRange();
    refreshProfile();
    if (!settings.on) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    rememberScoreboard();
    const { teams, finished } = readTeams();
    if (teams.length !== 2) { old.forEach((b) => b.remove()); lastKey = ""; return; }
    // Finished match: rebuild pre-match Elo from the scoreboard. If it can't be read, fall back
    // to the overview's (current) Elo and mark the estimate approximate.
    const shownAvg = (t) => t.elos.reduce((a, b) => a + b, 0) / t.elos.length;
    const sb = finished ? scoreboardPre(teams) : null;
    const exact = !!sb;
    const avg = sb ? sb.avg : teams.map(shownAvg);
    const approx = finished && !exact;
    const forms = teamForms(teams, avg, sb);
    loadLineup();
    const key = `${lineups.get(pageMatchId())?.size || 0}|${avg}|${finished}|${approx}|${settings.rating}|${settings.myElo}|${settings.ratingLow}|${settings.ratingHigh}`
      + `|${myName()}|${teams.map((t) => t.players.map((p) => `${p.name}:${p.elo}:${p.rating}:${p.games}`).join(",")).join(";")}`;
    if (!force && key === lastKey && old.length === 1 && old[0].isConnected) return;
    old.forEach((b) => b.remove());
    drawPanel(teams, avg, finished, approx, forms);
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
      save("sync", { myElo: v });
    } else if (now - seenWritten < 60000) return;
    seenWritten = now;
    save("local", { myEloSeen: now });
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
      save("sync", { rating: r, ratingAuto: true });
    } else if (now - ratingSeenWritten < 60000) return;
    ratingSeenWritten = now;
    save("local", { ratingSeen: now });
  }

  // Your usual HLTV range: the 10th to 90th percentile of your last 30 games, so one freak game
  // either way doesn't stretch it. Read from Karasu's public stats API (the same query its profile
  // page runs) when you open your own profile, at most every 5 minutes.
  const API = "https://api.karasu.live/v1/graphql";
  const RANGE_QUERY = `query ($s: bigint!) { v_player_match_map_hltv(where: { steam_id: { _eq: $s } },
    order_by: { match: { started_at: desc_nulls_last } }, limit: 30) { hltv_rating } }`;
  let rangeFetchedAt = 0;
  const pctl = (sorted, p) => {
    const i = (sorted.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
    return sorted[a] + (sorted[b] - sorted[a]) * (i - a);
  };
  const r2 = (x) => Math.round(Math.min(2.5, Math.max(0.3, x)) * 100) / 100;
  async function rememberMyRange() {
    const id = location.pathname.match(/^\/players\/(\d+)/)?.[1];
    if (!id || Date.now() - rangeFetchedAt < 5 * 60000 || !onMyProfile()) return;
    rangeFetchedAt = Date.now();
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: RANGE_QUERY, variables: { s: id } }) });
      const rows = (await res.json())?.data?.v_player_match_map_hltv || [];
      const xs = rows.map((r) => Number(r.hltv_rating)).filter(Number.isFinite).sort((a, b) => a - b);
      if (xs.length < 5) return;
      const low = r2(pctl(xs, 0.1)), high = r2(pctl(xs, 0.9));
      if (low === settings.ratingLow && high === settings.ratingHigh) return;
      settings.ratingLow = low; settings.ratingHigh = high;
      save("sync", { ratingLow: low, ratingHigh: high });
    } catch { /* offline or Karasu changed its API: keep the last range */ }
  }

  // Country and Steam ID of each player in this match, by name, from the same public API:
  // the match page's address ends in the match's ID. Fetched once per match, then the panel redraws.
  const LINEUP_QUERY = `query ($m: uuid!) { matches_by_pk(id: $m) {
    lineup_1 { lineup_players { player { name country steam_id } } }
    lineup_2 { lineup_players { player { name country steam_id } } } } }`;
  const lineups = new Map(); // match ID -> Map(name -> { country, steam }), or null while loading
  const pageMatchId = () => location.pathname.match(/\/matches?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  function lineupInfo(name) {
    const id = pageMatchId();
    return (id && lineups.get(id)?.get(name)) || null;
  }
  async function loadLineup() {
    const id = pageMatchId();
    if (!id || lineups.has(id)) return;
    lineups.set(id, null);
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: LINEUP_QUERY, variables: { m: id } }) });
      const m = (await res.json())?.data?.matches_by_pk;
      const map = new Map();
      for (const l of [m?.lineup_1, m?.lineup_2]) for (const lp of l?.lineup_players || []) {
        if (lp.player?.name) map.set(lp.player.name, { country: lp.player.country || null, steam: lp.player.steam_id || null });
      }
      lineups.set(id, map);
      if (map.size && alive()) refresh(true);
    } catch { lineups.delete(id); }
  }

  // Another player's usual HLTV range (10th–90th percentile of their last 30 games), like yours.
  // Resolves true when it newly loaded.
  const playerRanges = new Map(); // Steam ID -> [low, high], or null when unknown
  async function loadPlayerRange(steam) {
    if (!steam || playerRanges.has(steam)) return false;
    playerRanges.set(steam, null);
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: RANGE_QUERY, variables: { s: steam } }) });
      const rows = (await res.json())?.data?.v_player_match_map_hltv || [];
      const xs = rows.map((r) => Number(r.hltv_rating)).filter(Number.isFinite).sort((a, b) => a - b);
      if (xs.length < 5) return false;
      playerRanges.set(steam, [r2(pctl(xs, 0.1)), r2(pctl(xs, 0.9))]);
      return true;
    } catch { playerRanges.delete(steam); return false; }
  }

  // "SK" -> 🇸🇰 (Karasu loads a flag font, so this shows as a flag on Windows too).
  const flagEmoji = (cc) => /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
  function countryName(cc) {
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc.toUpperCase()) || cc; } catch { return cc; }
  }

  // [low, high] if known; the average is kept inside it.
  function usualRange() {
    const lo = Number(settings.ratingLow), hi = Number(settings.ratingHigh), r = settings.rating;
    if (!settings.ratingAuto || !(lo > 0) || !(hi > 0) || hi < lo) return null;
    return [Math.min(lo, r), Math.max(hi, r)];
  }

  // ---------- profile page: where this player's form is taking them ----------
  // Under "Level 3 · 294 to next" on any player's profile. From the "Last 30 games" box it takes
  // the HLTV rating average and the win rate, and works out the average Elo per game with the
  // match-room model (an even match each game, so each win is worth the same as each loss is at
  // that rating). That gives how many games to the next level, or to dropping one. "Form" is the
  // same HLTV-form Elo the match room uses: Elo + 500 x (rating − 1).
  const PBOX = "data-kee-profile";
  const PCSS = `
    :host { display: block; margin-top: 10px; font-family: inherit; }
    .est { --c: #a1a1aa; --c2: rgba(161,161,170,.10);
      position: relative; overflow: hidden; padding: 11px 13px 10px 15px; border-radius: 10px; color: #e7e7ea;
      background: radial-gradient(120% 160% at 0% 0%, var(--c2), transparent 55%), linear-gradient(180deg, #16181f, #0f1116);
      border: 1px solid rgba(255,255,255,.07);
      box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04);
      font-size: 12px; font-weight: 600; line-height: 1.3; animation: in .35s ease-out both; }
    .est.up { --c: #4ade80; --c2: rgba(74,222,128,.14); }
    .est.dn { --c: #f87171; --c2: rgba(248,113,113,.14); }
    .est::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      background: var(--c); box-shadow: 0 0 12px var(--c); }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } }

    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
    .tag { font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: #8a8b96; font-weight: 700; }
    .go { margin-top: 3px; font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -.01em; white-space: nowrap; }
    .go .ar { color: var(--c); text-shadow: 0 0 12px var(--c); margin-right: 4px; }
    .go small { font-size: 12px; font-weight: 600; color: #a1a1aa; margin-left: 6px; }
    .pace { text-align: right; flex: none; }
    .pace b { display: block; font-size: 22px; font-weight: 800; line-height: 1; color: var(--c);
      text-shadow: 0 0 18px var(--c2); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .pace small { font-size: 10px; color: #6f707b; font-weight: 600; }

    .track { display: flex; align-items: center; gap: 9px; margin: 11px 0 2px; }
    .hex { --lc: #8a8b96; position: relative; width: 24px; height: 26px; flex: none; }
    .hex svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--lc) 45%, transparent)); }
    .hex path { fill: color-mix(in srgb, var(--lc) 18%, #111319); stroke: var(--lc); stroke-width: 3; }
    .hex b { position: absolute; inset: 0; display: grid; place-items: center; color: var(--lc); font-size: 10.5px; font-weight: 800; }
    .hex.dim { opacity: .45; }
    .rail { position: relative; flex: 1; height: 6px; border-radius: 4px; background: rgba(255,255,255,.07); }
    .rail .now { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--lc, #8a8b96); opacity: .9; }
    .rail .ghost { position: absolute; top: 0; bottom: 0; border-radius: 4px;
      background: repeating-linear-gradient(135deg, var(--c) 0 4px, color-mix(in srgb, var(--c) 35%, transparent) 4px 8px);
      box-shadow: 0 0 10px var(--c2); animation: pulse 2.2s ease-in-out infinite; }
    .rail .dot { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 2px #0f1116, 0 0 8px rgba(255,255,255,.6); }
    @keyframes pulse { 50% { opacity: .55; } }
    .scale { display: flex; justify-content: space-between; margin: 3px 33px 0; font-size: 10px; font-weight: 600;
      color: #6f707b; font-variant-numeric: tabular-nums; }
    .scale .mid { color: #a1a1aa; }
    .scale .mid i { font-style: normal; color: var(--c); }

    .pills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
    .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 6px;
      background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
      font-size: 10.5px; font-weight: 600; color: #a1a1aa; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .pill b { color: #fff; font-weight: 800; }
    .pill b.hot { color: #fbbf24; } .pill b.cold { color: #8a8b96; }
    .pill b.up { color: #4ade80; } .pill b.dn { color: #f87171; }
    .pill .hex { width: 14px; height: 15px; } .pill .hex b { font-size: 7.5px; }
    .pill.warn { border-color: rgba(251,191,36,.35); color: #fbbf24; }
    @media (prefers-reduced-motion: reduce) { .est, .rail .ghost { animation: none; } }
  `;
  const MAX_GAMES = 200; // beyond this it says "200+ games"
  const PREVIEW_GAMES = 10; // the striped part of the bar: where the next 10 games take you

  // Average Elo per game and where it leads, for a player at `elo` with this HLTV average and win rate.
  function profileTrend(elo, rating, winRate) {
    // An average can't be a flame game, so keep it just under the flame line.
    const e = M.estimate(elo, elo, Math.min(rating, M.FLAME_RATING - 0.01));
    const perGame = winRate * e.win - (1 - winRate) * e.loss;
    const lv = M.level(elo);
    let target = null; // { label, games, up }
    if (perGame >= 0.5 && lv.next) target = { label: lv.next.label, games: Math.ceil(lv.next.toGo / perGame), up: true };
    else if (perGame <= -0.5 && lv.min > 0) {
      const below = M.levels.find(([min]) => min < lv.min);
      target = { label: below[1], games: Math.ceil((elo - lv.min + 1) / -perGame), up: false };
    }
    return { perGame, win: e.win, loss: e.loss, target, level: lv };
  }

  // The numbers this needs, read from the profile: Elo, last-30 W/L and HLTV rating average.
  function readProfile() {
    const standing = document.querySelector(".profile-identity-standing");
    const eloEl = standing?.querySelector(".profile-identity-elo");
    if (!standing || !eloEl) return null;
    const elo = toInt(eloEl.textContent);
    const tile = (re) => [...document.querySelectorAll(".profile-form-tile")]
      .find((t) => re.test(t.querySelector("dt")?.textContent.trim() || ""))?.querySelector("dd");
    const wl = tile(/^wins\s*\/\s*losses$/i)?.firstChild?.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    const rt = tile(/^rating$/i)?.textContent.match(/\d+\.\d+/);
    const gained = tile(/^elo gained$/i)?.firstChild?.textContent.trim().replace("−", "-").match(/^[+-]?\d+/);
    if (!Number.isFinite(elo) || !wl || !rt) return null;
    const wins = +wl[1], losses = +wl[2];
    if (wins + losses === 0) return null;
    return { standing, elo, wins, losses, rating: Number(rt[0]), gained: gained ? Number(gained[0]) : null };
  }

  let profileKey = "";
  function refreshProfile() {
    const old = document.querySelectorAll(`[${PBOX}]`);
    const p = settings.on && /^\/players\//.test(location.pathname) ? readProfile() : null;
    if (!p) { old.forEach((b) => b.remove()); profileKey = ""; return; }
    // Their usual HLTV range (10th–90th percentile of the last 30 games), loaded once per player
    // from Karasu's API like the match-room chips; the card redraws when it arrives.
    const steam = location.pathname.match(/^\/players\/(\d+)/)?.[1] || null;
    if (steam && !playerRanges.has(steam)) loadPlayerRange(steam).then((got) => { if (got && alive()) { profileKey = ""; refreshProfile(); } });
    const usual = steam ? playerRanges.get(steam) || null : null;
    const key = `${location.pathname}|${p.elo}|${p.wins}|${p.losses}|${p.rating}|${p.gained}|${usual}`;
    if (key === profileKey && old.length === 1 && p.standing.contains(old[0])) return;
    old.forEach((b) => b.remove());
    profileKey = key;

    // Under 10 games, pull the rating toward 1.00 and the win rate toward 50% in proportion,
    // like the match room does, so one lucky game doesn't promise a level in 5 games.
    const games = p.wins + p.losses, winRate = p.wins / games;
    const few = games < M.FORM_FULL_GAMES;
    const useRating = M.formRating(p.rating, games);
    const useWin = 0.5 + (winRate - 0.5) * Math.min(1, games / M.FORM_FULL_GAMES);
    const t = profileTrend(p.elo, useRating, useWin);
    const host = document.createElement("div");
    host.setAttribute(PBOX, "");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PCSS;
    const pg = Math.round(t.perGame * 10) / 10;
    const signed = (x, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(d)}`;
    const dir = t.target ? (t.target.up ? "up" : "dn") : "eq";
    const box = h("div", `est ${dir}`);

    // Head: where they're heading, and the Elo per game.
    const head = h("div", "head");
    const left = h("div");
    const go = h("div", "go");
    if (t.target) {
      const lb = h("span", "", t.target.label);
      lb.style.color = M.level(t.target.up ? t.level.next.at : t.level.min - 1).color;
      go.append(h("span", "ar", t.target.up ? "▲" : "▼"), lb,
        h("small", "", t.target.games > MAX_GAMES ? `in ${MAX_GAMES}+ games` : `in ~${t.target.games} game${t.target.games === 1 ? "" : "s"}`));
    } else go.append(h("span", "ar", "●"), `Holding ${t.level.label}`);
    left.append(h("div", "tag", "Level outlook"), go);
    const pace = h("div", "pace");
    pace.append(h("b", "", signed(pg)), h("small", "", "Elo / game"));
    head.append(left, pace);

    // Track: this level's band, with where they are now and (striped) where 10 games take them.
    const lv = t.level;
    const lo = lv.min, hi = lv.next ? lv.next.at : Math.max(lv.min + 400, p.elo + 1);
    const at = (e) => Math.max(0, Math.min(100, ((e - lo) / (hi - lo)) * 100));
    const then = p.elo + t.perGame * PREVIEW_GAMES;
    const hexOf = (l, dim) => {
      const x = h("span", `hex${dim ? " dim" : ""}`);
      x.style.setProperty("--lc", l.color);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 42 46");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", HEX);
      svg.append(path);
      x.append(svg, h("b", "", l.next ? l.label.replace("Level ", "") : "★"));
      return x;
    };
    const track = h("div", "track");
    const rail = h("div", "rail");
    rail.style.setProperty("--lc", lv.color);
    const now = h("i", "now");
    now.style.width = `${at(Math.min(p.elo, then))}%`;
    const ghost = h("i", "ghost");
    ghost.style.left = `${at(Math.min(p.elo, then))}%`;
    ghost.style.width = `${Math.abs(at(then) - at(p.elo))}%`;
    const dot = h("i", "dot");
    dot.style.left = `${at(p.elo)}%`;
    rail.append(now, ghost, dot);
    track.append(hexOf(lv, false), rail, lv.next ? hexOf(M.level(lv.next.at), true) : hexOf(lv, true));
    const scale = h("div", "scale");
    const mid = h("span", "mid", `${p.elo.toLocaleString()} now `);
    mid.append(h("i", "", `→ ${Math.max(0, Math.round(then)).toLocaleString()}`), ` in ${PREVIEW_GAMES} games`);
    scale.append(h("span", "", lo.toLocaleString()), mid, h("span", "", lv.next ? hi.toLocaleString() : ""));

    // Win / loss, like the match room: from their usual weak game to their usual strong game
    // (10th–90th percentile of the last 30, at an even match). Without the range yet, the average.
    const rAvg = Math.round(Math.min(2.5, Math.max(0.3, p.rating)) * 100) / 100;
    const range = usual && !few ? [Math.min(usual[0], rAvg), Math.max(usual[1], rAvg)] : null;
    const est = (r) => M.estimate(p.elo, p.elo, r);
    const loE = range && est(range[0]), hiE = range && est(range[1]);
    const span = (key, sign, cls) => {
      const b = h("b", cls, range && loE[key] !== hiE[key] ? `${sign}${loE[key]} to ${sign}${hiE[key]}` : `${sign}${range ? loE[key] : t[key]}`);
      return b;
    };
    const wlPill = h("span", "pill");
    wlPill.append("Win", span("win", "+", "up"), "· Loss", span("loss", "−", "dn"));
    wlPill.title = range ? `Even match, from a ${range[0].toFixed(2)} game to a ${range[1].toFixed(2)} game (their usual range over the last 30)`
      : `Even match, at a ${useRating.toFixed(2)} rating`;

    // Pills: what it's based on.
    const pill = (...parts) => { const x = h("span", "pill"); x.append(...parts); return x; };
    const pills = h("div", "pills");
    pills.append(
      pill("HLTV", h("b", p.rating >= 1.25 ? "hot" : p.rating < 0.95 ? "cold" : "", p.rating.toFixed(2)),
        ...(range ? [`· usual ${range[0].toFixed(2)}–${range[1].toFixed(2)}`] : [])),
      wlPill,
      pill(h("b", "", `${Math.round(winRate * 100)}%`), "wins"),
    );
    if (p.gained !== null) {
      const act = Math.round((p.gained / games) * 10) / 10;
      pills.append(pill("Actual", h("b", act > 0 ? "up" : act < 0 ? "dn" : "", signed(act)), "/ game"));
    }
    const fe = Math.round(M.formElo(p.elo, p.rating, games));
    const flv = M.level(fe);
    pills.append(pill("Form", h("b", "", fe.toLocaleString()), hexOf(flv, false)));
    if (few) pills.append(Object.assign(pill(`Only ${games} game${games === 1 ? "" : "s"} · damped`), { className: "pill warn" }));

    box.title = `Estimate from the last ${games} games: an even match each game, won ${Math.round(winRate * 100)}% of the time at a ${p.rating.toFixed(2)} HLTV rating`
      + (few ? ` (few games, so counted as ${useRating.toFixed(2)} and ${Math.round(useWin * 100)}%)` : "")
      + `. Striped bar: where ${PREVIEW_GAMES} more games at this pace would take you.`
      + ` Form Elo = Elo + 500 × (HLTV − 1), the same form the match-room win chance uses.`;
    box.append(head, track, scale, pills);
    root.append(style, box);
    p.standing.append(host);
  }

  // Karasu is a single-page app: re-check when the page changes, at most ~4 times a second.
  // Stop quietly once this copy has been orphaned (see alive() at the top); the fresh copy takes over when the tab is reloaded.
  let pending = false;
  const watcher = new MutationObserver((records) => {
    if (!alive()) { watcher.disconnect(); return; }
    if (records.every((r) => r.target.closest && r.target.closest(`[${BOX}]`))) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; if (alive()) refresh(false); }, 250);
  });
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });

  chrome.storage.local.get({ [SB_KEY]: {} }, (v) => { saved = v[SB_KEY] || {}; refresh(true); });
  chrome.storage.sync.get({ on: true, rating: 1.0, ratingAuto: false, myElo: null, ratingLow: null, ratingHigh: null }, (v) => { settings = v; refresh(true); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k of Object.keys(c)) settings[k] = c[k].newValue;
    refresh(true);
  });
})();
