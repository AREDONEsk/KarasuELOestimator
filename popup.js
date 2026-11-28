const M = globalThis.KarasuEloModel;
const $ = (id) => document.getElementById(id);
const rating = document.getElementById("rating");
const val = document.getElementById("val");
const clean = (v) => Math.round(Math.min(2.5, Math.max(0.3, Number(v) || 1)) * 100) / 100;

// "+15" or "+15 to +22" (lo/hi in either order).
function amount(el, sign, a, b) {
  const [x, y] = [a, b].sort((p, q) => p - q);
  if (b === undefined || x === y) { el.textContent = `${sign}${a}`; return; }
  const to = document.createElement("span");
  to.className = "to";
  to.textContent = "to";
  el.replaceChildren(`${sign}${x}`, to, `${sign}${y}`);
}

// range = [low, high] of your usual HLTV rating (10th–90th percentile of your last 30 games),
// or null when it isn't known (then one number and the slider, as before).
const MIN_R = 0.3, MAX_R = 2.5;
// A small 🔥 (Karasu's flame: a win at HLTV 1.69+ counts as a 2.00 rating).
function fire(el) {
  const f = document.createElement("span");
  f.className = "fire";
  f.textContent = "🔥";
  f.title = `Flame game (HLTV ${M.FLAME_RATING}+): the win is worked out as a 2.00 rating`;
  el.append(f);
}
const at = (x) => `${((x - MIN_R) / (MAX_R - MIN_R)) * 100}%`;
function show(r, range) {
  const e = M.estimate(1000, 1000, r); // an even match
  rating.hidden = !!range;
  $("hbar").hidden = !range;
  $("ratingLbl").textContent = range ? "Your HLTV rating" : "Your average HLTV rating";
  rating.closest(".card").classList.toggle("rng", !!range);
  if (!range) {
    val.textContent = r.toFixed(2);
    amount($("exw"), "+", e.win);
    amount($("exl"), "−", e.loss);
    if (r >= M.FLAME_RATING) { fire(val); fire($("exw")); }
    return;
  }
  const avg = document.createElement("small");
  avg.textContent = `avg ${r.toFixed(2)}`;
  val.replaceChildren(`${range[0].toFixed(2)}–${range[1].toFixed(2)}`, avg);
  $("hband").style.left = at(range[0]);
  $("hband").style.width = `calc(${at(range[1])} - ${at(range[0])})`;
  $("hdot").style.left = at(r);
  $("hdot").title = `Your average: ${r.toFixed(2)}`;
  const lo = M.estimate(1000, 1000, range[0]), hi = M.estimate(1000, 1000, range[1]);
  amount($("exw"), "+", lo.win, hi.win);
  amount($("exl"), "−", lo.loss, hi.loss);
  if (r >= M.FLAME_RATING) fire(val);
  if (range[1] >= M.FLAME_RATING) fire($("exw"));
}

const ACC = { autoAccept: false, acceptDelay: 2 };
const num = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number(v) === 0 ? 0 : Number(v) || d));

function syncAccept() {
  const a = $("autoAccept").checked;
  $("delayRow").classList.toggle("off", !a);
}

// Rank badge: Karasu's level color and number for your Elo, read automatically from karasu.live.
const eloOf = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null
  : Math.round(Math.min(9999, Math.max(0, Number(v)))));

function showRank(elo) {
  const card = $("rankCard");
  const top = elo === null ? null : M.level(elo).label;
  card.classList.toggle("ult", top === "Ultimate");
  card.classList.toggle("l10", top === "Level 10");
  if (elo === null) {
    card.style.removeProperty("--lc");
    $("badgeNum").textContent = "?";
    $("rname").textContent = "Not detected yet";
    $("barFill").style.width = "0%";
    $("rnext").textContent = "Open karasu.live while logged in";
    return;
  }
  const lv = M.level(elo);
  card.style.setProperty("--lc", lv.color);
  $("badgeNum").textContent = lv.next ? lv.label.replace("Level ", "") : "★";
  $("rname").textContent = lv.label;
  const pct = lv.next ? ((elo - lv.min) / (lv.next.at - lv.min)) * 100 : 100;
  $("barFill").style.width = `${pct}%`;
  $("rnext").textContent = lv.next ? `${lv.next.toGo} Elo to ${lv.next.label}` : "Top level reached";
}

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// Levels preview: the whole ladder, Ultimate at the top, your level marked.
const SVG_NS = "http://www.w3.org/2000/svg";
function hexBadge(text) {
  const box = document.createElement("div");
  box.className = "hx";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 42 46");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M21 2 39 12.5v21L21 44 3 33.5v-21Z");
  svg.append(path);
  const span = document.createElement("span");
  span.textContent = text;
  box.append(svg, span);
  return box;
}

