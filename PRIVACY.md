# Karasu ELO Estimator – Privacy Policy

Last updated: 27 November 2026

Karasu ELO Estimator is an unofficial browser extension for karasu.live. It is not affiliated with, endorsed by, or made by Karasu.

## Summary

The extension does not collect, sell, or share any personal data. It does not send any data to the developer or to any third party. Everything it does happens inside your own browser, apart from one read-only request to karasu.live's own public stats service, described below.

## What the extension reads

On karasu.live pages, the extension reads what karasu.live already shows you:

- on match pages, the team names, each player's Elo, and (on finished matches) the scoreboard with each player's Elo change
- on your own profile, your current Elo and HLTV rating

It uses this only to calculate each team's win chance and the estimated Elo gain or loss, and shows the result on the same page.

## Network requests

When you open your own karasu.live profile, the extension asks karasu.live's public stats API (api.karasu.live) for the HLTV ratings of your last 30 games, the same data your profile page loads. It sends only your public Steam ID, which is already in the page address. It does this at most once every 5 minutes, and uses the answer only to work out your usual HLTV range. The extension makes no other network requests, and never contacts any server run by the developer.

## What the extension stores

The extension saves a small amount of data using Chrome's built-in extension storage:

- whether the overlay is turned on
- your own current Elo, your usual HLTV rating and HLTV range, used for the estimate, and when they were last updated
- whether auto-accept is turned on, and the delay before accepting
- for up to the 50 most recent finished matches you opened, the scoreboard rows shown there (player names and each player's Elo before that match), so the estimate stays correct when you return to the match overview

This data stays in your Chrome profile. If you are signed in to Chrome with sync turned on, Chrome may sync your settings (not the saved scoreboards) between your own devices, as it does for any extension setting. The developer cannot see any of it.

## What the extension does not do

- It does not send any data to the developer or to any third party.
- It makes no network requests other than the karasu.live stats request described above.
- It does not read your karasu.live login, passwords, or account details.
- It does not track your browsing; it only runs on karasu.live.
- It does not use analytics, advertising, or cookies.

## Auto-accept

If you turn on auto-accept, the extension clicks karasu.live's own accept button when a match is found, after the delay you set. It does not record this or send it anywhere. It is off until you turn it on.

## Removing your data

Uninstalling the extension deletes all of its saved data.

## Changes to this policy

If this policy changes, the updated version will be published at this same address with a new date.

## Contact

Open an issue on this GitHub repository, or use the contact email on the extension's Chrome Web Store page.
