const M = globalThis.KarasuEloModel;
const rating = document.getElementById("rating");
const val = document.getElementById("val");
const clean = (v) => Math.round(Math.min(2.5, Math.max(0.3, Number(v) || 1)) * 100) / 100;

function show(r) {
  val.textContent = r.toFixed(2);
  const e = M.estimate(1000, 1000, r); // an even match
  document.getElementById("exw").textContent = `+${e.win}`;
  document.getElementById("exl").textContent = `−${e.loss}`;
}

const $ = (id) => document.getElementById(id);
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
  chrome.storage.sync.get({ rating: 1.0, ratingAuto: false }, (v) => chrome.storage.local.get({ ratingSeen: 0 }, (l) => {
    rating.value = v.rating;
    rating.disabled = v.ratingAuto;
    show(clean(v.rating));
    $("ratingSrc").textContent = v.ratingAuto
      ? `From your profile · last 30 games${l.ratingSeen ? " · " + ago(l.ratingSeen) : ""}`
      : "Open My Stats on karasu.live to fill this in";
  }));
}
loadRating();
chrome.storage.onChanged.addListener((c) => { if (c.rating || c.ratingAuto || c.ratingSeen) loadRating(); });

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
rating.addEventListener("input", () => show(clean(rating.value)));
rating.addEventListener("change", () => chrome.storage.sync.set({ rating: clean(rating.value) }));