function buildLevels(elo) {
  const list = $("lvList");
  list.replaceChildren();
  const mine = elo === null ? null : M.level(elo).label;
  M.levels.forEach(([min, label, rgb], i) => {
    const row = document.createElement("div");
    row.className = "lv" + (label === "Ultimate" ? " ult" : label === "Level 10" ? " l10" : "") + (label === mine ? " me" : "");
    row.style.setProperty("--lc", `rgb(${rgb.replace(/ /g, ",")})`);
    const name = document.createElement("div");
    name.className = "nm";
    const text = document.createElement("span");
    text.textContent = label;
    name.append(text);
    if (label === mine) {
      const you = document.createElement("em");
      you.textContent = "YOU";
      name.append(you);
    }
    const range = document.createElement("small");
    range.textContent = i === 0 ? `${min.toLocaleString()}+`
      : `${min.toLocaleString()}–${(M.levels[i - 1][0] - 1).toLocaleString()}`;
    row.append(hexBadge(label === "Ultimate" ? "★" : label.replace("Level ", "")), name, range);
    list.append(row);
  });
}

$("lvBtn").addEventListener("click", () => {
  const open = $("lvList").classList.toggle("open");
  $("lvBtn").setAttribute("aria-expanded", String(open));
});

function loadRank() {
  chrome.storage.sync.get({ myElo: null }, (s) => chrome.storage.local.get({ myEloSeen: 0 }, (l) => {
    const elo = eloOf(s.myElo);
    showRank(elo);
    buildLevels(elo);
    $("eloSrc").textContent = elo === null ? "auto"
      : `${elo.toLocaleString()} Elo · ${l.myEloSeen ? ago(l.myEloSeen) : "auto"}`;
  }));
}
loadRank();
chrome.storage.onChanged.addListener((c) => { if (c.myElo || c.myEloSeen) loadRank(); });

// The rating comes from your profile ("Last 30 games" average) once you've opened it;
// until then you can set it yourself.
function loadRating() {
  chrome.storage.sync.get({ rating: 1.0, ratingAuto: false, ratingLow: null, ratingHigh: null }, (v) => chrome.storage.local.get({ ratingSeen: 0 }, (l) => {
    rating.value = v.rating;
    rating.disabled = v.ratingAuto;
    const r = clean(v.rating), lo = Number(v.ratingLow), hi = Number(v.ratingHigh);
    // Same rule as the match cards: only with an auto rating, and the average kept inside the band.
    show(r, v.ratingAuto && lo > 0 && hi >= lo ? [Math.min(clean(lo), r), Math.max(clean(hi), r)] : null);
    $("ratingSrc").textContent = v.ratingAuto
      ? `From your profile · last 30 games${l.ratingSeen ? " · " + ago(l.ratingSeen) : ""}`
      : "Open My Stats on karasu.live to fill this in";
  }));
}
loadRating();
chrome.storage.onChanged.addListener((c) => { if (c.rating || c.ratingAuto || c.ratingSeen || c.ratingLow || c.ratingHigh) loadRating(); });

chrome.storage.sync.get({ ...ACC }, (v) => {
  $("autoAccept").checked = v.autoAccept;
  $("acceptDelay").value = v.acceptDelay;
  syncAccept();
});
for (const id of ["autoAccept"]) {
  $(id).addEventListener("change", () => { chrome.storage.sync.set({ [id]: $(id).checked }); syncAccept(); });
}
$("acceptDelay").addEventListener("change", (e) => {
  e.target.value = Math.round(num(e.target.value, 0, 10, 2) * 2) / 2;
  chrome.storage.sync.set({ acceptDelay: Number(e.target.value) });
});
rating.addEventListener("input", () => show(clean(rating.value), null));
rating.addEventListener("change", () => chrome.storage.sync.set({ rating: clean(rating.value) }));

