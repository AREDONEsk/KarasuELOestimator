# Karasu ELO Estimator

**Unofficial** Chrome extension for [karasu.live](https://karasu.live). It shows each team's win chance and your estimated Elo gain or loss on the match page. It can also accept matches for you if you turn that on.

> Not affiliated with, endorsed by, or made by Karasu.

## Features

- **Win chance** for both teams, from the teams' average Elo.
- **Estimated Elo gain and loss** at your usual HLTV rating, plus the range from a bad game (0.6 rating) to a great game (1.6 rating).
- **Shown on the Overview tab** of every match, before, during and after the game.
- **Optional auto-accept** with an adjustable delay. It is off until you turn it on.

## How the estimate works

Karasu does not publish its Elo formula. This model was fitted to 89 players across 9 real matches and is usually within 1–2 Elo.

```
chance = 1 / (1 + 10 ^ ((enemyAvg - teamAvg) / 400))      // standard Elo win chance
win    = 44 × (1 − chance) × (0.08 + 0.74 × rating)
loss   = 44 × chance       × (1.65 − 0.68 × rating)
```

`rating` is the player's HLTV rating in the match. Every change is capped at 40 and is at least 1.
Your own Elo does not change the result; only the two team averages and how you play do.

The model is in [`model.js`](model.js).

## Install

**From source (Chrome, Edge, Brave, Opera):**

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Click the extension's icon and set your usual HLTV rating.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Extension setup and permissions |
| `model.js` | The Elo estimate formula |
| `content.js` | Reads both teams' Elo on the match page and draws the estimate cards |
| `accept.js` | Optional auto-accept |
| `popup.html`, `popup.js` | Settings popup |
| `icons/`, `assets/icon.svg` | Icons |

## Privacy

The extension collects no data and makes no network requests. It only runs on karasu.live and saves your settings in Chrome's own extension storage. See [PRIVACY.md](PRIVACY.md).

## Permissions

- `storage`: saves your settings.
- Access to `https://karasu.live/*`: reads the match page and shows the estimates there.

## License

[MIT](LICENSE)
