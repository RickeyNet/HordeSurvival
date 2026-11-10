# TODO

## Release blockers
- [ ] Deploy the leaderboard Worker (`leaderboard/`) and paste its URL into `LEADERBOARD_URL` in `BridgeHordeApp/leaderboard.js`
- [ ] Add the iOS app icon images (the `AppIcon` asset set is empty) and set a development team in Xcode
- [ ] Set up Android release signing (`android/keystore.properties` + release keystore); without it release builds use the debug keystore
- [ ] Check the main menu, resume flow, settings screen, game-over summary and haptics on a real device (needs a native rebuild for `react-native-haptic-feedback`)

## Cleanup
- [ ] Align version numbers (`package.json` 0.0.1, Android 1.1, iOS 1.0)
- [ ] Settle the name: package/project are "BridgeHorde", display name is "Horde Survival"
- [ ] Move off the deprecated `Skia.Path` calls (`moveTo`, `lineTo`, `quadTo`, `addArc`, `close`) to `Skia.PathBuilder`
- [ ] Bring `web/dev.html` up to date (no leaderboard, no main menu or settings)
- [ ] Replace the boilerplate React Native README

## Feel
- [x] Haptics on troop lost, boss spawn and game over, with a toggle in settings
- [x] Game-over summary: wave reached, time survived, kills
- [x] Resume a run from the main menu (leaving a paused run keeps it, also across app restarts)
- [ ] Confirm before New Run on the main menu when a run is waiting (it discards that run)
- [ ] First-run tutorial hints during wave 1

## Reasons to keep playing
- [ ] Persistent upgrades: earn coins per run, spend on starting troops, damage, wall strength
- [ ] Daily challenge: one fixed seed per day with its own leaderboard
- [ ] Achievements / milestones (e.g. reach wave 10, beat a boss with the rifle)
- [ ] Leaderboard depth: rank on the game-over screen, weekly board, player-chosen names

## Content
- [ ] More run variety: new enemy kinds, a second environment, temporary power-ups (freeze, airstrike)
- [ ] Difficulty tuning from playtests (track wave reached)

## Technical
- [ ] Unit tests for `game/core.js` (wave scaling, gates, walls)
- [ ] Review leaderboard anti-cheat in `leaderboard/src/index.js`
- [ ] Crash reporting
