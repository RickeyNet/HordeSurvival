# TODO

## Release blockers
- [ ] Deploy the leaderboard Worker (`leaderboard/`) and paste its URL into `LEADERBOARD_URL` in `BridgeHordeApp/leaderboard.js`
- [ ] Add the iOS app icon images (the `AppIcon` asset set is empty) and set a development team in Xcode
- [ ] Set up Android release signing (`android/keystore.properties` + release keystore); without it release builds use the debug keystore
- [ ] Check the main menu, resume flow, new-run confirmation, first-run hints, settings screen, game-over summary and haptics on a real device (needs a native rebuild for `react-native-haptic-feedback`)

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
- [ ] Persistent upgrades: earn coins per run, spend on starting troops, damage, wall strength
- [ ] Daily challenge: one fixed seed per day with its own leaderboard
- [ ] Achievements / milestones (e.g. reach wave 10, beat a boss with the rifle)
- [ ] Leaderboard depth: rank on the game-over screen, weekly board, player-chosen names

## Content
- [ ] More run variety: new enemy kinds, a second environment, temporary power-ups (freeze, airstrike)
- [ ] Difficulty tuning from playtests (track wave reached)

## Technical
- [x] Unit tests for `game/core.js` (wave scaling, gates, walls)
- [x] Review leaderboard anti-cheat in `leaderboard/src/index.js` (request size cap and race-free score write added; follow-ups below)
- [ ] Leaderboard: limit submissions per IP address (Cloudflare rate limiting); today anyone can invent unlimited player ids and fill the board
- [ ] Leaderboard: lower the 24-hour cap on run length in `plausible()`; it currently lets a forged score of about 2 million through
- [ ] Leaderboard: a way to remove a forged score and keep that player id from coming back
- [ ] Leaderboard: the `COUNT(*)` queries read one row per player on every view; cache the board or keep a counter before the player count grows
- [ ] Tests for the leaderboard Worker (`plausible`, submit, ranking)
- [ ] Crash reporting
