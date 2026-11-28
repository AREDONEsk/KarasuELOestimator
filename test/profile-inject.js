// Elo model for karasu.live, fitted to 89 players across 9 real matches
// (average error about 1 Elo). Karasu does not publish its formula; this is an estimate.
//
//   chance = your team's win chance, from the two teams' average Elo
//   win    = 44 x (1 - chance) x (0.08 + 0.74 x HLTV rating)
//   loss   = 44 x chance       x (1.65 - 0.68 x HLTV rating)
//   standout game (HLTV >= 1.69, the flame icon on Karasu): the win counts as a 2.00 rating,
//   whatever the real rating was. Fits every flame game seen: 1.81 and 2.51 both +33 (2.00 gives
//   33), 1.87 got +44 (2.00 gives 44), and two +48s where 2.00 gives 65 but wins are capped.
//   The flame starts at 1.69. MVP adds nothing extra.
//   losses are capped at 40, normal wins at 40 and flame wins at 48. Every change is at least 3 (lopsided matches show +3/-3 at any rating).
//   Then losses get +3: checked against 3,000 real Karasu results (Nov 2026), the formula above came
//   out about 3 short on losses. With the offset, losses are within ±1 Elo 65% of the time (was 14%).
//
// Averages must be PRE-match Elo. On a finished match use preMatchAvg() first.
globalThis.KarasuEloModel = (() => {
  const K = 44;
  const LOSS_CAP = 40;
  const WIN_CAP = 40;       // normal win
  const FLAME_WIN_CAP = 48; // flame win
  const FLAME_RATING = 1.69; // flame icon from 1.69
  const FLAME_AS = 2.0;     // a flame game's win is worked out as if the rating were this

  const winChance = (ownAvg, enemyAvg) => 1 / (1 + 10 ** ((enemyAvg - ownAvg) / 400));
  const MIN_CHANGE = 3;
  const atLeastMin = (x) => Math.max(MIN_CHANGE, Math.round(x));
  const LOSS_OFFSET = 3; // added before the loss cap

  function estimate(ownAvg, enemyAvg, rating) {
    const chance = winChance(ownAvg, enemyAvg);
    const winAt = (r) => K * (1 - chance) * (0.08 + 0.74 * r);
    const flame = rating >= FLAME_RATING;
    const win = Math.min(flame ? FLAME_WIN_CAP : WIN_CAP, winAt(flame ? FLAME_AS : rating));
    return {
      chance,
      win: atLeastMin(win),
      loss: atLeastMin(Math.min(LOSS_CAP, Math.round(K * chance * (1.65 - 0.68 * rating)) + LOSS_OFFSET)),
    };
  }

  // Finished match: the Elo Karasu shows already includes the result (e.g. "1 001 Elo ▼ -24").
  // Undo it to get the team's pre-match average: pre = shown - change, per player.
  // Returns null if the changes don't line up one-to-one with the Elo values.
  function preMatchAvg(elos, deltas) {
    if (!elos.length || deltas.length !== elos.length) return null;
    const sum = elos.reduce((s, e, i) => s + (e - deltas[i]), 0);
    return sum / elos.length;
  }

  // Karasu's own level table (from its leaderboard code): a new level every 400 Elo up to
  // Level 10, then "Ultimate" from 4,500. Colors are Karasu's exact RGB values.
  const LEVELS = [
    [4500, "Ultimate", "14 165 201"],
    [3600, "Level 10", "245 158 11"],
    [3200, "Level 9", "239 68 68"],
    [2800, "Level 8", "249 115 22"],
    [2400, "Level 7", "249 115 22"],
    [2000, "Level 6", "168 85 247"],
    [1600, "Level 5", "168 85 247"],
    [1200, "Level 4", "34 197 94"],
    [800, "Level 3", "34 197 94"],
    [400, "Level 2", "177 195 217"],
    [0, "Level 1", "177 195 217"],
  ];

  // Level for a whole-number Elo, plus how far it is to the next one (null at Ultimate).
  function level(elo) {
    const e = Math.max(0, Math.round(elo));
    const i = LEVELS.findIndex(([min]) => e >= min);
    const [min, label, rgb] = LEVELS[i];
    const up = i > 0 ? LEVELS[i - 1] : null;
    return {
      label,
      min,
      color: `rgb(${rgb.replace(/ /g, ",")})`,
      next: up ? { label: up[1], at: up[0], toGo: up[0] - e } : null,
    };
  }

  // HLTV form: a player's Elo plus 50 for every 0.10 of last-30 HLTV rating above 1.00
  // (a 1.30 player counts as +150, a 0.80 player as -100). Players with fewer than 10 rated games
  // are pulled toward 1.00 in proportion (2 games at 2.04 count as 1.21), so a short hot streak
  // can't swing a whole team. A missing rating counts as 1.00. The 500 weight is a first guess.
  const FORM_WEIGHT = 500;
  const FORM_FULL_GAMES = 10;
  function formRating(rating, games) {
    if (!Number.isFinite(rating)) return 1;
    const w = Number.isFinite(games) ? Math.min(1, Math.max(0, games) / FORM_FULL_GAMES) : 1;
    return 1 + (rating - 1) * w;
  }
  const formElo = (elo, rating, games) => elo + FORM_WEIGHT * (formRating(rating, games) - 1);

  return { estimate, winChance, preMatchAvg, level, levels: LEVELS, FLAME_RATING, FORM_FULL_GAMES, formRating, formElo };
})();