// Session tracker: your latest session (games started less than 3 hours apart), from Karasu's
// public stats API. Shown from the cache right away, then refreshed if it's over 2 minutes old.
const S = globalThis.KarasuSession;
const svgEl = (tag, attrs) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

function drawGraph(s) {
  const g = $("sGraph");
  g.replaceChildren();
  const W = 240, H = 64, PX = 6, PT = 6, PB = 6;
  const ys = [s.start, ...s.games.map((x) => x.post ?? x.pre + x.d)];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const X = (i) => PX + (i / (ys.length - 1)) * (W - 2 * PX);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const col = s.net > 0 ? "#4ade80" : s.net < 0 ? "#f87171" : "#8a8b96";
  const defs = svgEl("defs", {});
  const grad = svgEl("linearGradient", { id: "sFill", x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl("stop", { offset: 0, "stop-color": col, "stop-opacity": 0.28 }),
    svgEl("stop", { offset: 1, "stop-color": col, "stop-opacity": 0 }));
  defs.append(grad);
  const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  g.append(defs,
    svgEl("line", { class: "base", x1: PX, x2: W - PX, y1: Y(s.start), y2: Y(s.start) }),
    svgEl("path", { d: `M${pts[0]} L${pts.slice(1).join(" L")} L${X(ys.length - 1)},${H} L${X(0)},${H}Z`, fill: "url(#sFill)" }),
    svgEl("polyline", { class: "ln", points: pts.join(" "), stroke: col, style: `filter: drop-shadow(0 0 4px ${col}80)` }));
  g.append(svgEl("circle", { cx: X(0), cy: Y(s.start), r: 2.5, fill: "#62636e" }));
  s.games.forEach((x, i) => {
    const c = svgEl("circle", { cx: X(i + 1), cy: Y(ys[i + 1]), r: 3.5, fill: x.win ? "#4ade80" : "#f87171" });
    const tip = svgEl("title", {});
    tip.textContent = `${hhmm(x.t)} · ${x.win ? "Win" : "Loss"} ${signed(x.d)} → ${ys[i + 1]} Elo`
      + (x.h !== null ? ` · HLTV ${x.h.toFixed(2)}` : "");
    c.append(tip);
    g.append(c);
  });
}

function showSession(cache, steam) {
  const s = cache && S.session(cache.games);
  $("sBody").hidden = !s;
  $("sEmpty").hidden = !!s;
  $("sLive").hidden = !(s && s.live);
  $("sSrc").textContent = cache ? ago(cache.t) : "";
  if (!s) {
    $("sLbl").textContent = "Session";
    $("sEmpty").textContent = !steam ? "Open karasu.live while logged in to track your session"
      : cache ? "No rated games yet" : "Couldn't load your games. Open karasu.live to refresh";
    return;
  }
  const day = new Date(s.games[s.games.length - 1].t).toLocaleDateString([], { day: "numeric", month: "short" });
  $("sLbl").textContent = s.today ? "Today's session" : `Last session · ${day}`;
  $("sNet").textContent = signed(s.net);
  $("sNet").className = s.net > 0 ? "pos" : s.net < 0 ? "neg" : "";
  const wl = document.createElement("i");
  wl.textContent = "–";
  const w = document.createElement("span"); w.className = "pos"; w.textContent = s.w;
  const l = document.createElement("span"); l.className = "neg"; l.textContent = s.l;
  $("sWL").replaceChildren(w, wl, l);
  $("sH").textContent = s.hltv === null ? "–" : s.hltv.toFixed(2);
  $("sH").className = s.hltv === null ? "" : s.hltv >= 1.1 ? "pos" : s.hltv < 0.9 ? "neg" : "";
  $("sGames").textContent = `${s.games.length} game${s.games.length === 1 ? "" : "s"} · ${hhmm(s.games[0].t)}–${hhmm(s.games[s.games.length - 1].t)}`;
  $("sElo").textContent = `${s.start} → ${s.end} Elo`;
  drawGraph(s);
}

function loadSession() {
  chrome.storage.sync.get({ mySteam: null }, ({ mySteam }) => {
    if (!mySteam) { showSession(null, null); return; }
    S.load(mySteam, (c) => showSession(c, mySteam));
  });
}
loadSession();
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.mySteam) loadSession();
  if (area === "local" && c[S.KEY]?.newValue) chrome.storage.sync.get({ mySteam: null }, ({ mySteam }) => showSession(c[S.KEY].newValue, mySteam));
});
