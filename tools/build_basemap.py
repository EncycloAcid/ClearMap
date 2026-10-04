#!/usr/bin/env python3
"""Build the CLE base map layers from OpenStreetMap.

Downloads the area around the Cleveland Hopkins terminal from the OSM API
(or reads a cached cle.osm), projects it to local metres (north up,
origin 41.4100 N, 81.8395 W), simplifies it and writes basemap.js, which
index.html embeds between the BASEMAP markers.

Map data © OpenStreetMap contributors, ODbL 1.0.

Usage: python3 tools/build_basemap.py [path/to/cle.osm]
"""
import json, math, os, sys, urllib.request
import xml.etree.ElementTree as ET

LAT0, LON0 = 41.4100, -81.8395
KX = math.cos(math.radians(LAT0)) * 111320
KY = 110574
CROP = (-700, -800, 800, 800)          # x0, y0, x1, y1 in metres
BBOX = '-81.856,41.398,-81.824,41.422'  # what the OSM API is asked for

def P(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)

def load(path):
    if not os.path.exists(path):
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={BBOX}'
        print('downloading', url)
        urllib.request.urlretrieve(url, path)
    root = ET.parse(path).getroot()
    nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon')), {t.get('k'): t.get('v') for t in n.findall('tag')})
             for n in root.findall('node')}
    ways = [(w.get('id'), [nd.get('ref') for nd in w.findall('nd')], {t.get('k'): t.get('v') for t in w.findall('tag')})
            for w in root.findall('way')]
    return nodes, ways

def dp(pts, tol):
    """Douglas-Peucker simplification."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy)
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        # a closed ring starts and ends on the same point, so measure from that point instead of a line
        d = (abs(dy * pts[k][0] - dx * pts[k][1] + b[0] * a[1] - b[1] * a[0]) / L) if L > 1e-9 else math.dist(pts[k], a)
        if d > dmax: i, dmax = k, d
    if dmax <= tol: return [a, b]
    return dp(pts[:i + 1], tol)[:-1] + dp(pts[i:], tol)

def inside(pts):
    x0, y0, x1, y1 = CROP
    return any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in pts)

def path(pts, closed):
    s = 'M' + 'L'.join(f'{round(x)} {round(y)}' for x, y in pts)
    return s + ('Z' if closed else '')

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'cle.osm'
    nodes, ways = load(src)
    L = {k: [] for k in ['grass', 'wood', 'water', 'apron', 'taxiway', 'runway', 'lots', 'motorway', 'major', 'minor',
                         'service', 'rail', 'buildings', 'garage', 'termA', 'termB', 'termC', 'termM', 'termD', 'bridges']}
    stands = []
    for wid, nds, t in ways:
        pts = [P(*nodes[n][:2]) for n in nds if n in nodes]
        if len(pts) < 2 or not inside(pts): continue
        closed = nds[0] == nds[-1]
        simp = dp(pts, 0.8)
        aw, hw, lu, nat = t.get('aeroway'), t.get('highway'), t.get('landuse'), t.get('natural')
        name = t.get('name', '')
        if aw == 'terminal' and 'Concourse D' in name: L['termD'].append(path(simp, True))
        elif aw == 'terminal' and 'Concourse A' in name: L['termA'].append(path(simp, True))
        elif aw == 'terminal' and 'Concourse B' in name: L['termB'].append(path(simp, True))
        elif aw == 'terminal' and 'Concourse C' in name: L['termC'].append(path(simp, True))
        elif aw == 'terminal' and 'Main Terminal' in name: L['termM'].append(path(simp, True))
        elif t.get('parking') == 'multi-storey': L['garage'].append(path(simp, True))
        elif aw == 'jet_bridge': L['bridges'].append(path(simp, False))
        elif aw == 'parking_position' and len(pts) >= 2: stands.append((pts[0], pts[-1], t.get('ref', '')))
        elif aw == 'apron' and closed: L['apron'].append(path(simp, True))
        elif aw == 'taxiway': L['taxiway'].append(path(simp, False))
        elif aw == 'runway': L['runway'].append(path(simp, closed))
        elif (t.get('building') or aw in ('hangar', 'terminal')) and closed: L['buildings'].append(path(simp, True))
        elif t.get('amenity') == 'parking' and closed: L['lots'].append(path(simp, True))
        elif lu in ('grass', 'meadow') or t.get('leisure') == 'park': L['grass'].append(path(simp, closed))
        elif nat in ('wood', 'scrub', 'wetland') or lu == 'forest': L['wood'].append(path(simp, closed))
        elif nat == 'water' or t.get('waterway'): L['water'].append(path(simp, closed))
        elif hw in ('motorway', 'trunk'): L['motorway'].append(path(simp, False))
        elif hw in ('motorway_link', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'): L['major'].append(path(simp, False))
        elif hw in ('tertiary', 'unclassified', 'residential'): L['minor'].append(path(simp, False))
        elif hw == 'service' and t.get('service') not in ('parking_aisle',): L['service'].append(path(simp, False))
        elif t.get('railway') in ('rail', 'subway') and t.get('tunnel') != 'yes': L['rail'].append(path(simp, False))
    # Aircraft at about two thirds of stands, picked by stand position so it never changes.
    # A stand line starts at the nose stop point; the aircraft sits ~17 m behind it, nose to the terminal.
    planes = []
    gates = [P(la, lo) for la, lo, t in nodes.values() if t.get('aeroway') == 'gate']
    near = lambda p: min(math.dist(p, g) for g in gates) if gates else 0
    for (a, b, ref) in stands:
        if near(b) < near(a): a, b = b, a          # the nose end is the one nearest a gate
        if near(a) > 45: continue                  # remote stands: leave empty
        if int(abs(a[0] * 7 + a[1] * 13)) % 3 == 0: continue
        dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 1
        ux, uy = dx / d, dy / d
        cx, cy = a[0] + ux * 17, a[1] + uy * 17
        planes.append([round(cx, 1), round(cy, 1), round(math.degrees(math.atan2(-ux, uy)), 1)])  # SVG rotate() so the nose (0,-1) faces the gate
    out = {k: ''.join(v) for k, v in L.items()}
    out['planes'] = planes
    js = 'const BASEMAP = ' + json.dumps(out, separators=(',', ':')) + ';\n'
    open('basemap.js', 'w').write(js)
    print('basemap.js', len(js) // 1024, 'KB', {k: len(v) for k, v in L.items()}, 'planes', len(planes))

if __name__ == '__main__':
    main()
