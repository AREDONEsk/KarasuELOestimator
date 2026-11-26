// Elo model for karasu.live, fitted to 89 players across 9 real matches
// (average error about 1 Elo). Karasu does not publish its formula; this is an estimate.
//
//   chance = your team's win chance, from the two teams' average Elo
//   win    = 44 x (1 - chance) x (0.08 + 0.74 x HLTV rating)
//   loss   = 44 x chance       x (1.65 - 0.68 x HLTV rating)
//   standout game (HLTV >= 1.70, the flame icon on Karasu): the win counts as a 2.00 rating,
//   whatever the real rating was. Fits every flame game seen: 1.81 and 2.51 both +33 (2.00 gives
//   33), 1.87 got +44 (2.00 gives 44), and two +48s where 2.00 gives 65 but wins are capped.
//   The flame starts at 1.70 (1.69 does not get one). MVP adds nothing extra.
//   losses are capped at 40 and wins at 48. Every change is at least 1.
//
// Averages must be PRE-match Elo. On a finished match use preMatchAvg() first.
globalThis.KarasuEloModel = (() => {
  const K = 44;
  const LOSS_CAP = 40;
  const WIN_CAP = 48;
  const FLAME_RATING = 1.7; // flame icon from 1.70
  const FLAME_AS = 2.0;     // a flame game's win is worked out as if the rating were this

  const winChance = (ownAvg, enemyAvg) => 1 / (1 + 10 ** ((enemyAvg - ownAvg) / 400));
  const atLeast1 = (x) => Math.max(1, Math.round(x));

  function estimate(ownAvg, enemyAvg, rating) {
    const chance = winChance(ownAvg, enemyAvg);
    const winAt = (r) => K * (1 - chance) * (0.08 + 0.74 * r);
    const win = winAt(rating >= FLAME_RATING ? FLAME_AS : rating);
    return {
      chance,
      win: atLeast1(Math.min(WIN_CAP, win)),
      loss: atLeast1(Math.min(LOSS_CAP, K * chance * (1.65 - 0.68 * rating))),
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

  return { estimate, winChance, preMatchAvg, level, levels: LEVELS };
})();
