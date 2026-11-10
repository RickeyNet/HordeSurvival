# TODO

## Release blockers
- [ ] Deploy the leaderboard Worker (`leaderboard/`: `npm run deploy`, then `npm run db:migrate:remote`; the daily board needs migration `0004_daily.sql`) and paste its URL into `LEADERBOARD_URL` in `BridgeHordeApp/leaderboard.js`
- [ ] Add the iOS app icon images (the `AppIcon` asset set is empty) and set a development team in Xcode
- [ ] Set up Android release signing (`android/keystore.properties` + release keystore); without it release builds use the debug keystore
- [ ] Check the main menu (new layout: daily challenge button, two rows of two), resume flow, new-run confirmation, first-run hints, settings screen, upgrade shop, achievements screen and unlock banner, a daily run, game-over summary (with the rank line and coins), leaderboard tabs (now three), name picker and haptics on a real device (needs a native rebuild for `react-native-haptic-feedback`)

## Cleanup
- [x] Align version numbers (all 1.1; build numbers stay per platform: Android `versionCode` 2, iOS 1)
- [ ] Settle the name: package/project are "BridgeHorde", display name is "Horde Survival"
- [x] Move off the deprecated `Skia.Path` calls (`moveTo`, `lineTo`, `quadTo`, `addArc`, `close`) to `Skia.PathBuilder`
- [x] Bring `web/dev.html` up to date (main menu, resume, settings, hints, game-over summary; the leaderboard stays app-only)
- [x] Replace the boilerplate React Native README

## Feel
- [x] Haptics on troop lost, boss spawn and game over, with a toggle in settings
- [x] Game-over summary: wave reached, time survived, kills
- [x] Resume a run from the main menu (leaving a paused run keeps it, also across app restarts)
- [x] Confirm before New Run on the main menu when a run is waiting (it discards that run)
- [x] First-run tutorial hints during wave 1 (move, then gates; shown once)

## Reasons to keep playing
- [x] Persistent upgrades: earn coins per run, spend on starting troops, damage, wall strength (prices and coin payout are first guesses; tune from playtests)
- [x] Daily challenge: one fixed seed per day with its own leaderboard (no upgrades in a daily run; unlimited tries, best of the day counts)
- [x] Achievements / milestones (13 to start with, each pays coins once; rewards are first guesses)
- [x] Leaderboard depth: rank on the game-over screen, weekly board, player-chosen names (picked from the word lists, not typed)

## Content
- [ ] More run variety: new enemy kinds, a second environment, temporary power-ups (freeze, airstrike)
- [ ] Difficulty tuning from playtests (track wave reached)

## Technical
- [x] Unit tests for `game/core.js` (wave scaling, gates, walls)
- [x] Review leaderboard anti-cheat in `leaderboard/src/index.js` (request size cap and race-free score write added; follow-ups below)
- [ ] Leaderboard: limit submissions per IP address (Cloudflare rate limiting); today anyone can invent unlimited player ids and fill the board
- [x] Leaderboard: lower the cap on run length in `plausible()` (now 2 hours, so a forged score tops out at 180,100 instead of about 2 million)
- [x] Leaderboard: a way to remove a forged score and keep that player id from coming back (`npm run remove-score -- <name or id> --ban` in `leaderboard/`)
- [ ] Leaderboard: the `COUNT(*)` queries read one row per player on every view; cache the board or keep a counter before the player count grows
- [x] Tests for the leaderboard Worker (`npm test` in `leaderboard/`: `plausible`, submit, bans, ranking)
- [ ] Crash reporting
