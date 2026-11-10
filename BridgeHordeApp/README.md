# Horde Survival

A mobile game where your squad holds a bridge against waves of zombies. The squad fires on its own; you drag left and right to aim it and to steer into gates that add troops, damage, fire rate, walls or a new weapon, and into crates that give a short power-up. Every third wave brings a boss. There are two maps to play on. The run ends when the last soldier falls, and pays out coins that buy permanent upgrades: a bigger starting squad, more starting damage, stronger walls. A daily challenge gives everyone the same run for a day, with its own leaderboard, and achievements mark milestones along the way.

Built with React Native and drawn with [React Native Skia](https://shopify.github.io/react-native-skia/). The project and package are named `BridgeHorde`; the name players see is "Horde Survival".

## Layout

| Path | What it is |
| --- | --- |
| `game/core.js` | All game rules, as plain JavaScript with no rendering or platform code. Tune gameplay here. |
| `game/audio.js` | Music and sound effects, shared by the app and the browser page. |
| `App.jsx` | The app: drawing, touch input, menus, upgrade shop, achievements, settings, saved runs, haptics. |
| `leaderboard.js` | Client for the global leaderboard. |
| `names.js` | Word lists for leaderboard names (must match the server's). |
| `web/dev.html` | The same game in a browser, for quick gameplay tuning. |
| `__tests__/` | Jest tests for the game rules and the app screens. |
| `../leaderboard/` | The leaderboard server (Cloudflare Worker + D1). |
| `../docs/privacy.html` | Privacy policy page for the store listings. |

## Setup

You need Node 22.11 or newer and the usual React Native tooling: see [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment).

```sh
npm install
```

## Run

```sh
npm start          # Metro, in one terminal
npm run android    # or: npm run ios
```

For iOS, install the pods first, and again whenever native dependencies change:

```sh
bundle install
cd ios && bundle exec pod install
```

Adding or updating a native library (for example `react-native-haptic-feedback`) needs a full native rebuild, not just a Metro reload.

### In a browser

`web/dev.html` runs the same `game/core.js` on a 2D canvas. It loads the game files as modules, so it has to be served over HTTP from this folder:

```sh
npx serve .
```

Then open `/web/dev.html`. Drag or use the arrow keys / A and D to move, P or Escape to pause. It has no leaderboard and no haptics; the daily challenge and the achievements work as in the app.

## Test and lint

```sh
npm test
npm run lint
```

The app tests run the real Skia drawing code through CanvasKit, so they catch drawing errors as well as logic errors.

## Enemies, power-ups and maps

All three are catalogs at the top of `game/core.js`; the numbers are first guesses, to be tuned from playtests.

**Enemies** (`KIND_STATS`). Next to walkers, runners, tanks and the three bosses:

- **Bomber** (from wave 4): bursts when shot and hurts the zombies around it, so one bomber can set off the next. One that reaches a wall blows 40% out of it and is gone; one that reaches the squad costs two soldiers.
- **Weaver** (from wave 6): fast and frail, sways from side to side as it comes.
- **Spitter** (from wave 8): stops well short of the squad and lobs acid at the spot where the squad stands at that moment. Moving away dodges it; standing still costs a soldier. At most three are on the road at once.

**Power-ups** (`POWERUPS`). A crate comes down the road every 14 to 22 seconds; steer the squad into it to take it.

- **Freeze**: the horde and its acid stand still for 4 seconds and nothing new arrives. The wave clock keeps running, which the leaderboard's check on run length relies on.
- **Airstrike**: lands 0.7 seconds later, kills everything on the road and takes 35% of full health off a boss.
- **Rapid fire**: twice the rate of fire for 6 seconds.

**Maps** (`ENVS`). The Map button on the main menu switches between the Sunset Bridge and the Frozen Pass; the pick is kept on the device. On the pass zombies are 15% slower and have 25% more health. A daily challenge ignores the pick: its map follows from the day, so it is the same for everyone. All maps share the leaderboards.

To add a map, add an entry to `ENVS` and a scene for it to `SCENES` in both `App.jsx` and `web/dev.html` (what to draw behind the actors, and optionally in front of them). To add an enemy kind, add it to `KIND_STATS`, give it a share of the spawn roll in `update`, and a palette in `ZPAL` in both renderers.

## Coins and upgrades

A run pays coins when it ends: one per 10 points plus two per wave cleared (`coinsFor` in `game/core.js`). The Upgrades screen on the main menu spends them. Prices and top levels are the `costs` lists in `UPGRADES`, also in `game/core.js`. Leaving a run unfinished and starting a new one pays nothing for the old run.

## Daily challenge

The Daily Challenge button on the main menu starts a run whose gates and horde come from a seed fixed by the date, so every player gets the same ones that day, on the same map. The day is the UTC day (`dayOf` in `game/core.js`), so the challenge changes at 00:00 UTC everywhere. It can be played as often as you like; the best score of the day counts.

Two things differ from an ordinary run:

- Bought upgrades are left out, so everyone starts from the same squad. The run still pays coins.
- The score also goes on the day's own leaderboard (the Today tab). It counts for the best score and the other two boards like any run.

The seed fixes what comes down the bridge, not how it goes: the gates always arrive in the same order, and so do the zombies, but zombie health follows the squad's firepower and a boss on the bridge slows the spawns, as in any run. The gates, the horde, the walkers a summoner raises and the power-up crates each have their own random stream (`rand` in `game/core.js`), so one never shifts another.

## Achievements

`ACHIEVEMENTS` in `game/core.js` lists them: an id, a name, a description, a coin reward, and for most a `when(g)` test that is checked against the run every frame. The others are unlocked where the thing happens (`unlock` in `registerKill` and at game over). Each unlocks once and pays its coins on the spot, also when the run is later abandoned. The app shows a banner when one unlocks and lists them all on the Achievements screen. The rewards are first guesses, like the upgrade prices.

To add one, add an entry to the list. The Achievements screen has room for 13 rows, which is how many there are: a 14th needs smaller rows (`AWARD_ROWS` in `App.jsx` and `web/dev.html`) or a second page.

Never reuse or rename an id: unlocked ids are what is stored on the device.

## Leaderboard

The leaderboard is off until `LEADERBOARD_URL` in `leaderboard.js` is set. To turn it on, deploy the Worker and paste in the URL it prints:

```sh
cd ../leaderboard
npm install
npm run deploy
npm run db:migrate:remote
```

`npm run deploy` creates the database on the first run and `npm run db:migrate:remote` creates its tables. Run the migrate step again after any deploy that adds a file to `leaderboard/migrations/`.

Players are anonymous. The app makes up a random id on first launch and the server derives a display name from it. A player can change the name from the leaderboard screen, but only to one built from the word lists in `names.js`: nothing is typed, so there is nothing to moderate. The server has its own copy of the lists in `leaderboard/src/index.js` and refuses any other name; if you change one copy, change the other (the Worker's tests compare them).

There are three boards: all-time bests, bests for the current week, and the daily challenge (bests for the current day, daily challenge runs only). Weeks start on Monday 00:00 UTC and days at 00:00 UTC. A challenge run that ends within two hours after midnight still counts for the day it was started; later than that it only counts for the other two boards. A cron trigger (set in `wrangler.jsonc`, deployed with the Worker) clears out finished weeks and days once a day. The game-over screen shows the player's place on the all-time and weekly boards, or after a daily run on the daily and all-time boards.

`npm test` in `leaderboard/` runs the Worker's tests. It needs Node 22.13 or newer and no install.

To take an entry off all three boards, run this in `leaderboard/`:

```sh
npm run remove-score -- SwiftOtter482          # a player asked for their entry to be deleted
npm run remove-score -- SwiftOtter482 --ban    # a forged score: also block that player id
```

Names are not unique. If several players share one, the command lists them and changes nothing until you run it again with the id of the one you mean. Add `--local` to act on the local dev database.

## Release builds

- **Android:** `npm run build:apk` (Windows) builds an arm64 release APK and copies it to `dist/HordeSurvival-<version>.apk` at the repo root. On other systems run `./gradlew assembleRelease` in `android/`. Without `android/keystore.properties` and a release keystore the build is signed with the debug keystore.
- **iOS:** after `pod install`, open `ios/BridgeHorde.xcworkspace` in Xcode, set a development team, and archive.

The version lives in three places that should be kept in step: `package.json`, `versionName` in `android/app/build.gradle`, and `MARKETING_VERSION` in the Xcode project.

## Data kept on the device

Best score, coins and upgrades, achievements, the best daily challenge score, the picked map, settings, an unfinished run, the anonymous player id and scores waiting to be sent are stored with AsyncStorage. Nothing else is collected.