(()=>{const M=globalThis.KarasuEloModel;const settings={on:true};const RANGE={bad:0.6,great:1.69};const alive=()=>true;const HEX='M21 2 39 12.5v21L21 44 3 33.5v-21Z';const toInt=(s)=>parseInt(s.replace(/\D/g,''),10);const h=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
const API="https://api.karasu.live/v1/graphql";const RANGE_QUERY=`query ($s: bigint!) { v_player_match_map_hltv(where: { steam_id: { _eq: $s } }, order_by: { match: { started_at: desc_nulls_last } }, limit: 30) { hltv_rating } }`;
const pctl=(sorted,p)=>{const i=(sorted.length-1)*p,a=Math.floor(i),b=Math.ceil(i);return sorted[a]+(sorted[b]-sorted[a])*(i-a);};const r2=(x)=>Math.round(Math.min(2.5,Math.max(0.3,x))*100)/100;
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

  // ---------- profile page: where this player's form is taking them ----------
  // Under "Level 3 · 294 to next" on any player's profile. From the "Last 30 games" box it takes
  // the HLTV rating average and the win rate, and works out the average Elo per game with the
  // match-room model (an even match each game, so each win is worth the same as each loss is at
  // that rating). That gives how many games to the next level, or to dropping one. "Form" is the
  // same HLTV-form Elo the match room uses: Elo + 500 x (rating − 1).
  const PBOX = "data-kee-profile";
  const PCSS = `
    :host { display: block; margin-top: 8px; font-family: inherit; }
    .est { --c: #a1a1aa; --c2: rgba(161,161,170,.10);
      position: relative; overflow: hidden; padding: 9px 11px 9px 13px; border-radius: 10px; color: #e7e7ea;
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
    .go { margin-top: 2px; font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.01em; white-space: nowrap; }
    .go .ar { color: var(--c); text-shadow: 0 0 12px var(--c); margin-right: 4px; }
    .go small { font-size: 12px; font-weight: 600; color: #a1a1aa; margin-left: 6px; }
    .pace { text-align: right; flex: none; }
    .pace b { display: block; font-size: 20px; font-weight: 800; line-height: 1; color: var(--c);
      text-shadow: 0 0 18px var(--c2); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .pace small { font-size: 10px; color: #6f707b; font-weight: 600; }

    .track { display: flex; align-items: center; gap: 8px; margin: 8px 0 1px; }
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

    .pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
    .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 5px;
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
      Object.assign(pill("HLTV", h("b", p.rating >= 1.25 ? "hot" : p.rating < 0.95 ? "cold" : "", p.rating.toFixed(2))),
        { title: range ? `Last-30 average; usual range ${range[0].toFixed(2)}–${range[1].toFixed(2)}` : "Last-30 average" }),
      wlPill,
      pill(h("b", "", `${Math.round(winRate * 100)}%`), "winrate"),
    );
    if (p.gained !== null) {
      const act = Math.round((p.gained / games) * 10) / 10;
      pills.append(pill("Actual", h("b", act > 0 ? "up" : act < 0 ? "dn" : "", signed(act)), "per game"));
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


refreshProfile();return 'ok';})()