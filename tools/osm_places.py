#!/usr/bin/env python3
"""Pull gates and places (food, shops, restrooms...) inside an airport's terminals from OpenStreetMap.

Reads the same cached .osm files as build_basemap.py and prints two JS constants, GATE_POS and
AMEN, in the airport's local metres, ready to paste into airports/<code>/airport.js. Places are
kept only if they're inside a terminal building; the engine works out which walkway and gate
each one is near.

Map data © OpenStreetMap contributors, ODbL 1.0.

Usage: python3 tools/osm_places.py <code> [cache dir]
"""
import json, math, os, sys
import build_basemap as bm                      # shares the per-airport settings and the loader
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

FOOD = {'restaurant', 'fast_food', 'food_court'}
COFFEE = {'cafe', 'ice_cream'}
COFFEE_SHOP = {'coffee', 'pastry', 'bakery', 'confectionery', 'chocolate', 'tea'}
BAR = {'bar', 'pub', 'biergarten'}
SERVICE = {'atm', 'charging_station', 'pharmacy', 'bureau_de_change', 'post_box', 'clinic', 'animal_relief'}

def category(t):
    name = t.get('name', '')
    a, shop = t.get('amenity'), t.get('shop')
    if a == 'toilets': return 'rest'
    if 'lounge' in name.lower() or 'club' in name.lower() and a in FOOD | BAR: return 'play'
    if a in FOOD: return 'food'
    if a in COFFEE or shop in COFFEE_SHOP: return 'coffee'
    if a in BAR: return 'bar'
    if a in SERVICE or shop in ('chemist', 'beauty', 'massage', 'hairdresser', 'mobile_phone'): return 'service'
    if shop: return 'shop'
    return None

def main():
    code = bm.CODE
    nodes, ways = bm.load(sys.argv[2] if len(sys.argv) > 2 else '.')
    P = bm.P
    terms = []
    for wid, nds, t in ways:
        if t.get('aeroway') == 'terminal' and nds[0] == nds[-1]:
            pts = [P(*nodes[n][:2]) for n in nds if n in nodes]
            if len(pts) > 3: terms.append(Polygon(pts).buffer(4))
    inside = unary_union(terms)
    gates, amen, seen = {}, [], set()
    for la, lo, t in nodes.values():
        x, y = P(la, lo)
        if t.get('aeroway') == 'gate' and t.get('ref'):
            gates.setdefault(t['ref'].strip().upper(), [round(x), round(y)])
            continue
        cat = category(t)
        if not cat or not inside.contains(Point(x, y)): continue
        name = t.get('name') or ('Restrooms' if cat == 'rest' else None)
        if not name: continue
        key = (name, round(x / 15), round(y / 15))     # the same place mapped twice
        if key in seen: continue
        seen.add(key)
        amen.append([name, cat, [round(x), round(y)]])
    order = lambda g: (g[0], int(''.join(c for c in g[1:] if c.isdigit()) or 0), g)
    amen.sort(key=lambda a: (a[2][0], a[2][1]))
    print('  // Gate positions (metres) from OpenStreetMap')
    print('  const GATE_POS = {' + ', '.join(f'{g}: {gates[g]}' for g in sorted(gates, key=order)) + '};')
    print('  // [name, category, [x, y]] from OpenStreetMap, inside the terminals')
    print('  const AMEN = [\n' + ',\n'.join('    ' + json.dumps(a, ensure_ascii=False) for a in amen) + ',\n  ];')
    print(f'// {len(gates)} gates, {len(amen)} places', file=sys.stderr)

if __name__ == '__main__':
    main()
