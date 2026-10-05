# Clearway Live

A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) that gives the app **live flight status** and **security wait times**. It holds the data providers' API keys (an app can't keep a secret), caches answers for a couple of minutes, stores nothing and logs no flight numbers.

| Endpoint | Provider | Returns |
|---|---|---|
| `GET /flight?number=DL1234&date=2026-10-05&airport=ATL` | [AeroDataBox](https://aerodatabox.com/) (via RapidAPI) | status, gates, terminals, scheduled/estimated times, baggage belt |
| `GET /wait?airport=CLE` | [TSAWaitTimes.com](https://www.tsawaittimes.com/api) | current security wait in minutes, PreCheck availability |

Either key can be left out; that endpoint answers `503` and the app hides that piece.

## Set up (about 10 minutes)

1. **Flight data**: sign up at <https://rapid.aerodatabox.com/pricing>. The free Basic plan has 600 units a month; Pro is about US$5/month for 6,000. Copy your RapidAPI key.
2. **Wait times** (optional): subscribe at <https://www.tsawaittimes.com/api> (paid) and copy the API key.
3. **Deploy** (free Cloudflare account):
   ```sh
   cd server
   npx wrangler login
   npx wrangler secret put AERODATABOX_KEY      # paste the RapidAPI key
   npx wrangler secret put TSAWAITTIMES_KEY     # optional
   npx wrangler deploy
   ```
   It prints your URL, e.g. `https://clearway-live.<you>.workers.dev`.
4. **Point the app at it** and rebuild:
   ```sh
   CLEARWAY_LIVE_API=https://clearway-live.<you>.workers.dev python3 tools/build.py
   cd android && ./gradlew bundleRelease
   ```
   For GitHub Actions builds, add the URL as a repository *variable* named `CLEARWAY_LIVE_API`.

## Cost

Answers are cached for 2 minutes (flights) and 5 minutes (waits), and the app refreshes a tracked flight every 2 minutes only while it's open. A typical traveller uses a handful of lookups per trip. The Worker itself fits in Cloudflare's free plan.
