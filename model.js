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
