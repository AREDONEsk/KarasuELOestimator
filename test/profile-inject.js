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

(()=>{const M=globalThis.KarasuEloModel;const settings={on:true};const toInt=(s)=>parseInt(s.replace(/\D/g,''),10);const h=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
  // ---------- profile page: where this player's form is taking them ----------
  // Under "Level 3 · 294 to next" on any player's profile. From the "Last 30 games" box it takes
  // the HLTV rating average and the win rate, and works out the average Elo per game with the
  // match-room model (an even match each game, so each win is worth the same as each loss is at
  // that rating). That gives how many games to the next level, or to dropping one. "Form" is the
  // same HLTV-form Elo the match room uses: Elo + 500 x (rating − 1).
  const PBOX = "data-kee-profile";
  const PCSS = `
    :host { display: block; margin-top: 8px; font-family: inherit; }
    .est { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 10px; border-radius: 8px;
      background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); color: #e7e7ea;
      font-size: 12px; font-weight: 600; line-height: 1.3; animation: in .3s ease-out both; }
    @keyframes in { from { opacity: 0; transform: translateY(-3px); } }
    .tag { font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: #8a8b96; font-weight: 700; }
    .go { font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; }
    .go.up .ar { color: #4ade80; } .go.dn .ar { color: #f87171; } .go.eq .ar { color: #a1a1aa; }
    .go b { font-weight: 800; }
    .sub { flex-basis: 100%; font-size: 11px; font-weight: 500; color: #a1a1aa; font-variant-numeric: tabular-nums; }
    .sub .up { color: #4ade80; } .sub .dn { color: #f87171; }
    .form { margin-left: auto; font-size: 11px; font-weight: 600; color: #a1a1aa; white-space: nowrap; }
    .form b { font-weight: 800; }
  `;
  const MAX_GAMES = 200; // beyond this it says "200+ games"

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
    const key = `${location.pathname}|${p.elo}|${p.wins}|${p.losses}|${p.rating}|${p.gained}`;
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
    const box = h("div", "est");
    const go = h("div", `go ${t.target ? (t.target.up ? "up" : "dn") : "eq"}`);
    if (t.target) {
      const lb = h("b", "", t.target.label);
      lb.style.color = M.level(t.target.up ? t.level.next.at : t.level.min - 1).color;
      go.append(h("span", "ar", t.target.up ? "▲ " : "▼ "), lb,
        t.target.games > MAX_GAMES ? ` in ${MAX_GAMES}+ games` : ` in ~${t.target.games} game${t.target.games === 1 ? "" : "s"}`);
    } else go.append(h("span", "ar", "● "), `Holding ${t.level.label}`);
    const fe = Math.round(M.formElo(p.elo, p.rating, games));
    const flv = M.level(fe);
    const form = h("div", "form", `Form ${fe.toLocaleString()} Elo · `);
    const fb = h("b", "", flv.label);
    fb.style.color = flv.color;
    form.append(fb);
    const pg = Math.round(t.perGame * 10) / 10;
    const sub = h("div", "sub");
    sub.append(h("span", pg > 0 ? "up" : pg < 0 ? "dn" : "", `${pg > 0 ? "+" : pg < 0 ? "−" : "±"}${Math.abs(pg).toFixed(1)} Elo/game`),
      ` at HLTV ${p.rating.toFixed(2)} and ${Math.round(winRate * 100)}% wins`
      + (few ? ` (only ${games} game${games === 1 ? "" : "s"}, counted as ${useRating.toFixed(2)} and ${Math.round(useWin * 100)}%)` : "")
      + ` (win +${t.win}, loss −${t.loss})`);
    if (p.gained !== null) {
      const act = Math.round((p.gained / games) * 10) / 10;
      sub.append(` · actual last ${games}: ${act > 0 ? "+" : act < 0 ? "−" : "±"}${Math.abs(act).toFixed(1)}/game`);
    }
    box.title = `Estimate from the last ${games} games: an even match each game, won ${Math.round(winRate * 100)}% of the time at a ${p.rating.toFixed(2)} HLTV rating.`
      + ` Form Elo = Elo + 500 × (HLTV − 1), the same form the match-room win chance uses.`;
    box.append(h("span", "tag", "Estimate"), go, form, sub);
    root.append(style, box);
    p.standing.append(host);
  }


refreshProfile();return document.querySelector('[data-kee-profile]').shadowRoot.querySelector('.est').textContent;})()