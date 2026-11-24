// Elo model for karasu.live, fitted to 89 players across 9 real matches
// (average error about 1 Elo). Karasu does not publish its formula; this is an estimate.
//
//   chance = your team's win chance, from the two teams' average Elo
//   win    = 44 x (1 - chance) x (0.08 + 0.74 x HLTV rating)
//   loss   = 44 x chance       x (1.65 - 0.68 x HLTV rating)
//   standout game (HLTV >= ~1.6, the flame icon on Karasu): the win doesn't keep scaling with
//   rating; it's a flat FLAME_BONUS above an average (1.00) game. Seen: +33/+33 (avg game 17)
//   and +48/+48 (avg game 34). The exact threshold is somewhere between 1.46 and 1.81.
//   losses are capped at 40; wins have no fixed cap (+48 seen). Every change is at least 1.
//
// Averages must be PRE-match Elo. On a finished match use preMatchAvg() first.
globalThis.KarasuEloModel = (() => {
  const K = 44;
  const LOSS_CAP = 40;
  const FLAME_RATING = 1.6;
  const FLAME_BONUS = 15;

  const winChance = (ownAvg, enemyAvg) => 1 / (1 + 10 ** ((enemyAvg - ownAvg) / 400));
  const atLeast1 = (x) => Math.max(1, Math.round(x));

  function estimate(ownAvg, enemyAvg, rating) {
    const chance = winChance(ownAvg, enemyAvg);
    const winAt = (r) => K * (1 - chance) * (0.08 + 0.74 * r);
    const win = rating >= FLAME_RATING ? winAt(1) + FLAME_BONUS : winAt(rating);
    return {
      chance,
      win: atLeast1(win),
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

  return { estimate, winChance, preMatchAvg };
})();
