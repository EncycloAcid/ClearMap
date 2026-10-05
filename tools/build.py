#!/usr/bin/env python3
"""Assemble index.html from the app sources and every airport pack.

  src/shell.html          page markup, styles and the script prelude
  airports/<code>/basemap.js   OpenStreetMap layers (tools/build_basemap.py)
  airports/<code>/airport.js   that airport's data: gates, walkways, places, hours, labels
  src/engine.js           routing engine (airport-independent)
  src/ui.js               the app (airport-independent)

Usage: python3 tools/build.py   (run from anywhere)
Set CLEARWAY_LIVE_API to the Clearway Live server's URL (server/README.md) to switch on live flight
status and security waits; without it those features say they aren't connected.
"""
import glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()

parts = [read('src/shell.html')]
for d in sorted(glob.glob(os.path.join(ROOT, 'airports', '*', ''))):
    code = os.path.basename(os.path.dirname(d))
    parts.append(f'/* ---- airport: {code} (map data © OpenStreetMap contributors, ODbL) ---- */\n')
    parts.append(read(f'airports/{code}/basemap.js'))
    parts.append(read(f'airports/{code}/airport.js'))
parts += [read('src/engine.js'), read('src/ui.js')]
live = os.environ.get('CLEARWAY_LIVE_API', '').strip().rstrip('/')
if live:
    assert live.startswith('https://') and "'" not in live, 'CLEARWAY_LIVE_API must be an https URL'
    parts[0] = parts[0].replace("const LIVE_API = '';", f"const LIVE_API = '{live}';", 1)
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(''.join(parts))
print('index.html', sum(len(p) for p in parts) // 1024, 'KB from', len(parts), 'parts')
