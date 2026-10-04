# ClearMap: CLE Gate Finder

An interactive map of Cleveland Hopkins International Airport (CLE). It runs as an Android app, and the same map is a self-contained web page, `index.html`, that opens in any browser.

**Design:** iOS sets the structure and Material 3 Expressive sets the character.
- **iOS:** a full-screen map, frosted-glass controls, a draggable bottom sheet with peek, half and full heights (a sidebar on wide screens), a segmented control, inset grouped lists, and Apple-Maps-style dotted walking routes with a moving puck.
- **Material 3 Expressive:** bold Roboto Flex numerals, springy motion, tonal colours, concourse badges coded by shape (A circle, B clover, C cookie), button groups and an extended FAB that change shape when pressed, and a thick-track slider.

- **Zoom and pan:** scroll, pinch, or drag the map. The A/B/C buttons jump to a concourse.
- **Gates:** every active gate from A1–A14, B1–B11 and C2–C29, colour-coded by concourse.
- **Airlines:** tap one to light up its concourse's gates.
- **Directions:** turn-by-turn walking routes between any gate, amenity, the TSA checkpoint, baggage claim, the RTA Red Line and ground transport, with distance and walking time.
- **Pass the time:** pick your gate and how long until boarding. It lists nearby food, bars, shops, massage chairs and other distractions. Each one is marked Fits / Tight / Skip, based on the round-trip walk and the time you'd spend there. Tap *Surprise me* for a random pick.
- **Search and filters:** search gates, airlines or places. Tapping the empty search box shows airlines, your recent picks and popular spots. Matches show in bold, and gate searches are forgiving ("c 22" finds C22). Use the category chips to show or hide amenity types.
- **Map:** buildings have a soft raised look and each concourse a faint tint of its colour, with jet bridges and parked aircraft at the gates. Panning has momentum after a flick and stops before you lose the airport. A scale bar appears while you zoom, and you can double-tap to zoom.
- **Routes and pins:** routes draw themselves in, with start and end markers and a walking-time bubble. Tapping a place drops a balloon pin with its category icon, and tapping a route step jumps the map to it. Place names appear only where they have room.
- **Remembers your trip:** your route, gate, boarding time and tab are saved on this device between launches.

The layout and amenities come from the airport's published terminal directory. Gate assignments change, so always check your boarding pass. This is not an official airport map.

## Android app

The `android/` folder is a native Android app (Kotlin, Android 8.0+). It shows the map in a full-screen WebView and works offline, with the font bundled in the APK. The map runs edge-to-edge behind the status and navigation bars, and taps give light haptic feedback. Back closes search, a place card, or a full-height sheet before it leaves the app.

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
