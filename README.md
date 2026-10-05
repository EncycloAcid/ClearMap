# Clearway

*Your clear way through the airport.* (Formerly CLE Gate Finder.)

Clearway is an interactive airport map. It starts with Cleveland Hopkins International (CLE) and is built so more airports can be added. It runs as an Android app, and the same map is a self-contained web page, `index.html`, that opens in any browser.

**Design:** iOS sets the structure and Material 3 Expressive sets the character.
- **iOS:** a full-screen map, frosted-glass controls, a draggable bottom sheet with peek, half and full heights (a sidebar on wide screens), a segmented control, inset grouped lists, and Apple-Maps-style dotted walking routes with a moving puck.
- **Material 3 Expressive:** bold Roboto Flex numerals, springy motion, tonal colours, concourse badges coded by shape (A circle, B clover, C cookie), button groups and an extended FAB that change shape when pressed, and a thick-track slider.

- **Zoom and pan:** scroll, pinch, or drag the map. The A/B/C buttons jump to a concourse.
- **Gates:** every active gate from A1–A14, B1–B11 and C2–C29, colour-coded by concourse.
- **Airlines:** tap one to light up its concourse's gates.
- **Directions:** turn-by-turn walking routes between any gate, amenity, the TSA checkpoint, baggage claim, the RTA Red Line and ground transport, with distance and walking time.
- **Pass the time:** pick your gate and how long until boarding. It lists nearby food, bars, shops, massage chairs and other distractions. Each one is marked Fits / Tight / Skip, based on the round-trip walk and the time you'd spend there. Tap *Surprise me* for a random pick.
- **Search and filters:** search gates, airlines or places. Tapping the empty search box shows airlines, your recent picks and popular spots. Matches show in bold, and gate searches are forgiving ("c 22" finds C22). Use the category chips to show or hide amenity types.
- **Map:** traced from OpenStreetMap, north up. It shows the real terminal and concourse outlines, gate positions, jet bridges, aircraft at their actual stands, taxiways, roads and the parking garage. Panning has momentum after a flick and stops before you lose the airport. A scale bar appears while you zoom, and you can double-tap to zoom.
- **Routes and pins:** routes draw themselves in, with start and end markers and a walking-time bubble. Tapping a place drops a balloon pin with its category icon, and tapping a route step jumps the map to it. Place names appear only where they have room.
- **Your location:** tap the arrow button to see a blue dot with its GPS accuracy. Choose "My location" as a route start. The Android app asks for location permission the first time you use it.
- **Opening hours:** shops, restaurants and services show whether they're open now, using the official CLE directory ([shop-cle.com](https://shop-cle.com/)) and Cleveland time. For example: *Opens 4:30 AM*, *Open 24 hours*, *Closed today*, or *Open until 6:00 PM*. The directory publishes opening times only, so after 9 PM places without a closing time say *may be closing*. Closed places are greyed on the map, skipped by the nearest-place buttons, and marked in *Pass the time*.
- **Step-free routes:** turn on *Step-free route* and directions use the elevators (by ticketing, beside the checkpoint, and down to the RTA platform) instead of escalators, with a short elevator wait added to the time. Elevators, wheelchair-accessible restrooms and water fountains from OpenStreetMap are on the map, and *Nearest restroom* picks an accessible one.
- **Upper and lower levels:** the **U / L** switch flips between the upper level (gates, security, ticketing) and the lower level (baggage claim, ground transportation, RTA). Each floor shows its own walkways from OpenStreetMap and its own places. Routes that change floor fade the part on the other floor and mark the escalators; tap a badge to switch. Picking a place or a route step on the other floor switches automatically.
- **Arrivals:** switch the Directions sheet to *Arrive* and pick your arrival gate and where you're going: RTA Red Line, rideshare, taxi, arrivals curb, rental car shuttle, hotel or parking shuttle, or baggage claim. The route goes through the exit lane and down the escalators to baggage claim. If you checked bags, the total time includes about 20 minutes for them; you can enter your carousel number if you know it.
- **Nearest…:** one tap finds the nearest restroom, coffee, food, bar or charging spot, or routes to your gate. It starts from your location when the app knows it.
- **Leave-by time:** set when boarding starts and the app shows when to head to your gate, based on the walk from where you are. In the Android app, *Remind me when to leave* sends a notification at that time.
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

## Map data

The base map comes from [OpenStreetMap](https://www.openstreetmap.org/copyright) and is © OpenStreetMap contributors, available under the Open Database License. To regenerate it, run `python3 tools/build_basemap.py`. The script downloads the CLE area and writes `basemap.js`. Paste that between the `BASEMAP:start` and `BASEMAP:end` markers in `index.html`.

## Project layout

| Path | What it is |
|---|---|
| `src/shell.html` | Page markup, styles and the script prelude |
| `src/engine.js` | Routing engine (works for any airport) |
| `src/ui.js` | The app (works for any airport) |
| `airports/<code>/airport.js` | One airport's data: gates, walkways, places, hours, airlines, map labels, arrival tips, time zone |
| `airports/<code>/basemap.js` | That airport's OpenStreetMap layers |
| `tools/build.py` | Builds `index.html` from all of the above |
| `tools/build_basemap.py` | Regenerates an airport's base map from OpenStreetMap |

Edit the files in `src/` and `airports/`, then run `python3 tools/build.py`. Don't edit `index.html` by hand; it's generated. The Android app packages the built `index.html`.

## Adding an airport

Two airports are included: Cleveland Hopkins (CLE) and Hartsfield–Jackson Atlanta (ATL).

1. Add the airport's settings (origin, crop, OSM bounding boxes, terminal names, floor levels) to `AIRPORTS` in `tools/build_basemap.py`, then run `python3 tools/build_basemap.py <code>` to write `airports/<code>/basemap.js`.
2. Run `python3 tools/osm_places.py <code>` to print its gates and places (food, shops, restrooms…) from OpenStreetMap, ready to paste.
3. Write `airports/<code>/airport.js` (see `airports/atl/airport.js`): the walkway graph (`V`, `EDGES`, `SPINES`), concourses with colours and badge shapes, airlines and the concourses they use, places, labels, arrival tips and time zone. Edges can be walkways, escalators (`esc`), elevators (`lift`), an airport train (`train`, with `board` edges to its platforms) or one-way exits (`exit`). Register it as `AIRPORTS.<CODE>`.
4. Run `python3 tools/build.py`. The new airport appears in the airport picker (tap the airport name above the sheet title).

## Publishing

See [STORE.md](STORE.md) for releasing on Google Play: signing, the app bundle, the store listing and the privacy policy.

## Live data

Live flight status and security wait times come from a small Cloudflare Worker in `server/` that holds the data providers' keys. See [server/README.md](server/README.md) to deploy it and connect the app.
