# TODO

## Release blockers
- [ ] Deploy the leaderboard Worker (`leaderboard/`: `npm run deploy`, then `npm run db:migrate:remote`; the daily board needs migration `0004_daily.sql`, ranks and totals need `0005_score_counts.sql`) and paste its URL into `LEADERBOARD_URL` in `BridgeHordeApp/leaderboard.js`
- [ ] Add the iOS app icon images (the `AppIcon` asset set is empty) and set a development team in Xcode
- [ ] Set up Android release signing (`android/keystore.properties` + release keystore); without it release builds use the debug keystore
- [ ] Check the main menu (new layout: map button on top, daily challenge button, two rows of two), resume flow, new-run confirmation, first-run hints, settings screen, upgrade shop, achievements screen and unlock banner, a daily run, game-over summary (with the rank line and coins), leaderboard tabs (now three), name picker, the Frozen Pass, the new enemies and the power-up crates and haptics on a real device (needs a native rebuild for `react-native-haptic-feedback`)

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
- [x] More run variety: new enemy kinds (bomber, weaver, spitter), a second environment (Frozen Pass, picked on the menu), temporary power-ups (freeze, airstrike, rapid fire)
- [ ] Tune the new content from playtests: spawn shares and wave gates of the new kinds, spitter range and rate, crate interval, effect lengths, the Frozen Pass multipliers
- [x] Small content extras: a first-time hint for crates, three achievements for the new content (Chain Reaction, Fully Loaded, Icebreaker; the Achievements screen now has pages of eight), and a boss for the Frozen Pass (the yeti: its ice stops the squad's fire for a moment)
- [ ] Tune the yeti from playtests: health, how often it throws, how long the guns stay frozen (`ICE_EVERY`, `CHILL_TIME`); and the bar for Chain Reaction (`CHAIN_KILLS`)
- [ ] Difficulty tuning from playtests (track wave reached)

## Technical
- [x] Unit tests for `game/core.js` (wave scaling, gates, walls)
- [x] Review leaderboard anti-cheat in `leaderboard/src/index.js` (request size cap and race-free score write added; follow-ups below)
- [x] Leaderboard: limit submissions per IP address without storing it (10 new player ids a day per address, counted under a short hash with a daily key, plus Cloudflare's rate limiter for bursts; needs migration `0006_ip_limits.sql`). Someone who rotates addresses (VPNs, proxies) still gets past it
- [x] Leaderboard: lower the cap on run length in `plausible()` (now 2 hours, so a forged score tops out at 180,100 instead of about 2 million)
- [x] Leaderboard: a way to remove a forged score and keep that player id from coming back (`npm run remove-score -- <name or id> --ban` in `leaderboard/`)
- [x] Leaderboard: the `COUNT(*)` queries read one row per player on every view (ranks and totals now come from a `score_counts` table that triggers keep current: under 1,000 rows per view however many players; needs migration `0005_score_counts.sql`)
- [x] Tests for the leaderboard Worker (`npm test` in `leaderboard/`: `plausible`, submit, bans, ranking)
- [ ] Crash reporting
