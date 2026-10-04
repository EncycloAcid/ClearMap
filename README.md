# ClearMap: CLE Gate Finder

An interactive map of Cleveland Hopkins International Airport (CLE). It runs as an Android app, and the same map is a self-contained web page, `index.html`, that opens in any browser.

- **Zoom and pan:** scroll, pinch, or drag the map. The A/B/C buttons jump to a concourse.
- **Gates:** every active gate from A1–A14, B1–B11 and C2–C29, colour-coded by concourse.
- **Airlines:** tap one to light up its concourse's gates.
- **Directions:** turn-by-turn walking routes between any gate, amenity, the TSA checkpoint, baggage claim, the RTA Red Line and ground transport, with distance and walking time.
- **Pass the time:** pick your gate and how long until boarding. It lists nearby food, bars, shops, massage chairs and other distractions. Each one is marked Fits / Tight / Skip, based on the round-trip walk and the time you'd spend there. Tap *Surprise me* for a random pick.
- **Search and filters:** search gates, airlines or places. Use the category chips to show or hide amenity types.

The layout and amenities come from the airport's published terminal directory. Gate assignments change, so always check your boarding pass. This is not an official airport map.

## Android app

The `android/` folder is a native Android app (Kotlin, Android 8.0+). It shows the map in a full-screen WebView and works offline, with the fonts bundled in the APK. The Back button closes an open info card or search before it leaves the app.

The app loads the same `index.html` as the web version. A build step copies it into the APK, so you only edit the map in one place.

### Install on a phone

1. Get `app-release.apk`. Every push builds it in GitHub Actions: open **Actions → Android APK → latest run**, then download it under **Artifacts**.
2. Copy it to the phone and open it. Android will ask you to allow installs from that app (Files, Chrome, etc.) the first time.

### Build it yourself

You need JDK 17+ and the Android SDK (Android Studio installs both).

```sh
cd android
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk
```

Or open the `android/` folder in Android Studio and press Run.

The release build is signed with the Android debug key so it installs right away. Before you publish to Google Play, set up your own signing key in `android/app/build.gradle.kts`.
