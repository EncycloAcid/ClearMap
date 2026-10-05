# Publishing Clearway on Google Play

Everything in the repo is ready: the app targets Android 16 (API 36, which Google Play has required for new apps and updates since 31 August 2026), release builds are shrunk with R8 and signed with your upload key, and the store listing, images and privacy policy are written. What's left needs your Google account and decisions.

## 1. Create your upload key (once)

On your own computer, from the repo root:

```sh
tools/make_upload_key.sh
```

It creates `android/upload-key.jks` and `android/keystore.properties`. Neither is committed. **Back both up** (a password manager is ideal). With Play App Signing (step 3), Google holds the key that signs what users install; this one only proves uploads come from you, and Google can reset it if it's lost.

## 2. Build the app bundle

```sh
python3 tools/build.py          # if you changed src/ or airports/
cd android && ./gradlew bundleRelease
```

Upload `android/app/build/outputs/bundle/release/app-release.aab`.

To have GitHub Actions build it signed instead, add these repository secrets (Settings → Secrets and variables → Actions); the workflow then attaches `clearway-play-bundle` to each run:

| Secret | Value |
|---|---|
| `CLEARWAY_KEYSTORE_B64` | `base64 -w0 android/upload-key.jks` |
| `CLEARWAY_KEYSTORE_PASSWORD` | the password you chose |
| `CLEARWAY_KEY_ALIAS` | `upload` |
| `CLEARWAY_KEY_PASSWORD` | the password you chose |

For every later update, raise `versionCode` (and `versionName`) in `android/app/build.gradle.kts`.

## 3. Play Console

1. Create a developer account at <https://play.google.com/console> (one-time US$25, identity verification).
2. **Create app**: name *Clearway: Airport Maps*, default language English (US), App, Free. Package name is fixed forever once you upload: `io.github.encycloacid.clearmap`.
3. Accept **Play App Signing** when you upload the first bundle.
4. **Privacy policy URL**: publish `privacy.html` (step 4) and enter `https://encycloacid.github.io/ClearMap/privacy.html`.

### Store listing (copy from `fastlane/metadata/android/en-US/`)

| Field | File |
|---|---|
| App name (30) | `title.txt` |
| Short description (80) | `short_description.txt` |
| Full description (4000) | `full_description.txt` |
| App icon 512×512 | `images/icon.png` |
| Feature graphic 1024×500 | `images/featureGraphic.png` |
| Phone screenshots 1080×1920 | `images/phoneScreenshots/` (7) |
| Release notes | `changelogs/<versionCode>.txt` |

Regenerate the images after UI changes with `node tools/store_assets.js` (needs Playwright).

### App content answers

- **Category**: Travel & Local. Tags: Maps, Navigation, Travel.
- **Ads**: No.
- **Data safety**: location is used on the device only and never leaves it, so it isn't "collected". Flight tracking sends the **flight number** (with the date and airport code) to the Clearway Live server and on to AeroDataBox. Declare: *Data collected* → **App activity › Other actions** (or *Other user-generated content*, whichever the form offers for "a flight number you type"), **processed ephemerally: yes**, **required: no** (optional feature), purpose **App functionality**; *Data shared*: **No** (sending data to a service provider that acts for you isn't "sharing" under Google's definitions). *Encrypted in transit*: **Yes**. *Can users request deletion*: there is nothing stored to delete; say no data is retained. Account deletion: not applicable (no accounts).
- **Content rating** (IARC questionnaire): category *Reference, News or Educational* or *Utility*; answer No to everything (no violence, user content, purchases or location sharing with others). Expect *Everyone / PEGI 3*.
- **Target audience**: 18+ is simplest (13+ also fine); the app isn't designed for children.
- **Government app / financial / health**: No.
- **Permissions**: location (foreground only, shown on the map when you tap the location button) and notifications (gate reminders). No background location, so no extra declaration.

## Live flight status and security waits

Set up the Clearway Live server first (`server/README.md`): it holds the AeroDataBox and TSAWaitTimes.com keys and the app talks only to it. Build with its URL:

```sh
CLEARWAY_LIVE_API=https://clearway-live.<you>.workers.dev python3 tools/build.py
```

or set the repository variable `CLEARWAY_LIVE_API` for GitHub Actions. A build without it still works; the flight box says live status isn't connected and no wait times are shown. Don't commit an `index.html` built with the URL (CI checks `index.html` is built without it).

## 4. Host the privacy policy

Turn on GitHub Pages for this repository (Settings → Pages → Deploy from a branch → `main`, `/ (root)`). The policy is then at `https://encycloacid.github.io/ClearMap/privacy.html`, which is also linked inside the app next to the map credit. The same site serves the web version of the map at `/ClearMap/`. Any other public URL works too; update the link in `src/shell.html` if you use one.

## 5. Testing before production

If your developer account is a **personal account created after 13 November 2023**, Google requires a **closed test with at least 12 testers, opted in continuously for 14 days**, before you can apply for production access. Create a closed testing track, add testers by email or Google Group, share the opt-in link, and keep them installed for the 14 days. Organisation accounts can go straight to production (an internal test first is still a good idea).

## Before you submit, check

- [ ] Walk through both airports on a real phone (location, reminders, the Back gesture, dark mode).
- [ ] The **Clearway** name isn't already a registered trademark for apps in your market (search USPTO/EUIPO and the Play Store).
- [ ] Airline concourses and Cleveland's hours are still current (`airports/*/airport.js`).
- [ ] Airline marks use only names, two-letter codes and colours, no logos.

## Apple App Store

The app is Android only. An iPhone version would wrap the same `index.html` in a WKWebView app (Swift, or Capacitor) and must be built and submitted from a Mac with Xcode and a US$99/year Apple Developer account. Most of the map works unchanged; the Android parts (reminders, shortcuts, the back gesture, location prompt) would need iOS equivalents.
