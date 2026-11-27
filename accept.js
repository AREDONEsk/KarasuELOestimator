// Optional auto-accept for karasu.live's "match found" check.
// Off by default; waits a configurable delay, then clicks accept.
(() => {
  const BUTTON = "button.match-ready-accept";
  const DEFAULTS = { autoAccept: false, acceptDelay: 2 };
  let cfg = { ...DEFAULTS };
  const handled = new WeakSet(); // buttons we've already dealt with

  const usable = (b) => {
    if (!b.isConnected || b.disabled || b.getAttribute("aria-disabled") === "true") return false;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(b);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(text, good) {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      div { position: fixed; z-index: 2147483647; right: 18px; bottom: 18px; padding: 10px 14px;
        border-radius: 10px; background: #14161c; color: #e7e7ea; border: 1px solid ${good ? "rgba(74,222,128,.35)" : "rgba(248,113,113,.35)"};
        box-shadow: 0 8px 24px rgba(0,0,0,.45); font: 600 12.5px/1.35 "Segoe UI", system-ui, sans-serif;
        animation: in .25s ease-out, out .4s ease-in 4.6s forwards; }
      b { color: ${good ? "#4ade80" : "#f87171"}; }
      @keyframes in { from { opacity: 0; transform: translateY(6px); } }
      @keyframes out { to { opacity: 0; transform: translateY(6px); } }</style><div></div>`;
    const box = root.querySelector("div");
    box.append(Object.assign(document.createElement("b"), { textContent: "Auto-accepted" }),
               document.createElement("br"), text);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 5200);
  }

  async function handle(btn) {
    handled.add(btn);
    await sleep(Math.max(0, Math.min(10, Number(cfg.acceptDelay) || 0)) * 1000);
    if (!cfg.autoAccept || !usable(btn)) return; // turned off, or already accepted/cancelled meanwhile

    if (!usable(btn)) return;
    btn.click();
    toast("Match accepted. Get ready to join the server!", true);
  }

  // After the extension is reloaded, the old copy of this script stops (the new one takes over on tab reload).
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  function scan() {
    if (!alive()) { observer.disconnect(); clearInterval(timer); return; }
    if (!cfg.autoAccept) return;
    for (const b of document.querySelectorAll(BUTTON)) {
      if (!handled.has(b) && usable(b)) { handle(b); return; }
    }
  }

  let queued = false;
  const queueScan = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 100);
  };
  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "disabled", "aria-disabled"],
  });
  const timer = setInterval(scan, 1000); // safety net: timers keep running in background tabs

  chrome.storage.sync.get(DEFAULTS, (v) => { cfg = v; scan(); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync") return;
    for (const k of Object.keys(c)) if (k in DEFAULTS) cfg[k] = c[k].newValue;
    scan();
  });
})();
