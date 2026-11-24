// Elo model for karasu.live, fitted to 89 players across 9 real matches
// (average error about 1 Elo). Karasu does not publish its formula; this is an estimate.
//
//   chance = your team's win chance, from the two teams' average Elo
//   win    = 44 x (1 - chance) x (0.08 + 0.74 x HLTV rating)
//   loss   = 44 x chance       x (1.65 - 0.68 x HLTV rating)
//   every change is capped at 40 (normal matches) and is at least 1
globalThis.KarasuEloModel = (() => {
  const K = 44;
  const CAP = 40;

  const winChance = (ownAvg, enemyAvg) => 1 / (1 + 10 ** ((enemyAvg - ownAvg) / 400));
  const clamp = (x) => Math.max(1, Math.min(CAP, Math.round(x)));

  function estimate(ownAvg, enemyAvg, rating) {
    const chance = winChance(ownAvg, enemyAvg);
    return {
      chance,
      win: clamp(K * (1 - chance) * (0.08 + 0.74 * rating)),
      loss: clamp(K * chance * (1.65 - 0.68 * rating)),
    };
  }

  return { estimate, winChance };
})();
