const M = globalThis.KarasuEloModel;
const on = document.getElementById("on");
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

chrome.storage.sync.get({ on: true, rating: 1.0, ...ACC }, (v) => {
  on.checked = v.on;
  rating.value = v.rating;
  show(clean(v.rating));
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
on.addEventListener("change", () => chrome.storage.sync.set({ on: on.checked }));
rating.addEventListener("input", () => show(clean(rating.value)));
rating.addEventListener("change", () => chrome.storage.sync.set({ rating: clean(rating.value) }));
