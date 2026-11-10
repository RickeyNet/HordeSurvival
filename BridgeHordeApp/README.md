# Horde Survival

A mobile game where your squad holds a bridge against waves of zombies. The squad fires on its own; you drag left and right to aim it and to steer into gates that add troops, damage, fire rate, walls or a new weapon. Every third wave brings a boss. The run ends when the last soldier falls.

Built with React Native and drawn with [React Native Skia](https://shopify.github.io/react-native-skia/). The project and package are named `BridgeHorde`; the name players see is "Horde Survival".

## Layout

| Path | What it is |
| --- | --- |
| `game/core.js` | All game rules, as plain JavaScript with no rendering or platform code. Tune gameplay here. |
| `game/audio.js` | Music and sound effects, shared by the app and the browser page. |
| `App.jsx` | The app: drawing, touch input, menus, settings, saved runs, haptics. |
| `leaderboard.js` | Client for the global leaderboard. |
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

Then open `/web/dev.html`. Drag or use the arrow keys / A and D to move, P or Escape to pause. It has no leaderboard and no haptics.

## Test and lint

```sh
npm test
npm run lint
```

The app tests run the real Skia drawing code through CanvasKit, so they catch drawing errors as well as logic errors.

## Leaderboard

The leaderboard is off until `LEADERBOARD_URL` in `leaderboard.js` is set. To turn it on, deploy the Worker and paste in the URL it prints:

```sh
cd ../leaderboard
npm install
npm run deploy
npm run db:migrate:remote
```

`npm run deploy` creates the database on the first run and `npm run db:migrate:remote` creates its tables. Run the migrate step again after any deploy that adds a file to `leaderboard/migrations/`.

Players are anonymous. The app makes up a random id on first launch and the server derives a display name from it.

`npm test` in `leaderboard/` runs the Worker's tests. It needs Node 22.13 or newer and no install.

To take an entry off the board, run this in `leaderboard/`:

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

Best score, settings, an unfinished run, the anonymous player id and a score waiting to be sent are stored with AsyncStorage. Nothing else is collected.
