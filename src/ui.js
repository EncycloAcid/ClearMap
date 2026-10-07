// Window size, read once and on resize: reading innerWidth while the overlay is dirty forces a
// full layout of the SVG (every label) mid-gesture, which was most of a pinch's frame time.
let vw = innerWidth, vh = innerHeight;
addEventListener('resize', () => { vw = innerWidth; vh = innerHeight; });
// ---------- Shapes & icons ----------
// Material 3 Expressive-style shapes: A = circle, B = 4-lobe clover, C = 9-scallop cookie.
function blob(n, amp, R = 10) {
  if (!n) return `M${R} 0A${R} ${R} 0 1 1 ${-R} 0A${R} ${R} 0 1 1 ${R} 0Z`;
  let d = '';
  for (let i = 0; i <= 144; i++) {
    const th = i / 144 * Math.PI * 2, r = R * (1 + amp * Math.cos(n * th)) / (1 + amp);
    d += (i ? 'L' : 'M') + (r * Math.sin(th)).toFixed(2) + ' ' + (-r * Math.cos(th)).toFixed(2);
  }
  return d + 'Z';
}
const CON_SHAPE = Object.fromEntries(AP.concourses.map(c => [c.id, blob(...(c.shape || [0, 0]))]));
// Each concourse's colour, light and dark, and the rules that use it
{
  const light = AP.concourses.map(c => `--con${c.id}: ${c.color[0]};`).join(' '), dark = AP.concourses.map(c => `--con${c.id}: ${c.color[1]};`).join(' ');
  const rules = AP.concourses.map(({ id }) => `.con-shape.${id}, .gate.${id} .pill, .gate.${id} .stem { fill: var(--con${id}); }
.gate-chip.${id}, .tile.${id} { background: var(--con${id}); }`).join('\n');
  const st = document.createElement('style');
  st.textContent = `:root { ${light} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
:root[data-theme="dark"] { ${dark} }
${rules}`;
  document.head.appendChild(st);
}
const badgeSvg = (con, size = 30) =>
  `<svg class="badge" viewBox="-11 -11 22 22" width="${size}" height="${size}" aria-hidden="true"><path class="con-shape ${con}" d="${CON_SHAPE[con]}" transform="scale(1.05)" style="fill:var(--con${con})"/><text y=".6">${con}</text></svg>`;
const icon = name => `<svg class="ico"><use href="#i-${name}"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wide = () => matchMedia('(min-width: 760px)').matches;

// ---------- Draw the map (map units; #world is scaled to screen pixels) ----------
const svg = $('#map'), world = $('#world');
const CHK = 'v:' + ROLE.checkpoint;
// walkway links that cross security (checkpoint ↔ airside), both ways
// everyday words for places, beyond their names
let placeWords = null;
const PLACE_WORDS_OF = () => placeWords || (placeWords = {
  ...Object.fromEntries([...CHKS].map(id => [id.slice(2), ['Security', 'Security checkpoint', 'TSA', 'Screening']])),
  [ROLE.ticketing]: ['Check-in', 'Check in', 'Ticket counter', 'Departures'],
  [ROLE.baggage]: ['Bags', 'Luggage', 'Arrivals', 'Carousels'],
});
// baggage carousels by number
const CAROUSEL = {};
for (const it of Object.values(ITEMS)) { const m = it.kind === 'amen' && /^Carousel (\d+)$/.exec(it.name); if (m) CAROUSEL[+m[1]] = it; }
// walking from security: from whichever checkpoint is nearest (some airports have one per terminal)
function secRoute(it) {
  let best = null;
  for (const id of CHKS) { const c = ITEMS[id]; if (!c || c === it) continue; const r = route(c, it); if (!best || r.units < best.units) best = r; }
  return best || route(ITEMS[CHK], it);
}
// one of several of the same place (a baggage claim per terminal): the one nearest to `from`
function nearestOf(id, from) {
  const list = (AP.ui.nearest || {})[id.replace(/^v:/, '')];
  if (!list || !from) return ITEMS[id];
  let best = ITEMS[id], bu = Infinity;
  for (const n of list) { const it = ITEMS['v:' + n]; if (!it) continue; const r = route(from, it); if (r.units < bu) { bu = r.units; best = it; } }
  return best;
}
const SEC_EDGE = new Set(EDGES.filter(e => e[2] === 'S').flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
// every security checkpoint (some airports have several); CHK is the main one
const CHKS = new Set(Object.keys(AP.CHECKPOINTS || { [ROLE.checkpoint]: 1 }).map(id => 'v:' + id));
const isChk = id => CHKS.has(id);
const el = (tag, attrs = {}, parent = world) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n); return n;
};
const ptsStr = ids => ids.map(id => V[id][0] + ',' + V[id][1]).join(' ');

// Base map from OpenStreetMap (see tools/build_basemap.py), painted on a <canvas>: shapes are
// parsed once into Path2D objects, so a redraw is a few milliseconds of GPU drawing with no
// SVG layout. Markers, labels and the route stay in the light SVG overlay on top.
const B = AP.basemap;
const baseCanvas = $('#base'), bctx = baseCanvas.getContext('2d', { alpha: false });
const P2 = {};
for (const k in B) if (typeof B[k] === 'string' && B[k]) P2[k] = new Path2D(B[k]);
const PLANE_D = 'M0 -8C1 -8 1.3 -6.5 1.3 -5L1.3 -1.5L8 2L8 3.4L1.3 1.6L1.1 5.2L3 6.6L3 7.6L0 7L-3 7.6L-3 6.6L-1.1 5.2L-1.3 1.6L-8 3.4L-8 2L-1.3 -1.5L-1.3 -5C-1.3 -6.5 -1 -8 0 -8Z';
const planePath = new Path2D(PLANE_D);
const HALLS = AP.ui.halls, HALL_PATH = {}, HALL_CURB = {};
let hallPicked = null;   // 'up' or 'lo' while the Ticketing or Baggage claim card is open
function pickHall(f) { if (f === hallPicked) return; hallPicked = f; if (committed) { cacheView = null; render(); } }
if (HALLS) for (const [f, key] of [['up', 'tix'], ['lo', 'bag']]) {
  const p = new Path2D(); HALLS[key].forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); p.closePath(); HALL_PATH[f] = p;
}
let pal = null, floor = 'up';
$('#map').dataset.floor = 'up';
function hexMix(a, b, t) {   // a over b, t = amount of a
  const n = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const x = n(a), y = n(b);
  return 'rgb(' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(',') + ')';
}
function readPalette() {
  const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue('--' + k).trim();
  const p = {};
  for (const k of ['map', 'grass', 'wood', 'water', 'apron-pave', 'lot', 'taxi', 'runway', 'taxi-line', 'road-case', 'road-fill',
    'mway-case', 'mway-fill', 'rail', 'other-bldg', 'garage', 'bldg', 'bldg-edge', 'bldg-shadow', 'plane', 'bridge', 'term-closed',
    'walk', 'route', 'corridor', 'stairs', 'runway-mark', 'hall-up', 'hall-up-edge', 'hall-up-text', 'hall-lo', 'hall-lo-edge', 'hall-lo-text', 'curb', 'zebra', 'glass', 'counter', 'carousel', 'carousel-belt', 'door', ...CONS.map(c => 'con' + c)]) p[k] = g(k);
  const tint = parseFloat(g('con-tint')) || .1;
  for (const c of CONS) p['term' + c] = /^#[0-9a-f]{6}$/i.test(p['con' + c]) && /^#[0-9a-f]{6}$/i.test(p.bldg) ? hexMix(p['con' + c], p.bldg, tint) : p.bldg;
  return p;
}
const repaint = () => { pal = null; if (committed) render(true); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// Sharp redraw of the base map on screen (when the map settles). It also drops the gesture cache.
function drawBase() {
  paintBase(bctx, baseCanvas.width, baseCanvas.height, view.x + ox, view.y + oy, view.k, view.r);
  cacheView = null; scheduleCache();
}
// While a finger or the camera is moving, redrawing every vector each frame is the slow part
// (most of the frame on a phone). Instead the base map is drawn once into a larger cache around
// the screen, and frames just slide and scale that image; it's redrawn sharp when things settle.
const cache = document.createElement('canvas'), cctx = cache.getContext('2d', { alpha: false });
const OVER = 0.35;           // margin around the screen, in screen sizes, on each side
let cacheView = null, cacheIdle = null;
function buildCache(over = OVER) {
  const W = vw, H = vh, mx = Math.round(W * over), my = Math.round(H * over);
  const cw = Math.round((W + 2 * mx) * dpr), ch = Math.round((H + 2 * my) * dpr);
  if (cache.width !== cw || cache.height !== ch) { cache.width = cw; cache.height = ch; }
  paintBase(cctx, cw, ch, view.x + ox + mx, view.y + oy + my, view.k, view.r);
  cacheView = { ...view, mx, my };
}
function scheduleCache() {
  if (cacheIdle) return;
  const run = () => { cacheIdle = null; if (!cacheView && !ptrs.size && !moving) buildCache(); };
  cacheIdle = window.requestIdleCallback ? requestIdleCallback(run, { timeout: 400 }) : setTimeout(run, 80);
}
// the screen transform taking something laid out at view `from` (offset by mx, my) to the current view
function relXf(from, mx = 0, my = 0) {
  const rho = view.k / from.k, dr = view.r - from.r, a = rho * Math.cos(dr), b = rho * Math.sin(dr);
  const tx = from.x + mx, ty = from.y + my;
  return { rho, a, b, e: view.x - (a * tx - b * ty), f: view.y - (b * tx + a * ty) };
}
function blitBase() {
  const W = vw, H = vh;
  let C = cacheView, M = C && relXf(C, C.mx, C.my);
  // does the cached area still cover the whole screen? (each screen corner, back in cache pixels)
  const covers = () => [[0, 0], [W, 0], [0, H], [W, H]].every(([sx, sy]) => {
    const dx = sx - M.e, dy = sy - M.f, q = M.rho * M.rho, x = (M.a * dx + M.b * dy) / q, y = (-M.b * dx + M.a * dy) / q;
    return x >= 0 && y >= 0 && x <= W + 2 * C.mx && y <= H + 2 * C.my;
  });
  if (!C || M.rho > 1.6 || M.rho < .62 || !covers()) {
    buildCache(.12); C = cacheView; M = relXf(C, C.mx, C.my);   // mid-gesture: a slimmer margin keeps this frame quick
  }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.fillStyle = pal.map; bctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
  bctx.setTransform(M.a, M.b, -M.b, M.a, dpr * M.e, dpr * M.f);
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(cache, 0, 0);
}
// The halls' fittings, drawn like a floor plan: check-in desks with the bag belt behind them,
// baggage carousels (a belt loop round an island), the curbside doors, and the names on the floor.
function drawHallDetails(c, k, lower) {
  const f = lower ? 'lo' : 'up', ink = pal['hall-' + f + '-edge'];
  c.setLineDash([]);
  if (!lower) {
    for (const run of HALLS.counters) for (let i = 0; i + 1 < run.length; i++) {
      const [x0, y0] = run[i], [x1, y1] = run[i + 1], a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
      c.save(); c.translate(x0, y0); c.rotate(a);
      c.fillStyle = ink; c.fillRect(-.2, 1.5, L + .4, .7);                      // the bag belt behind the desks
      c.fillStyle = pal.counter; c.beginPath(); c.roundRect(.3, -.8, L - .6, 1.9, .5); c.fill();
      c.restore();
    }
  } else {
    for (const [x, y, a] of HALLS.carousels) {
      c.save(); c.translate(x, y); c.rotate(a * Math.PI / 180);
      c.beginPath(); c.roundRect(-6.4, -2.6, 12.8, 5.2, 2.6); c.fillStyle = pal.carousel; c.fill();
      c.strokeStyle = pal['carousel-belt']; c.lineWidth = .5; c.stroke();
      c.beginPath(); c.roundRect(-5, -1.3, 10, 2.6, 1.3); c.lineWidth = 1; c.stroke();   // the belt
      c.beginPath(); c.roundRect(-3.6, -.35, 7.2, .7, .35); c.fillStyle = pal['carousel-belt']; c.fill();   // the island
      c.restore();
    }
  }
  // the curb wall is glass: a pale double line, broken by the doors
  c.strokeStyle = pal.glass; c.lineWidth = 1.3; c.beginPath(); HALLS.facade[f].forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
  c.strokeStyle = pal['hall-' + f]; c.lineWidth = .4; c.stroke();
  // curbside doors: a bar across the wall with a notch, like the entrance marks on a floor plan
  for (const [x, y] of HALLS.doors[f]) {
    c.save(); c.translate(x, y); c.rotate((y < -135 ? -44.6 : -78.4) * Math.PI / 180);
    c.fillStyle = pal.door; c.beginPath(); c.roundRect(-2.6, -.9, 5.2, 1.8, .9); c.fill();
    c.fillStyle = pal['hall-' + f]; c.fillRect(-1.6, -.3, 3.2, .6);
    c.restore();
  }
  // names painted along the floor and the curb: they grow with the map, up to a comfortable size
  const fs = Math.min(5.2, 15 / k);
  c.font = `700 ${fs}px ` + (getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'sans-serif');
  try { c.letterSpacing = (fs * .24) + 'px'; } catch (e) {}
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [x, y, ang, t, lv] of HALLS.names || []) {
    const road = /DRIVE/.test(t);
    if ((lv === 'lo') !== lower || k < (road ? 1.3 : .9)) continue;
    c.save(); c.translate(x, y); c.rotate(ang * Math.PI / 180);
    c.fillStyle = road ? pal.door : pal['hall-' + f + '-text']; c.globalAlpha = road ? .7 : .6; c.fillText(t, 0, 0);
    c.restore();
  }
  try { c.letterSpacing = '0px'; } catch (e) {}
  // the open hall's outline, on top of everything
  if (hallPicked === f) { c.save(); c.globalAlpha = .9; c.strokeStyle = pal.route; c.lineWidth = 2.4 / Math.max(k, .5); c.stroke(HALL_PATH[f]); c.restore(); }
}
function paintBase(c, cw, ch, tx, ty, k, rot = 0) {
  pal = pal || readPalette();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = pal.map; c.fillRect(0, 0, cw, ch);
  const kc = dpr * k * Math.cos(rot), ks = dpr * k * Math.sin(rot);
  c.setTransform(kc, ks, -ks, kc, dpr * tx, dpr * ty);
  c.lineCap = c.lineJoin = 'round';
  const fill = (key, color) => { if (P2[key]) { c.fillStyle = color; c.fill(P2[key], 'evenodd'); } };
  const stroke = (key, color, w, dash) => { if (P2[key]) { c.strokeStyle = color; c.lineWidth = w; c.setLineDash(dash || []); c.stroke(P2[key]); } };
  fill('grass', pal.grass); fill('wood', pal.wood); fill('water', pal.water);
  fill('apron', pal['apron-pave']); fill('lots', pal.lot); fill('ramp', pal['apron-pave']);
  stroke('taxiway', pal.taxi, 23); stroke('runway', pal.runway, 46);
  // runway centreline dashes, then the taxiway centrelines
  if (k > .35) stroke('runway', pal['runway-mark'], .9, [36, 24]);
  stroke('taxiway', pal['taxi-line'], 1.1 / k);
  const roads = [['service', 5], ['minor', 9], ['major', 11], ['motorway', 15]];
  for (const [r, w] of roads) stroke(r, r === 'motorway' ? pal['mway-case'] : pal['road-case'], w + 2.6);
  for (const [r, w] of roads) stroke(r, r === 'motorway' ? pal['mway-fill'] : pal['road-fill'], w);
  stroke('rail', pal.rail, 2.2, [6, 4]);
  fill('buildings', pal['other-bldg']); stroke('buildings', pal['bldg-edge'], .6 / Math.max(k, .5));
  fill('garage', pal.garage); stroke('garage', pal['bldg-edge'], .8 / Math.max(k, .5));
  // parked aircraft, roughly 33 m long
  c.fillStyle = pal.plane;
  for (const [x, y, a] of B.planes) {
    c.save(); c.translate(x, y); c.rotate(a * Math.PI / 180); c.scale(2.1, 2.1); c.fill(planePath); c.restore();
  }
  // terminals raised on a soft shadow; concourses tinted by their colour
  // (the shadow falls down the screen whichever way the map is turned)
  c.save(); c.translate(2 * Math.cos(rot) + 4.5 * Math.sin(rot), -2 * Math.sin(rot) + 4.5 * Math.cos(rot)); c.fillStyle = pal['bldg-shadow'];
  const closed = AP.ui.closedTerms || [];
  for (const t of ['termM', ...CONS.map(c => 'term' + c), ...closed]) if (P2[t]) c.fill(P2[t]);
  c.restore();
  const edge = 1 / Math.max(k, .5);
  for (const t of closed) { fill(t, pal['term-closed']); stroke(t, pal['bldg-edge'], edge, [3, 2]); }
  fill('termM', pal.bldg); stroke('termM', pal['bldg-edge'], edge);
  // the concourses only have an upper level, so they fade back on the lower floor
  const lower = floor === 'lo';
  for (const t of CONS) {
    if (!lower) { fill('term' + t, pal['term' + t]); stroke('term' + t, pal['bldg-edge'], edge); continue; }
    c.globalAlpha = .55; fill('term' + t, pal['term-closed']); stroke('term' + t, pal['bldg-edge'], edge * .8); c.globalAlpha = 1;
  }
  if (!lower) stroke('bridges', pal.bridge, 3.6);
  // the landside halls: ticketing upstairs (with its check-in counter rows), baggage claim downstairs
  // (with its carousels), each tinted so they read as places of their own, and the curbside doors
  // the landside halls' floors: ticketing upstairs, baggage claim downstairs (their details go on top
  // of the walkways, below)
  const hp = HALLS && HALL_PATH[lower ? 'lo' : 'up'];
  if (hp) {
    const f = lower ? 'lo' : 'up', P = poly => { const p = new Path2D(); poly.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); p.closePath(); return p; };
    // outside: the curbside sidewalk, and crosswalks over the drive from each door
    c.fillStyle = pal.curb; c.fill(HALL_CURB[f] || (HALL_CURB[f] = P(HALLS.curb[f])));
    c.strokeStyle = pal.zebra; c.lineWidth = 3; c.lineCap = 'butt'; c.setLineDash([.6, .6]);
    for (const [x0, y0, x1, y1] of HALLS.zebra[f]) {
      // stripes run along the crossing: draw a wide dashed line across it
      const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
      c.save(); c.translate(x0, y0); c.rotate(a); c.beginPath(); c.moveTo(L / 2, -1.6); c.lineTo(L / 2, 1.6); c.lineWidth = L; c.stroke(); c.restore();
    }
    c.setLineDash([]); c.lineCap = 'round';
    c.fillStyle = pal['hall-' + f]; c.fill(hp); c.strokeStyle = pal['hall-' + f + '-edge']; c.lineWidth = 1.2 / Math.max(k, .5); c.stroke(hp);
    // the hall whose card is open is outlined, so you can see all of it at a glance
    if (hallPicked === (lower ? 'lo' : 'up')) { c.save(); c.globalAlpha = .1; c.fillStyle = pal.route; c.fill(hp); c.restore(); }
  }
  // this floor's walkways (OpenStreetMap indoor ways) and the escalators between floors
  stroke(lower ? 'walk0' : 'walk1', pal.corridor, 5);
  if (lower) stroke('walkm1', pal.corridor, 5, [5, 4]);
  // an airport train runs on the lower floor: a track with ties
  if (P2.train && lower === ((AP.ui.trainFloor || 'lo') === 'lo')) { c.globalAlpha = .75; stroke('train', pal.stairs, 6 / Math.max(k, .6)); c.globalAlpha = 1; stroke('train', pal.corridor, 2.4 / Math.max(k, .6), [4, 5]); }   // (DFW's Skylink is up with the gates)
  // stairs and escalators: light, crisp treads (round dashes blur into blobs when you zoom in)
  c.lineCap = 'butt'; c.globalAlpha = .6; stroke('stairs', pal.stairs, 2, [.4, .5]); c.globalAlpha = 1; c.lineCap = 'round';
  if (hp) drawHallDetails(c, k, lower);
  if (!lower) {
    // the checkpoint line across the corridor from ticketing
    c.strokeStyle = pal.route; c.globalAlpha = .75; c.lineWidth = 1.8; c.setLineDash([3, 2.4]);
    const sls = AP.ui.securityLine, list = Array.isArray(sls[0]) ? sls : [sls];
    for (const sl of list) { c.beginPath(); c.moveTo(sl[0], sl[1]); c.lineTo(sl[2], sl[3]); c.stroke(); }
    c.globalAlpha = 1;
  }
  c.setLineDash([]);
}
const areaLabels = [];
const lbl = (x, y, t, anchor = 'middle', lvl) => {
  const g = el('g', { class: 'area-lbl' }); g.dataset.x = x; g.dataset.y = y; if (lvl) g.dataset.lv = lvl;
  el('text', { class: 'map-lbl', 'text-anchor': anchor }, g).textContent = t;
  g._w = t.length * 6.3; g._anchor = anchor;
  areaLabels.push(g);
};
for (const [x, y, t, anchor, lvl] of AP.ui.labels) lbl(x, y, t, anchor || 'middle', lvl);
const routeGhostCase = el('path', { class: 'route-case ghost', 'stroke-width': 11, 'vector-effect': 'non-scaling-stroke', d: '' });
const routeGhost = el('path', { class: 'route ghost', 'stroke-width': 7, 'vector-effect': 'non-scaling-stroke', d: '' });
const routeCase = el('path', { class: 'route-case', 'stroke-width': 11, 'vector-effect': 'non-scaling-stroke', d: '' });
const routeLine = el('path', { class: 'route', 'stroke-width': 7, 'vector-effect': 'non-scaling-stroke', d: '' });

const markers = [];
const layerAmen = el('g', {}), layerGates = el('g', {}), layerPlaces = el('g', {}), layerCon = el('g', {});
for (const it of Object.values(ITEMS)) {
  let g;
  if (it.kind === 'gate') {
    g = el('g', { class: `mk gate ${it.con}`, 'data-id': it.id }, layerGates);
    const pop = el('g', { class: 'pop' }, g), w = it.code.length > 2 ? 17 : 14;
    // a soft shadow, the pill, and a stem that turns it into a pin when it's selected or the destination
    el('rect', { class: 'drop', x: -w / 2 - .3, y: -4.9, width: w + .6, height: 11.6, rx: 5.8 }, pop);
    el('path', { class: 'stem', d: 'M-2.6 4.8L0 9.5L2.6 4.8Z' }, pop);
    el('rect', { class: 'pill', x: -w / 2, y: -5.5, width: w, height: 11, rx: 5.5 }, pop);
    el('text', { y: .4 }, pop).textContent = it.code;
  } else if (it.kind === 'amen') {
    g = el('g', { class: 'mk amen', 'data-id': it.id, 'data-cat': it.cat }, layerAmen);
    const sz = el('g', { class: 'sz' }, el('g', { class: 'pop' }, g));
    if (it.cat === 'rest') { el('rect', { class: 'drop', x: -5.4, y: -4.6, width: 10.8, height: 10.8, rx: 3.4 }, sz); el('rect', { class: 'sym', x: -5, y: -5, width: 10, height: 10, rx: 3 }, sz); }
    else { el('circle', { class: 'drop', r: 5.9, cy: .7 }, sz); el('circle', { class: 'sym', r: 5.2 }, sz); }
    const carN = /^Carousel (\d+)$/.exec(it.name);
    if (carN) { g.classList.add('carousel'); el('text', { class: 'num', y: .3 }, sz).textContent = carN[1]; }   // a carousel shows its number
    else el('use', { class: 'glyph', href: '#i-' + (it.icon || it.cat), x: -3.6, y: -3.6, width: 7.2, height: 7.2 }, sz);
    el('text', { x: 8, y: 2 }, g).textContent = it.name;
  } else {
    // places are drawn as signs: a rounded square in their kind's colour
    g = el('g', { class: 'mk place', 'data-id': it.id, 'data-pk': it.pk || 'terminal' }, layerPlaces);
    const sz = el('g', { class: 'sz' }, el('g', { class: 'pop' }, g));
    el('rect', { class: 'drop', x: -6.1, y: -5.3, width: 12.2, height: 12.2, rx: 3.8 }, sz);
    el('rect', { class: 'sym', x: -5.6, y: -5.6, width: 11.2, height: 11.2, rx: 3.4 }, sz);
    el('use', { class: 'glyph', href: '#i-' + (it.icon || 'place'), x: -3.7, y: -3.7, width: 7.4, height: 7.4 }, sz);
    // the map already shows which floor, so "(lower level)" and the like are dropped from the name
    el('text', { x: 9, y: 2.2 }, g).textContent = it.name.replace(/\s*\([^)]*\)$/, '');
  }
  if (it.kind !== 'gate') it.lw = g.querySelector('text').textContent.length * (it.kind === 'place' ? 3.75 : 3.4) + 6;
  el('title', {}, g).textContent = it.kind === 'gate' ? `${it.name} · Concourse ${it.con}` : it.name;
  if (it.lvl) g.dataset.lv = it.lvl;
  g.dataset.x = it.x; g.dataset.y = it.y; it.el = g; markers.push(g);
}
for (const [con, x, y] of AP.ui.roundels) {
  const g = el('g', { class: 'mk con-mk', 'data-con': con }, layerCon);
  const pop = el('g', { class: 'pop' }, g);
  el('path', { class: 'con-shape ' + con, d: CON_SHAPE[con], transform: 'scale(1.25)' }, pop);
  el('text', { class: 'con-letter', y: .8 }, pop).textContent = con;
  g.dataset.x = x; g.dataset.y = y; markers.push(g);
}
// Mid-pinch the overlay is scaled (and turned) as one picture, which would grow and swing every icon
// until the fingers lift. Each icon's contents sit in a .zs group that the frame counter-scales and
// counter-turns through two CSS variables, so icons keep their size, stay upright and don't jump.
function zsWrap(g, cls = 'zs') {
  const w = document.createElementNS(NS, 'g'); w.setAttribute('class', cls);
  while (g.firstChild) w.appendChild(g.firstChild);
  g.appendChild(w); return g;
}
for (const g of markers) zsWrap(g);
for (const g of areaLabels) zsWrap(g);
const meG = el('g', { opacity: 0, style: 'pointer-events:none' });
const meAcc = el('circle', { class: 'me-acc', r: 0, 'vector-effect': 'non-scaling-stroke' }, meG);
const meMark = el('g', {}, meG);
const meCone = el('path', { class: 'me-cone', d: 'M0 0L-15.5 -22.1A27 27 0 0 1 15.5 -22.1Z', opacity: 0 }, meMark);
el('circle', { class: 'me-pulse', r: 7 }, meMark);
const meBody = el('g', {}, meMark);
el('circle', { class: 'me-shadow', r: 7.9, cy: .7 }, meBody);
el('circle', { class: 'me-ring', r: 7.3 }, meBody);
el('circle', { class: 'me-dot', r: 5.1 }, meBody);
el('ellipse', { class: 'me-shine', rx: 2.4, ry: 1.5, cx: -1.3, cy: -2.1 }, meBody);
// the beam turns the short way round (359° → 1° is a small turn, not a spin)
let coneAngle = null;
function aimCone(deg) {
  if (coneAngle == null) coneAngle = deg;
  else coneAngle += ((deg - coneAngle) % 360 + 540) % 360 - 180;
  meCone.style.transform = `rotate(${coneAngle}deg)`;
}
// a ripple from the dot when it first appears or you jump back to it
function pingMe(pop) {
  if (reduced) return;
  meG.classList.remove('ping'); if (pop) meBody.classList.remove('me-pop');
  void meG.getBBox();
  meG.classList.add('ping'); if (pop) meBody.classList.add('me-pop');
}
// grey once the last fix is more than half a minute old: it's where you were, not where you are
let lastFixAt = 0;
setInterval(() => { if (me) meG.classList.toggle('stale', Date.now() - lastFixAt > 30000); }, 5000);
const routeStart = el('g', { class: 'route-start', opacity: 0, style: 'pointer-events:none' });
el('circle', { r: 5.6 }, routeStart); el('circle', { r: 2.4, class: 'core' }, routeStart);
const routeEnd = el('g', { class: 'route-endpt', opacity: 0, style: 'pointer-events:none' });
el('circle', { r: 6.2 }, routeEnd); el('circle', { r: 2.4, class: 'core' }, routeEnd);
const eta = el('g', { class: 'eta', opacity: 0, style: 'pointer-events:none' });
const etaRect = el('rect', { y: -29, height: 17, rx: 8.5 }, eta);
el('path', { d: 'M-4 -12.5 L0 -7 L4 -12.5Z' }, eta);
const etaText = el('text', { y: -20.2 }, eta);
const pinG = el('g', { class: 'pin', opacity: 0, style: 'pointer-events:none' });
el('ellipse', { class: 'pin-shadow', rx: 4.5, ry: 1.6 }, pinG);
const pinInner = el('g', { class: 'pin-inner' }, pinG);
el('path', { class: 'pin-body', d: 'M0 -2C-2.6 -5.6 -10 -9.6 -10 -18.5A10 10 0 1 1 10 -18.5C10 -9.6 2.6 -5.6 0 -2Z' }, pinInner);
const pinUse = el('use', { class: 'pin-ico', href: '#i-place', x: -6.5, y: -25, width: 13, height: 13 }, pinInner);
// the selected place's name, under the pin's tip
const pinLabel = el('text', { class: 'pin-label', y: 7.5 }, pinG);
let pinItem = null;
function setPin(it) {
  pinItem = it && it.kind !== 'gate' ? it : null;
  if (!pinItem) { pinG.setAttribute('opacity', 0); return; }
  pinG.dataset.cat = pinItem.cat || 'place'; pinG.dataset.pk = pinItem.pk || '';
  pinUse.setAttribute('href', '#i-' + (pinItem.icon || pinItem.cat || 'place'));
  pinLabel.textContent = pinItem.name.replace(/\s*\([^)]*\)$/, '');
  pinG.setAttribute('opacity', 1);
  placeDecor();
  if (!reduced) { pinG.classList.remove('drop'); void pinG.getBBox(); pinG.classList.add('drop'); }
}
function placeDecor() {
  const s = markerScale;
  if (me) { const d = shown || me; meAcc.setAttribute('cx', d.x); meAcc.setAttribute('cy', d.y); meMark.setAttribute('transform', `translate(${d.x} ${d.y}) scale(${s})`); }
  if (pinItem) pinG.setAttribute('transform', upright(pinItem.x, pinItem.y, s * 1.15));
  for (const e of escBadges) e.g.setAttribute('transform', upright(e.x, e.y, s));
  if (routePts.length > 1) {
    const a = routePts[0], b = routePts[routePts.length - 1], m = pointAt(routeTotal * 0.5);
    routeStart.setAttribute('transform', upright(a.x, a.y, s));
    routeEnd.setAttribute('transform', upright(b.x, b.y, s));
    eta.setAttribute('transform', upright(m.x, m.y, s));
  }
}
// escalator badges where a route changes floor; tap one to switch floors
const escLayer = el('g', {});
let escBadges = [];
const puckG = el('g', { style: 'pointer-events:none', opacity: 0 });
el('circle', { class: 'puck-halo', r: 9 }, puckG);
el('circle', { class: 'puck', r: 3.4 }, puckG);
// (the location mark's beam points along the map, so it only keeps its size)
for (const g of [pinG, routeStart, routeEnd, eta, puckG]) zsWrap(g);
zsWrap(meMark, 'zs-s');

// ---------- Pan / zoom in screen pixels ----------
// screen = (x, y) + k · rotate(r) · map point; r turns the map clockwise on screen (0 = north up)
const view = { k: 1, x: 0, y: 0, r: 0 };
let markerScale = 1;
const toScr = (p, v = view) => { const c = Math.cos(v.r || 0), s = Math.sin(v.r || 0); return { x: v.x + v.k * (c * p.x - s * p.y), y: v.y + v.k * (s * p.x + c * p.y) }; };
const toMapPt = (sx, sy, v = view) => { const c = Math.cos(v.r || 0), s = Math.sin(v.r || 0), dx = (sx - v.x) / v.k, dy = (sy - v.y) / v.k; return { x: c * dx + s * dy, y: -s * dx + c * dy }; };
// the view at zoom k and turn r that puts map point p at screen point (sx, sy)
const viewAt = (k, r, p, sx, sy) => { const c = Math.cos(r), s = Math.sin(r); return { k, r, x: sx - k * (c * p.x - s * p.y), y: sy - k * (s * p.x + c * p.y) }; };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const rotDeg = () => +(view.r * 180 / Math.PI).toFixed(3);
// markers and labels turn back against the map so they always read upright
const upright = (x, y, s) => `translate(${x} ${y})${view.r ? ` rotate(${-rotDeg()})` : ''} scale(${s})`;
function clampView() {
  // keep at least part of the airport on screen
  const W = vw, H = vh, m = 90, M = MAP_BOUNDS;
  const cs = [[M.x0, M.y0], [M.x1, M.y0], [M.x0, M.y1], [M.x1, M.y1]].map(([x, y]) => toScr({ x, y }));
  const l = Math.min(...cs.map(q => q.x)), r = Math.max(...cs.map(q => q.x)), t = Math.min(...cs.map(q => q.y)), b = Math.max(...cs.map(q => q.y));
  if (r < m) view.x += m - r; if (l > W - m) view.x -= l - (W - m);
  if (b < m + 60) view.y += m + 60 - b; if (t > H - m) view.y -= t - (H - m);
}
let scaleTimer = null, lastScaleK = 0;
function updateScaleBar() {
  if (Math.abs(view.k - lastScaleK) < 1e-4) return;
  const first = !lastScaleK; lastScaleK = view.k;
  const want = 90 / view.k * M_PER_UNIT;   // metres covered by ~90 px
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce((p, n) => n <= want ? n : p, 5);
  const bar = $('#scalebar');
  bar.querySelector('.bar').style.width = (nice / M_PER_UNIT * view.k).toFixed(1) + 'px';
  bar.querySelector('.txt').textContent = nice >= 1000 ? nice / 1000 + ' km' : nice + ' m';
  if (first || !userMoved) return;
  bar.classList.add('show'); clearTimeout(scaleTimer);
  scaleTimer = setTimeout(() => bar.classList.remove('show'), 1400);
}
// Rendering, once per animation frame at most:
// - the base map canvas is screen-sized and repainted at the exact view every frame (shapes are
//   pre-built, so this is cheap), so it never shows stale or half-drawn areas;
// - the SVG overlay (markers, labels, route) slides with a CSS transform during a gesture and is
//   re-laid-out once things settle ("commit"), because laying it out every frame is the slow part.
let committed = null, commitTimer = null, moving = false, scaledAtK = 0, scaledAtR = 0, framePending = false, zsSet = 1, zrSet = 0;   // moving: glide or camera animation
const ox = 0, oy = 0;
const stage = $('#stage');
let dpr = 1;
function sizeSvg() {
  // cap the backing store: 2x is sharp on phones and keeps repaints and memory in check
  dpr = Math.min(devicePixelRatio || 1, 2);
  baseCanvas.width = Math.round(vw * dpr); baseCanvas.height = Math.round(vh * dpr);
}
sizeSvg();
function apply() {
  clampView();
  if (!committed) return render();
  if (!framePending) { framePending = true; requestAnimationFrame(frame); }
  clearTimeout(commitTimer);
  commitTimer = setTimeout(settle, 140);
}
function settle() { if (!ptrs.size && !moving) render(); else commitTimer = setTimeout(settle, 140); }
function frame() {
  framePending = false;
  if (!committed) return;
  const M = relXf(committed);
  // zoomed or turned far enough that sliding markers would look wrong: re-lay-out now
  if (M.rho > 1.9 || M.rho < .55 || Math.abs(wrapAngle(view.r - committed.r)) > .35) return render();
  blitBase(); updateCompass();
  svg.style.transform = `matrix(${M.a},${M.b},${-M.b},${M.a},${M.e},${M.f})`;
  const zs = Math.pow(M.rho, -.62), zr = -wrapAngle(view.r - committed.r) * 180 / Math.PI;
  if (Math.abs(zs - zsSet) > .004 || Math.abs(zr - zrSet) > .1) {
    zsSet = zs; zrSet = zr; svg.style.setProperty('--zs', zs.toFixed(4)); svg.style.setProperty('--zr', zr.toFixed(2) + 'deg');
  }
}
function render() {
  clearTimeout(commitTimer);
  clampView();
  committed = { ...view };
  if (ptrs.size || moving) blitBase(); else drawBase();
  svg.style.transform = '';
  if (zsSet !== 1 || zrSet !== 0) { zsSet = 1; zrSet = 0; svg.style.removeProperty('--zs'); svg.style.removeProperty('--zr'); }
  world.setAttribute('transform', `translate(${view.x} ${view.y})${view.r ? ` rotate(${rotDeg()})` : ''} scale(${view.k})`);
  // marker transforms only depend on zoom and turn, so a plain pan skips rewriting ~200 of them
  if (view.k !== scaledAtK || view.r !== scaledAtR) {
    scaledAtK = view.k; scaledAtR = view.r;
    markerScale = 1 / Math.pow(view.k, 0.62);
    for (const m of markers) m.setAttribute('transform', upright(m.dataset.x, m.dataset.y, markerScale));
    for (const g of areaLabels) g.setAttribute('transform', upright(g.dataset.x, g.dataset.y, markerScale));
    updateCompass();
    svg.dataset.z = view.k >= 2.2 ? 3 : view.k >= 1.4 ? 2 : 1;
    placePuck();
    placeDecor();
  }
  updateScaleBar();
  cullLabels();
}
// Show a place's name only where it has room: selected first, then places on the route, then the rest.
// Area names ("Parking garage") come last and also keep off the route line.
let labelItems = null, chromeCache = null;
function cullLabels() {
  labelItems = labelItems || Object.values(ITEMS).filter(i => i.kind !== 'gate' && i.el);
  const zoomed = svg.dataset.z === '3', u = markerScale * view.k, taken = [];
  const scr = p => toScr(p);
  const rank = it => it.el.classList.contains('sel') ? 0 : it.el.classList.contains('hl') ? 1 : it.kind === 'place' ? 2 : 3;
  const away = it => it.lvl && it.lvl !== floor && !it.el.classList.contains('sel');
  const hidden = it => (it.cat && svg.classList.contains('hide-' + it.cat)) || it.el.hasAttribute('data-off') || away(it);
  // Markers first: where place icons would overlap, keep the more useful one and reveal the rest as you zoom
  // (selected, on the route, restrooms, food and bars, coffee, shops, then vending and chargers)
  const RANK = { rest: 2, bar: 3, food: 3, coffee: 4, shop: 5, play: 5, service: 6 };
  const mrank = it => it.el.classList.contains('sel') ? 0 : it.el.classList.contains('hl') ? 1
    : stepFree && (it.icon === 'lift' || it.icon === 'access') ? 2 : RANK[it.cat] + (/vending|FuelRod|Lottery/i.test(it.name) ? 2 : 0);
  const mr = (svg.dataset.z === '1' ? 3.6 : 5.8) * u, kept = [];
  // gate pills that would overlap shrink to dots; the selected gate, gates on the route, then lower numbers win
  const gnum = it => parseInt(it.code.replace(/\D/g, ''), 10) || 0;
  const grank = it => it.el.classList.contains('sel') || it.el.classList.contains('dest') ? -2 : it.el.classList.contains('hl') ? -1 : gnum(it);
  const gates = Object.values(ITEMS).filter(i => i.kind === 'gate').sort((a, b) => grank(a) - grank(b)), pills = [];
  for (const it of gates) {
    const p = scr(it), hw = ((it.code.length > 2 ? 17 : 14) / 2 + .6) * u, hh = 6 * u;
    const box = { l: p.x - hw, r: p.x + hw, t: p.y - hh, b: p.y + hh };
    const dot = grank(it) > -2 && pills.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
    if (!dot) { it.el.removeAttribute('data-dot'); pills.push(box); kept.push(box); continue; }
    // a dot that would still sit on a pill is left out altogether
    const r = 2.6 * u, db = { l: p.x - r, r: p.x + r, t: p.y - r, b: p.y + r };
    const covered = pills.some(o => db.l < o.r && db.r > o.l && db.t < o.b && db.b > o.t);
    it.el.setAttribute('data-dot', covered ? 'hide' : '');
    if (!covered) kept.push(db);
  }
  for (const it of Object.values(ITEMS)) if (it.kind === 'place' && !away(it)) {
    const p = scr(it); kept.push({ l: p.x - mr, r: p.x + mr, t: p.y - mr, b: p.y + mr });
  }
  const amens = Object.values(ITEMS).filter(i => i.kind === 'amen').sort((a, b) => mrank(a) - mrank(b));
  for (const it of amens) {
    if (away(it)) { it.el.removeAttribute('data-off'); continue; }
    const p = scr(it), box = { l: p.x - mr, r: p.x + mr, t: p.y - mr, b: p.y + mr };
    const clash = !(it.cat && svg.classList.contains('hide-' + it.cat)) && mrank(it) > 1 && kept.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
    it.el.toggleAttribute('data-off', clash);
    if (!clash) kept.push(box);
  }
  const list = labelItems.filter(it => (it.kind === 'place' || zoomed || it.el.classList.contains('sel')) && !hidden(it))
    .sort((a, b) => rank(a) - rank(b));
  const hit = (r, o) => r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t;
  // every marker's dot or gate pill, and the concourse badges, block names
  const dots = Object.values(ITEMS).filter(i => i.el && !hidden(i)).map(i => {
    const p = scr(i), w = (i.kind === 'gate' ? 9 : 5.6) * u;
    return { it: i, l: p.x - w, r: p.x + w, t: p.y - 5.5 * u, b: p.y + 5.5 * u };
  });
  for (const m of markers) if (m.dataset.con) {
    const p = scr({ x: +m.dataset.x, y: +m.dataset.y }), w = 16 * u;
    dots.push({ l: p.x - w, r: p.x + w, t: p.y - w, b: p.y + w });
  }
  // the route line, sampled every few metres
  const routeHits = [];
  for (let s = 0; routePts.length > 1 && s <= routeTotal; s += 6) routeHits.push(scr(pointAt(s)));
  const onRoute = r => routeHits.some(p => p.x > r.l - 3 && p.x < r.r + 3 && p.y > r.t - 3 && p.y < r.b + 3);
  // floating chrome hides whatever is under it
  const chrome = (chromeCache || (chromeCache = ['.controls', '.topbar', '#sheet', '#navBanner', '#navBar'].map(s => document.querySelector(s).getBoundingClientRect())))
    .map(c => ({ l: c.left, r: c.right, t: c.top, b: c.bottom }));
  if (pinItem) {
    const p = scr(pinItem), pu = u * 1.15;
    taken.push({ l: p.x - 11 * pu, r: p.x + 11 * pu, t: p.y - 30 * pu, b: p.y - 3 * pu });
    const lw = pinLabel.textContent.length * 1.7 * pu;
    taken.push({ l: p.x - lw, r: p.x + lw, t: p.y + 2 * pu, b: p.y + 9 * pu });
  }
  if (routePts.length > 1 && eta.getAttribute('opacity') === '1') {
    const m = scr(pointAt(routeTotal * 0.5)), w = +etaRect.getAttribute('width') / 2;
    taken.push({ l: m.x - w * u, r: m.x + w * u, t: m.y - 30 * u, b: m.y - 7 * u });
  }
  const offscreen = r => r.r < 0 || r.l > vw || r.b < 0 || r.t > vh;
  const shown = new Set(), side = new Map();
  for (const it of list) {
    const p = scr(it), w = (it.lw - 5) * u, mine = it.el.classList.contains('sel'), important = rank(it) < 2;
    for (const dir of [1, -1]) {
      const r = dir > 0 ? { l: p.x + 8 * u, r: p.x + 8 * u + w } : { l: p.x - 8 * u - w, r: p.x - 8 * u };
      r.t = p.y - 3.6 * u; r.b = p.y + 3.6 * u;
      if (offscreen(r)) break;
      if (chrome.some(c => hit(r, c)) || taken.some(o => hit(r, o))) continue;
      if (!mine && dots.some(o => o.it !== it && hit(r, o))) continue;
      if (!important && onRoute(r)) continue;
      taken.push(r); shown.add(it); side.set(it, dir); break;
    }
  }
  for (const [it, dir] of side) {
    const t = it.el.querySelector(':scope > .zs > text');
    if (t && t.dataset.dir !== String(dir)) {
      t.dataset.dir = dir; t.setAttribute('x', dir * (it.kind === 'place' ? 9 : 8)); t.setAttribute('text-anchor', dir > 0 ? 'start' : 'end');
    }
  }
  for (const it of labelItems) it.el.toggleAttribute('data-lbl', shown.has(it));
  for (const g of areaLabels) {
    const p = scr({ x: +g.dataset.x, y: +g.dataset.y }), w = g._w * u;
    const r = g._anchor === 'start' ? { l: p.x, r: p.x + w } : { l: p.x - w / 2, r: p.x + w / 2 };
    r.t = p.y - 7 * u; r.b = p.y + 2 * u;
    const ok = (!g.dataset.lv || g.dataset.lv === floor) && !offscreen(r) && !chrome.some(c => hit(r, c)) && !taken.some(o => hit(r, o)) && !dots.some(o => hit(r, o)) && !onRoute(r);
    g.toggleAttribute('data-off', !ok);
    if (ok) taken.push(r);
  }
}
// how far out you can zoom: enough to see the whole airport (a big one like ATL needs more)
// (floored: before layout, or while the page is hidden, the width can read 0 and zoom would collapse)
const kMin = () => Math.max(0.02, Math.min(0.25, (vw - 24) / (MAP_BOUNDS.x1 - MAP_BOUNDS.x0) * .9));
const clampK = k => Math.max(kMin(), Math.min(10, k));
function zoomAt(px, py, f) {
  const nk = clampK(view.k * f), r = nk / view.k;
  view.x = px - (px - view.x) * r; view.y = py - (py - view.y) * r; view.k = nk; apply();
}
function rotateAt(px, py, da) {
  const c = Math.cos(da), s = Math.sin(da), dx = view.x - px, dy = view.y - py;
  view.x = px + c * dx - s * dy; view.y = py + s * dx + c * dy; view.r = wrapAngle(view.r + da);
}
// the compass button appears once the map is turned, its needle pointing to north
const compassBtn = $('#compass'), dial = compassBtn.querySelector('.dial');
let compassShown = false, compassDeg = null, compassLive = false;
function updateCompass() {
  const d = rotDeg(), live = typeof headingUp !== 'undefined' && headingUp;
  if (d !== compassDeg) { compassDeg = d; dial.setAttribute('transform', `rotate(${d})`); }
  if (live !== compassLive) { compassLive = live; compassBtn.classList.toggle('live', live); }
  const want = Math.abs(view.r) > .004 || live;
  if (want !== compassShown) {
    compassShown = want; fade(compassBtn, want);
    if (want) compassBtn.setAttribute('aria-label', 'Turn the map north up');
  }
}
function northUp() {
  const R = visibleRect(), cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2;
  animateTo(viewAt(view.k, 0, following && shown ? shown : toMapPt(cx, cy), cx, cy));
}
compassBtn.onclick = () => { buzz(); if (headingUp) setLocState('follow'); northUp(); };
let anim = null, animUntil = 0;
function animateTo(target) {
  cancelAnimationFrame(anim); cancelAnimationFrame(glide);
  if (reduced) { Object.assign(view, { r: view.r }, target); render(); return; }
  // Fly the centre of the screen in a straight line while zoom changes
  // geometrically, so places don't drift sideways; long hops ease out a
  // little and back in, like Apple Maps.
  if (target.r == null) target = { ...target, r: view.r };
  const W = vw / 2, H = vh / 2, from = { ...view }, dr = wrapAngle(target.r - from.r);
  const c0 = toMapPt(W, H, from), c1 = toMapPt(W, H, target);
  const hop = Math.hypot(c1.x - c0.x, c1.y - c0.y) * Math.min(from.k, target.k) / Math.max(W, H);
  const lift = Math.min(0.45, Math.max(0, hop - 0.6) * 0.25);
  const dur = Math.min(900, 480 + hop * 120), t0 = performance.now();
  animUntil = t0 + dur + 50;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.exp(-7 * p) * (1 + 7 * p);          // critically damped, no overshoot
    const k = from.k * Math.pow(target.k / from.k, e) * (1 - lift * Math.sin(Math.PI * e));
    const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e;
    Object.assign(view, viewAt(k, from.r + dr * e, { x: cx, y: cy }, W, H));
    if (p < 1) { moving = true; apply(); anim = requestAnimationFrame(step); } else { moving = false; Object.assign(view, target, { r: wrapAngle(target.r) }); render(); }
  };
  anim = requestAnimationFrame(step);
}
function visibleRect() {
  const W = vw, H = vh;
  if (nav) {
    const b = $('#navBanner').getBoundingClientRect(), f = $('#navBar').getBoundingClientRect();
    return wide() ? { l: 448, t: 16, r: W - 72, b: H - 16 } : { l: 12, t: b.bottom + 8, r: W - 66, b: f.top - 8 };
  }
  const top = $('.topbar').getBoundingClientRect().bottom + 6;
  let R;
  if (wide()) R = { l: sheet.getBoundingClientRect().right + 12, t: top, r: W - 72, b: H - 16 };
  else R = { l: 12, t: top, r: W - 66, b: H - visibleFor(detent) - 8 };
  if (R.b - R.t < 140) R.b = R.t + 140;
  return R;
}
function fitBox(x0, y0, x1, y1, pad = 20, maxK = 4, instant = false, rot = view.r) {
  const R = visibleRect(), bw = Math.max(x1 - x0, 30), bh = Math.max(y1 - y0, 30);
  // the box's size on screen once turned with the map
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), w = c * bw + s * bh, h = s * bw + c * bh;
  const k = clampK(Math.min((R.r - R.l - pad * 2) / w, (R.b - R.t - pad * 2) / h, maxK));
  const target = viewAt(k, rot, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, (R.l + R.r) / 2, (R.t + R.b) / 2);
  if (instant) { Object.assign(view, target); render(); } else animateTo(target);
}
function fitItems(list, pad, maxK, instant) {
  const xs = list.map(i => i.x), ys = list.map(i => i.y);
  fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), pad, maxK, instant);
}
const fitAll = instant => fitBox(MAP_BOUNDS.x0, MAP_BOUNDS.y0, MAP_BOUNDS.x1, MAP_BOUNDS.y1, 4, 4, instant, 0);   // the whole airport, north up
const fitCon = con => fitItems(Object.values(ITEMS).filter(i => i.kind === 'gate' && i.con === con), 24, 5);

let userMoved = false;
function zoomAnimAt(px, py, f) {
  const nk = clampK(view.k * f), r = nk / view.k;
  animateTo({ k: nk, x: px - (px - view.x) * r, y: py - (py - view.y) * r });
}
stage.addEventListener('wheel', e => {
  e.preventDefault(); cancelAnimationFrame(anim); userMoved = true;
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
}, { passive: false });

const ptrs = new Map();
let moved = 0, downTarget = null, pinch = null;
stage.addEventListener('pointerdown', e => {
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) { moved = 0; downTarget = e.target.closest('[data-id], [data-con], [data-esc]'); } else downTarget = null;
  pinch = null; cancelAnimationFrame(anim); cancelAnimationFrame(glide); moving = false; userMoved = true;
  if (following) setLocState('on');
  vel = { x: 0, y: 0, t: e.timeStamp }; panned = ptrs.size === 1;
  $('#results').hidden = true; $('#q').blur();
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    moved += Math.abs(dx) + Math.abs(dy);
    const dt = Math.max(1, e.timeStamp - vel.t);
    vel = { x: .75 * dx / dt + .25 * vel.x, y: .75 * dy / dt + .25 * vel.y, t: e.timeStamp };
    view.x += dx; view.y += dy; apply();
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ang = Math.atan2(b.y - a.y, b.x - a.x);
    // two fingers twisting turn the map, once they've turned past a small threshold (so a pinch to
    // zoom doesn't wobble it)
    let turn = 0, twist = pinch ? pinch.twist : 0, on = pinch ? pinch.on : false;
    if (pinch) {
      const da = wrapAngle(ang - pinch.ang);
      if (on) turn = da; else { twist += da; if (Math.abs(twist) > .2) { on = true; turn = twist; buzz(5); } }
      zoomAt(mid.x, mid.y, d / pinch.d);
      if (turn) rotateAt(mid.x, mid.y, turn);
      view.x += mid.x - pinch.mid.x; view.y += mid.y - pinch.mid.y; apply();
    }
    pinch = { d, mid, ang, twist, on }; moved = 99; panned = false;
  }
});
function nearestMarker(cx, cy, maxPx = 24) {
  let best = null, bd = maxPx;
  for (const m of markers) {
    if (!m.dataset.id || m.getBoundingClientRect().width === 0) continue;
    const q = toScr({ x: +m.dataset.x, y: +m.dataset.y }), d = Math.hypot(q.x - cx, q.y - cy);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
let vel = { x: 0, y: 0, t: 0 }, panned = false, glide = null;
function startGlide() {
  // momentum after a flick, decaying like an iOS scroll view
  if (reduced || isStale()) return;
  let last = performance.now();
  const step = now => {
    const dt = Math.min(40, now - last); last = now;
    view.x += vel.x * dt; view.y += vel.y * dt;
    const f = Math.exp(-dt / 320); vel.x *= f; vel.y *= f;
    if (Math.hypot(vel.x, vel.y) > 0.02) { moving = true; apply(); glide = requestAnimationFrame(step); } else { moving = false; render(); }
  };
  glide = requestAnimationFrame(step);
}
// a flick only counts if the finger was still moving when it lifted
const isStale = () => performance.now() - vel.t > 80 || Math.hypot(vel.x, vel.y) < 0.15;
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); pinch = null;
  if (!ptrs.size && panned && moved >= 6 && e.type === 'pointerup') { startGlide(); if (!glide || isStale()) render(); }
  if (ptrs.size || moved >= 6 || e.type !== 'pointerup') return;
  const t = downTarget || nearestMarker(e.clientX, e.clientY);
  if (t && t.dataset.esc) { setFloor(floor === 'up' ? 'lo' : 'up'); }
  else if (t && t.dataset.con) { buzz(); fitCon(t.dataset.con); }
  else if (t) { buzz(); showPlace(ITEMS[t.dataset.id], true); }
  else {
    // double-tap empty map to zoom in, as in Apple Maps and Google Maps
    const now = e.timeStamp;
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      zoomAnimAt(e.clientX, e.clientY, 2); buzz(5); lastTap = null;
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
};
let lastTap = null;
stage.addEventListener('pointerup', endPtr);
stage.addEventListener('pointercancel', endPtr);
const zoomCenter = f => { const R = visibleRect(); userMoved = true; zoomAnimAt((R.l + R.r) / 2, (R.t + R.b) / 2, f); };
$('#zin').onclick = () => zoomCenter(1.6);
$('#zout').onclick = () => zoomCenter(1 / 1.6);
$('#zfit').onclick = () => fitAll();
// Concourse buttons zoom to a concourse; airports with many concourses get one button that opens a menu
const conMenu = $('#conMenu');
if (CONS.length <= 4) $('#conCap').innerHTML = CONS.map(c => `<button class="shape-btn" data-zoom="${c}" aria-label="Zoom to Concourse ${c}">${badgeSvg(c, 28)}</button>`).join('');
else {
  $('#conCap').innerHTML = `<button id="conBtn" class="shape-btn" aria-label="Zoom to a concourse" aria-haspopup="menu" aria-expanded="false">${icon('gate')}</button>`;
  conMenu.innerHTML = '<div class="lh">Concourses</div>' + CONS.map(c => `<button role="menuitem" data-zoom="${c}">${badgeSvg(c, 26)}Concourse ${c}<span class="s">${esc(CON_RANGE[c])}</span></button>`).join('');
  const openCons = open => {
    if (open) { const r = $('#conBtn').getBoundingClientRect(); conMenu.style.top = Math.max(8, Math.min(r.top, vh - 420)) + 'px'; stagger(conMenu, 'button'); }
    fade(conMenu, open); $('#conBtn').setAttribute('aria-expanded', String(open)); };
  $('#conBtn').onclick = () => { buzz(5); openCons(conMenu.hidden || conMenu.classList.contains('leaving')); };
  document.addEventListener('pointerdown', e => { if (!conMenu.hidden && !e.target.closest('#conMenu, #conBtn')) openCons(false); }, true);
  conMenu.addEventListener('click', () => openCons(false));
}
document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { buzz(); fitCon(b.dataset.zoom); });

// ---------- Walking puck that travels the route ----------
let routePts = [], routeLens = [], routeTotal = 0, puckRAF = null;
function placePuck(p) {
  if (!routePts.length) { puckG.setAttribute('opacity', 0); return; }
  p = p || puckG._p || routePts[0];
  puckG._p = p;
  puckG.setAttribute('opacity', 1);
  puckG.setAttribute('transform', upright(p.x, p.y, markerScale));
}
function pointAt(d) {
  let i = 1; while (i < routeLens.length && routeLens[i] < d) i++;
  if (i >= routePts.length) return routePts[routePts.length - 1];
  const a = routePts[i - 1], b = routePts[i], seg = routeLens[i] - routeLens[i - 1] || 1, u = (d - routeLens[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
function startPuck() {
  cancelAnimationFrame(puckRAF);
  if (!routePts.length) { placePuck(); return; }
  if (reduced) { placePuck(routePts[0]); return; }
  const t0 = performance.now(), speed = 70, hold = 900, laps = 3;
  let lastDraw = 0;
  const loop = now => {
    const travel = routeTotal / speed * 1000, el = now - t0;
    if (el > laps * (travel + hold)) { placePuck(routePts[0]); return; }
    if (now - lastDraw > 32) { lastDraw = now; placePuck(pointAt(Math.min(1, (el % (travel + hold)) / travel) * routeTotal)); }
    puckRAF = requestAnimationFrame(loop);
  };
  puckRAF = requestAnimationFrame(loop);
}
function markFloors(nodes) {
  const used = new Set(nodes.map(levelOf));
  document.querySelectorAll('#floorCap [data-floor]').forEach(b => b.classList.toggle('has-route', nodes.length > 1 && used.has(b.dataset.floor) && used.size > 1));
}
function setRoute(nodes, mins) {
  markFloors(nodes);
  for (const m of markers) m.classList.remove('dest');
  const endGate = id => ITEMS[id] && ITEMS[id].kind === 'gate' ? ITEMS[id] : null;
  const g0 = nodes.length > 1 && endGate(nodes[0]), g1 = nodes.length > 1 && endGate(nodes[nodes.length - 1]);
  if (g0) g0.el.classList.add('dest'); if (g1) g1.el.classList.add('dest');
  svg.classList.toggle('gate-start', !!g0); svg.classList.toggle('gate-end', !!g1);
  svg.classList.toggle('me-start', nodes[0] === 'me'); svg.classList.toggle('me-end', nodes[nodes.length - 1] === 'me');
  routeNodes = nodes.slice();
  routePts = nodes.map(n => NODE[n]);
  routeLens = [0];
  for (let i = 1; i < routePts.length; i++) routeLens.push(routeLens[i - 1] + dist(routePts[i - 1], routePts[i]));
  routeTotal = routeLens[routeLens.length - 1] || 0;
  const show = routePts.length > 1 ? 1 : 0;
  for (const g of [routeStart, routeEnd, eta]) g.setAttribute('opacity', show);
  if (show) {
    etaText.textContent = (mins || minutes(routeTotal)) + ' min';
    const w = etaText.textContent.length * 5.2 + 14;
    etaRect.setAttribute('x', -w / 2); etaRect.setAttribute('width', w);
  }
  cancelAnimationFrame(drawRAF);
  puckG._p = null; cancelAnimationFrame(puckRAF); placePuck();
  const draw = f => drawRoute(f);
  // escalator badges at each change of floor
  escLayer.innerHTML = ''; escBadges = [];
  for (let i = 1; i < routeNodes.length; i++) {
    const la = levelOf(routeNodes[i - 1]), lb = levelOf(routeNodes[i]);
    if (la === lb) continue;
    const a = routePts[i - 1], b = routePts[i], g = el('g', { class: 'esc', 'data-esc': lb, role: 'button' }, escLayer);
    const lift = EDGE_KIND[routeNodes[i - 1] + '|' + routeNodes[i]] === 'lift';
    el('title', {}, g).textContent = (lift ? 'Elevator' : 'Escalator') + (lb === 'lo' ? ' down to the lower level' : ' up to the upper level');
    el('circle', { r: 7 }, g);
    el('use', { class: 'glyph', href: lift ? '#i-lift' : '#i-swap', x: -4.5, y: -4.5, width: 9, height: 9 }, g);
    zsWrap(g); escBadges.push({ g, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  placeDecor();
  if (reduced || !show) { draw(1); startPuck(); return; }
  // draw the route in from the start, then send the puck along it
  const t0 = performance.now(), dur = 650;
  eta.setAttribute('opacity', 0); routeEnd.setAttribute('opacity', 0); puckG.setAttribute('opacity', 0);
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    draw(e);
    if (p < 1) drawRAF = requestAnimationFrame(step);
    else { eta.setAttribute('opacity', 1); routeEnd.setAttribute('opacity', 1); startPuck(); }
  };
  drawRAF = requestAnimationFrame(step);
}
let nav = null;
let drawRAF = null, pendingMe = null, routeNodes = [], routeDrawn = 1;
// Draw the first f of the route: parts on the floor you're looking at in full, the rest faded
function drawRoute(f) {
  routeDrawn = f;
  if (routePts.length < 2) { for (const p of [routeLine, routeCase, routeGhost, routeGhostCase]) p.setAttribute('d', ''); return; }
  const upto = routeTotal * f;
  let main = '', ghost = '', cur = null, run = '';
  const flush = () => { if (run) { if (cur) main += run; else ghost += run; } run = ''; };
  for (let i = 1; i < routePts.length && routeLens[i - 1] < upto; i++) {
    const la = levelOf(routeNodes[i - 1]), lb = levelOf(routeNodes[i]);
    const here = la !== lb || la === floor;          // escalator legs show on both floors
    const a = routePts[i - 1], b = routeLens[i] <= upto ? routePts[i] : pointAt(upto);
    if (here !== cur || !run) { flush(); cur = here; run = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}`; }
    run += `L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  flush();
  routeLine.setAttribute('d', main); routeCase.setAttribute('d', main);
  routeGhost.setAttribute('d', ghost); routeGhostCase.setAttribute('d', ghost);
}
// ---------- Floor picker ----------
const FLOOR_NAME = AP.ui.floors;
function setFloor(f, quiet) {
  if (!f || f === floor) return;
  // cross-fade: hold a copy of the old floor over the map and fade it out
  if (!reduced && committed) {
    const fc = $('#baseFade');
    if (fc.width !== baseCanvas.width || fc.height !== baseCanvas.height) { fc.width = baseCanvas.width; fc.height = baseCanvas.height; }
    fc.getContext('2d').drawImage(baseCanvas, 0, 0);
    fc.classList.remove('out'); void fc.offsetWidth; fc.classList.add('out');
    svg.classList.remove('floor-in'); void svg.getBBox(); svg.classList.add('floor-in');
    clearTimeout(setFloor.t); setFloor.t = setTimeout(() => svg.classList.remove('floor-in'), 400);
  }
  floor = f; svg.dataset.floor = f;
  document.querySelectorAll('#floorCap [data-floor]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.floor === f)));
  $('#floorCap').style.setProperty('--i', f === 'lo' ? 1 : 0);
  if (routeDrawn >= 1) drawRoute(1);
  if (committed) render();
  if (!quiet) { buzz(5); toast(FLOOR_NAME[f]); }
}
document.querySelectorAll('#floorCap [data-floor]').forEach(b => {
  b.onclick = () => setFloor(b.dataset.floor);
  const name = (AP.ui.floors[b.dataset.floor] || '').replace(' · ', ': ');
  b.title = name; b.setAttribute('aria-label', name);
});
svg.setAttribute('aria-label', `Map of ${AP.name}`);
function partialPath(f) {
  if (!routePts.length) return '';
  const upto = routeTotal * f, out = [routePts[0]];
  for (let i = 1; i < routePts.length; i++) {
    if (routeLens[i] <= upto) out.push(routePts[i]);
    else { out.push(pointAt(upto)); break; }
  }
  return 'M' + out.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L');
}

// ---------- My location ----------
let me = null, watchId = null, following = false, firstFix = true, meNode = null;
const toastEl = $('#toast');
let toastTimer = null;
function toast(msg, action, label = 'Settings') {
  $('#toastMsg').textContent = msg;
  const b = $('#toastAct'); b.hidden = !action; b.textContent = label; b.onclick = () => { fade(toastEl, false); action(); };
  if (toastEl.hidden) fade(toastEl, true); else bump(toastEl);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => fade(toastEl, false), action ? 7000 : 4200);
}
const toMap = (lat, lon) => ({ x: (lon - GEO.lon0) * GEO.kx, y: -(lat - GEO.lat0) * GEO.ky });
const locBtn = $('#locate');
// off · on (dot shown) · follow (the map moves with you) · heading (and turns so you face up)
function setLocState(state) {
  locBtn.classList.toggle('busy', state === 'busy');
  locBtn.classList.toggle('heading', state === 'heading');
  locBtn.setAttribute('aria-pressed', String(state === 'follow' || state === 'heading'));
  locBtn.setAttribute('aria-label', state === 'follow' && compassFresh() ? 'Turn the map with you' : state === 'heading' ? 'Stop showing my location' : 'Show my location');
  locBtn.querySelector('use').setAttribute('href', state === 'heading' ? '#i-compass' : '#i-locate');
  following = state === 'follow' || state === 'heading';
  headingUp = state === 'heading';
  updateCompass();
  if (following) kickCam();
}
const compassFresh = () => heading != null && Date.now() - headingAt < 5000;
// Your location joins the walking graph like any place does: a 'me' node at the dot, linked to the
// closest point on the nearest walkway of the floor you're on ('me@'), which joins that walkway's two
// ends. Routes then start from where you are and head the right way along the corridor, instead of
// from the nearest junction (on a long concourse that could be behind you).
let meAttach = null;
function detachMe() {
  for (const id of ['me', 'me@']) {
    for (const { to } of G[id] || []) G[to] = G[to].filter(e => e.to !== id);
    delete G[id]; delete NODE[id];
  }
}
// the closest point on a walkway of floor `lv` (not escalators, lifts or trains)
function nearestWalkSeg(p, lv) {
  let best = null;
  for (const a in G) {
    if (/^(m|g|v):|^me/.test(a) || levelOf(a) !== lv) continue;
    for (const { to: b, kind } of G[a]) {
      if (kind || a > b || /^(m|g|v):|^me/.test(b) || levelOf(b) !== lv) continue;
      const q = project(p, NODE[a], NODE[b]), d = dist(q, p);
      if (!best || d < best.d) best = { d, a, b, q };
    }
  }
  return best;
}
function attachMe(p) {
  const best = nearestWalkSeg(p, floor);
  if (!best) return null;
  detachMe();
  addNode('me', { x: p.x, y: p.y }); addNode('me@', { x: best.q.x, y: best.q.y });
  link('me', 'me@'); link('me@', best.a); link('me@', best.b);
  for (const k in dCache) delete dCache[k];     // distances from anywhere may now pass through you
  meLevel = floor;
  return { seg: best.a + '|' + best.b, x: p.x, y: p.y };
}
function nearestWalkNode(p) {
  let best = null, bd = Infinity;
  for (const id in NODE) {
    if (/^(g|m|v):/.test(id)) continue;          // walkway points only, not destinations
    const d = dist(NODE[id], p); if (d < bd) { bd = d; best = id; }
  }
  return best;
}
// Raw fixes are noisy indoors (tens of metres, jumping about). They go through a small Kalman
// filter that tracks position and walking velocity on each axis, trusts each fix by its accuracy
// and drops wild jumps; the dot is then kept on the nearest walkway and glides to its new spot.
const KF_ACC = 0.6;          // how sharply a walker can change speed, m/s²
const kf = { t: 0, rejects: 0, ax: null, ay: null };
let shown = null, glideRAF = null, heading = null, headingAt = 0, gpsHeadingAt = 0, warnedAcc = false, warnedSlow = false;
const kfAxis = z => ({ x: z, v: 0, p11: 0, p12: 0, p22: 1 });
function kfPredict(a, dt) {
  const q = KF_ACC * KF_ACC;
  a.x += a.v * dt;
  a.p11 += dt * (2 * a.p12 + dt * a.p22) + q * dt ** 4 / 4;
  a.p12 += dt * a.p22 + q * dt ** 3 / 2;
  a.p22 += q * dt * dt;
}
function kfUpdate(a, z, R) {
  const S = a.p11 + R, k1 = a.p11 / S, k2 = a.p12 / S, y = z - a.x;
  a.x += k1 * y; a.v += k2 * y;
  const p11 = a.p11, p12 = a.p12;
  a.p11 = (1 - k1) * p11; a.p12 = (1 - k1) * p12; a.p22 -= k2 * p12;
}
const kfPos = () => ({ x: kf.ax.x, y: kf.ay.x });
const kfSigma = () => Math.sqrt((kf.ax.p11 + kf.ay.p11) / 2);
function kalman(p, acc, t) {
  acc = Math.max(acc || 30, 3);
  if (!kf.t || t - kf.t > 120000) {
    Object.assign(kf, { t, rejects: 0, ax: kfAxis(p.x), ay: kfAxis(p.y) });
    kf.ax.p11 = kf.ay.p11 = acc * acc;
    return true;
  }
  if (t < kf.t) return false;   // an older fix arriving late (a cached one) adds nothing
  const dt = Math.min(30, Math.max(0, (t - kf.t) / 1000));
  kfPredict(kf.ax, dt); kfPredict(kf.ay, dt);
  const e = kfPos(), jump = Math.hypot(p.x - e.x, p.y - e.y), allow = 3 * Math.sqrt(kfSigma() ** 2 + acc * acc) + 5;
  // an implausible jump from a vague fix: skip it, unless they keep coming (then we were wrong)
  if (jump > allow && acc > 15 && kf.rejects < 3) { kf.rejects++; kf.t = t; return false; }
  if (kf.rejects >= 3) { Object.assign(kf, { t, rejects: 0, ax: kfAxis(p.x), ay: kfAxis(p.y) }); kf.ax.p11 = kf.ay.p11 = acc * acc; return true; }
  kfUpdate(kf.ax, p.x, acc * acc); kfUpdate(kf.ay, p.y, acc * acc);
  // people walk, or ride a moving walkway: cap the speed at about 3 m/s
  const sp = Math.hypot(kf.ax.v, kf.ay.v); if (sp > 3) { kf.ax.v *= 3 / sp; kf.ay.v *= 3 / sp; }
  kf.t = t; kf.rejects = 0;
  return true;
}
// walkway segments on the floor you're looking at, for keeping the dot on them
let walkSegs = null, walkSegsFloor = null;
function snapToWalkway(p, radius) {
  if (walkSegsFloor !== floor) {
    walkSegsFloor = floor;
    walkSegs = EDGES.filter(([a, b, z, kind]) => z !== 'X' && !kind && levelOf(a) === floor && levelOf(b) === floor).map(([a, b]) => [P(a), P(b)]);
  }
  let best = null, bd = radius;
  for (const [a, b] of walkSegs) {
    const q = project(p, a, b), d = dist(q, p);
    if (d < bd) { bd = d; best = q; }
  }
  return best ? { x: best.x, y: best.y } : p;
}
function drawMe(p, acc) {
  meAcc.setAttribute('cx', p.x); meAcc.setAttribute('cy', p.y);
  meAcc.style.r = Math.max(4, Math.min(acc, 250)) + 'px';
  meAcc.style.opacity = acc > 80 ? .5 : 1;
  meMark.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${markerScale})`);
  const fresh = heading != null && Date.now() - headingAt < 5000;
  meCone.setAttribute('opacity', fresh ? 1 : 0);
  if (fresh) aimCone(heading);
}
// walking: an even glide lasting until the next fix is due, so the dot and map move steadily rather
// than in hops; standing: a short ease into place
function glideTo(target, acc, walking) {
  cancelAnimationFrame(glideRAF);
  if (!shown || reduced || Math.hypot(target.x - shown.x, target.y - shown.y) > 150) { shown = { ...target }; drawMe(shown, acc); kickCam(); return; }
  const from = { ...shown }, t0 = performance.now(), dur = walking ? 1050 : 450;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = walking ? k : 1 - Math.pow(1 - k, 3);
    shown = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
    drawMe(shown, acc); kickCam();
    if (k < 1) glideRAF = requestAnimationFrame(step);
  };
  glideRAF = requestAnimationFrame(step);
}
// While following, the camera moves with you: it keeps the dot in the middle of the visible map at
// whatever zoom you chose, and in compass mode also turns the map so the way you face is up.
// One loop eases it there and stops once it's caught up; the dot's glide and the compass wake it.
// Standing still, GPS jitter would slide the whole map about under you, so the camera holds still
// until the dot strays well off centre; walking, it stays centred on you.
let camRAF = null, camMoving = false, headingUp = false, walkingNow = false, camChasing = false;
let walkRun = 0;
function camStep() {
  camRAF = null;
  const stop = () => { if (camMoving) { camMoving = false; moving = false; apply(); } };
  if (!following || !shown || ptrs.size || performance.now() < animUntil) return stop();
  const R = visibleRect(), cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2;
  const tr = headingUp && heading != null ? wrapAngle(-heading * Math.PI / 180) : view.r, dr = wrapAngle(tr - view.r);
  const r = Math.abs(dr) < .003 ? tr : view.r + dr * .14;
  let t = viewAt(view.k, r, shown, cx, cy), dx = t.x - view.x, dy = t.y - view.y;
  const off = Math.hypot(dx, dy), hold = Math.min(R.r - R.l, R.b - R.t) * .18;
  if (!walkingNow && !camChasing && off < hold && r === view.r) return stop();
  camChasing = off > 2 || r !== tr;
  if (Math.abs(dx) < .3 && Math.abs(dy) < .3 && r === tr) { if (dx || dy || view.r !== r) { Object.assign(view, t); moving = true; apply(); } return stop(); }
  // a spring, not a snap: a far-off camera (after you panned, or a step overview) eases back to you
  const f = Math.hypot(dx, dy) > 24 ? .2 : 1;
  view.r = r; view.x += dx * f; view.y += dy * f;
  camMoving = true; moving = true; apply();
  camRAF = requestAnimationFrame(camStep);
}
const kickCam = () => { if (!camRAF && following) camRAF = requestAnimationFrame(camStep); };
function onFix(pos) {
  const { latitude, longitude, accuracy, heading: gpsHeading, speed } = pos.coords;
  const raw = toMap(latitude, longitude), far = Math.hypot(raw.x, raw.y);
  if (far > 2500) {
    me = { ...raw, acc: accuracy }; lastFixAt = Date.now(); meG.setAttribute('opacity', 1); drawMe(raw, accuracy);
    if (firstFix) toast(`You’re ${(far / 1609).toFixed(1)} miles from ${AP.code}. Your dot will appear when you’re at the airport.`);
    firstFix = false; setLocState('on'); return;
  }
  // a very rough fix (cell towers) once we've had a good one recently adds nothing
  if (accuracy > 200 && kf.t && kfSigma() < 100 && Date.now() - kf.t < 60000) return;
  if (!kalman(raw, accuracy, pos.timestamp || Date.now())) return;
  if (gpsHeading != null && !isNaN(gpsHeading) && (speed || 0) > 0.8) { heading = gpsHeading; headingAt = gpsHeadingAt = Date.now(); if (headingUp) kickCam(); }
  // the ring shows how sure we really are: the filter's spread, never much tighter than the fix itself
  // keep the dot on a walkway only when one is close: never pull it across a hall or out of a gate area
  const acc = Math.max(kfSigma(), accuracy * .5), est = kfPos(), snap = q => acc < 40 ? snapToWalkway(q, Math.min(20, Math.max(8, acc))) : q;
  const p = snap(est);
  // while walking, aim the dot where you'll be when the next fix comes, so it isn't a step behind
  // walking? the phone's own speed when it gives one, else the filter's speed on two fixes running
  // (one noisy fix can make standing still look like a step)
  const vx = kf.ax.v, vy = kf.ay.v, sp = Math.hypot(vx, vy);
  walkRun = sp > .7 ? walkRun + 1 : 0;
  const walking = acc < 40 && (speed != null && !isNaN(speed) ? speed > .5 && sp > .4 : walkRun >= 2);
  walkingNow = walking;
  const aim = walking ? snap({ x: est.x + vx, y: est.y + vy }) : p;
  const appearing = !me || meG.getAttribute('opacity') === '0';
  me = { ...p, acc }; lastFixAt = Date.now(); meG.classList.remove('stale');
  meG.setAttribute('opacity', 1);
  glideTo(aim, acc, walking);
  if (appearing) pingMe(true);
  if (!warnedAcc && acc > 50 && !firstFix) { warnedAcc = true; toast(`Indoors your location is approximate (±${Math.round(acc / 5) * 5} m). Use it as a guide.`); }
  // "My location" can start a route once we're at the airport
  // re-attach after a few metres, or when you're on a different walkway: then the route redraws from you
  const moved = !meAttach || Math.hypot(p.x - meAttach.x, p.y - meAttach.y) > 4 || meAttach.floor !== floor;
  if (moved) { const at = attachMe(p); if (at) meAttach = { ...at, floor }; }
  const node = meAttach ? 'me' : nearestWalkNode(p);
  ITEMS['v:me'] = { id: 'v:me', kind: 'place', name: 'My location', node, zone: 'L', x: p.x, y: p.y, el: meG };
  navFix(p);
  if (pendingMe) { $('#' + pendingMe).value = 'v:me'; pendingMe = null; meNode = null; if (tab === 'dir' && !placeMode) updateRoute(true); }
  if (moved && !nav) {
    meNode = node;
    if (($('#from').value === 'v:me' || $('#to').value === 'v:me') && tab === 'dir' && !placeMode) updateRoute(false);
  }
  if (firstFix) {
    const r = Math.max(acc, 40);
    fitBox(p.x - r, p.y - r, p.x + r, p.y + r, 20, 3.2);
    setLocState('follow');
  }
  firstFix = false;
}
// which way the phone is pointing (compass), between GPS headings
function onCompass(deg) {
  if (deg == null || isNaN(deg) || Date.now() - gpsHeadingAt < 3000) return;
  heading = (deg + 360) % 360; headingAt = Date.now();
  if (shown && me) drawMe(shown, me.acc);
  if (headingUp) kickCam();
}
window.cleHeading = deg => onCompass(deg);
window.cleLocation = o => onFix({ coords: { latitude: o.lat, longitude: o.lon, accuracy: o.acc, heading: o.heading, speed: o.speed }, timestamp: o.t || Date.now() });
window.cleLocationError = code => onLocError({ code });
let compassOn = false;
function browserCompass(on) {
  const h = e => onCompass(e.webkitCompassHeading != null ? e.webkitCompassHeading : e.absolute && e.alpha != null ? 360 - e.alpha : null);
  const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  if (on && !compassOn) addEventListener(evt, h, true); else if (!on && compassOn) removeEventListener(evt, h, true);
  browserCompass.h = h; compassOn = on;
}
function onLocError(err) {
  const app = window.CLEApp;
  if (err.code === 1) {
    setLocState('off');
    toast(app ? 'Location is off for ' + APP_NAME + '. Allow it in Settings to see where you are.' : 'This page can’t use your location. Open the Android app to see where you are.',
      app && app.openSettings ? () => app.openSettings() : null);
    stopLocating(true);
    return;
  }
  // indoors a fix can be slow or briefly unavailable: keep trying rather than giving up
  if (!warnedSlow) { warnedSlow = true; toast(err.code === 2 ? 'Can’t find your location yet. Make sure Location is on; Wi-Fi helps indoors.' : 'Still looking for your location. It’s slower indoors.'); }
  if (!me) setLocState('busy');
}
function stopLocating(keepDot) {
  if (watchId != null && navigator.geolocation && watchId !== 'native') navigator.geolocation.clearWatch(watchId);
  if (watchId === 'native' && window.CLEApp && CLEApp.stopLocation) CLEApp.stopLocation();
  watchId = null; browserCompass(false); cancelAnimationFrame(glideRAF);
  if (!keepDot) { detachMe(); meAttach = null; me = null; shown = null; kf.t = 0; heading = null; coneAngle = null; meG.setAttribute('opacity', 0); meG.classList.remove('stale'); delete ITEMS['v:me']; }
}
function startLocating() {
  setLocState('busy'); firstFix = true; warnedSlow = false;
  if (window.CLEApp && CLEApp.startLocation) { watchId = 'native'; CLEApp.startLocation(); return; }   // Android: fused location and compass
  if (!navigator.geolocation) { setLocState('off'); toast('Location isn’t available on this device.'); return; }
  watchId = navigator.geolocation.watchPosition(onFix, onLocError, { enableHighAccuracy: true, maximumAge: 0 });
  // a recent cached fix shows the dot at once while the precise one warms up
  navigator.geolocation.getCurrentPosition(pos => { if (watchId != null && watchId !== 'native') onFix(pos); }, () => {}, { enableHighAccuracy: false, maximumAge: 120000, timeout: 2000 });
  browserCompass(true);
}
locBtn.onclick = () => {
  buzz();
  if (watchId == null) startLocating();
  else if (!following && me && Math.hypot(me.x, me.y) <= 2500) { setLocState('follow'); pingMe(false); const d = shown || me, R = visibleRect(); animateTo(viewAt(Math.max(view.k, 2.4), view.r, d, (R.l + R.r) / 2, (R.t + R.b) / 2)); }
  // following, with a compass: turn the map so the way you face is up (like Google and Apple Maps)
  else if (following && !headingUp && compassFresh()) { setLocState('heading'); toast('The map now turns with you. Tap the compass to put north back up.'); }
  else { const wasUp = headingUp; setLocState('off'); stopLocating(false); if (wasUp) northUp(); }
};

// ---------- Sheet (iOS detents) ----------
const sheet = $('#sheet'), sheetHead = $('#sheetHead'), sheetBody = $('#sheetBody');
let detent = 'peek', sheetY = 0, placeMode = false;
const cssPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
function visibleFor(d) {
  if (wide()) return 0;
  const H = sheet.offsetHeight;
  if (d === 'full') return H;
  if (d === 'half') return Math.min(H, Math.round(vh * 0.52));
  const first = sheetBody.querySelector('.pane:not([hidden]) > *');
  let extra = first ? Math.min(first.offsetHeight, 200) + 20 : 90;
  // keep the "nearest" buttons in the collapsed sheet too
  const next = first && first.nextElementSibling;
  if (next && next.classList.contains('quick') && !next.hidden) extra += next.offsetHeight + 16;
  return Math.min(H, sheetHead.offsetHeight + extra + cssPx('--sab'));
}
sheet.addEventListener('transitionend', () => { chromeCache = null; cullLabels(); });
function setSheetY(y, animate) {
  chromeCache = null;
  sheet.classList.toggle('snapping', !!animate && !reduced);
  sheetY = y;
  sheet.style.setProperty('--y', y + 'px');
  sheetBody.style.setProperty('--pad-b', (wide() ? 0 : y) + 'px');
}
function setDetent(d, animate = true) {
  const prev = detent;
  detent = d;
  setSheetY(sheet.offsetHeight - visibleFor(d), animate);
  if (animate && prev !== d) buzz(6);
}
const DETENTS = ['full', 'half', 'peek'];
let drag = null;
sheetHead.addEventListener('pointerdown', e => {
  if (wide()) return;
  drag = { y0: e.clientY, s0: sheetY, active: false, lastY: e.clientY, lastT: e.timeStamp, v: 0, id: e.pointerId, onCtl: !!e.target.closest('button, select') };
});
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0;
  if (!drag.active && Math.abs(dy) > 6) {
    drag.active = true; sheet.classList.remove('snapping');
    try { sheetHead.setPointerCapture(e.pointerId); } catch (err) {}
  }
  if (!drag.active) return;
  const maxY = sheet.offsetHeight - visibleFor('peek');
  let y = drag.s0 + dy;
  if (y < 0) y = y / 3;                                 // rubber band at the top
  if (y > maxY) y = maxY + (y - maxY) / 3;
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.v = (e.clientY - drag.lastY) / dt; drag.lastY = e.clientY; drag.lastT = e.timeStamp;
  setSheetY(y, false);
});
const endDrag = e => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.active) {
    const projected = sheetY + d.v * 220, H = sheet.offsetHeight;
    let best = 'peek', bd = Infinity;
    for (const name of DETENTS) { const y = H - visibleFor(name), dd = Math.abs(y - projected); if (dd < bd) { bd = dd; best = name; } }
    setDetent(best);
  } else if (!d.onCtl && e.type === 'pointerup' && sheetHead.contains(e.target)) {
    setDetent(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'half');
  }
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
// focusing a field in the sheet lifts it so the field is visible
sheetBody.addEventListener('focusin', () => { if (!wide() && detent === 'peek') setDetent('half'); });

// ---------- Category chips (map layers) ----------
// ---------- Layers: which kinds of place show on the map ----------
const layersEl = $('#layers'), layersBtn = $('#layersBtn');
layersEl.innerHTML = '<div class="lh">Show on map</div>' + Object.entries(CATS).map(([cat, c]) =>
  `<button role="menuitemcheckbox" aria-pressed="true" data-cat="${cat}"><span class="tile ${cat}">${icon(cat)}</span>${c.label}<span class="tick">${icon('check')}</span></button>`).join('');
layersEl.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
  const on = b.getAttribute('aria-pressed') === 'true';
  b.setAttribute('aria-pressed', String(!on)); svg.classList.toggle('hide-' + b.dataset.cat, on); buzz(5); cullLabels();
});
function openLayers(open) { if (open) stagger(layersEl, 'button'); fade(layersEl, open); layersBtn.setAttribute('aria-expanded', String(open)); }
layersBtn.onclick = () => { buzz(5); openLayers(layersEl.hidden || layersEl.classList.contains('leaving')); };
document.addEventListener('pointerdown', e => { if (!layersEl.hidden && !e.target.closest('#layers, #layersBtn')) openLayers(false); }, true);
$('#q').placeholder = `Search ${AP.short}`;

// ---------- Tabs ----------
function replay(node) { if (reduced) return; node.classList.remove('enter'); void node.offsetWidth; node.classList.add('enter'); }
// Show or hide a popover, letting it fade out rather than vanish
function fade(node, show) {
  clearTimeout(node._fade);
  if (show) { node.classList.remove('leaving'); node.hidden = false; return; }
  if (node.hidden || reduced) { node.hidden = true; node.classList.remove('leaving'); return; }
  node.classList.add('leaving');
  node._fade = setTimeout(() => { node.hidden = true; node.classList.remove('leaving'); }, 160);
}
function bump(node) { if (reduced) return; node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); }
// stagger the rows of a list as it opens
function stagger(node, sel) { node.querySelectorAll(sel).forEach((r, i) => r.style.setProperty('--n', Math.min(i, 10))); }
// the big minutes figure nudges when the time changes
let heroMins = null;
new MutationObserver(() => {
  const n = $('#hero .num'), v = n && n.firstChild ? n.firstChild.textContent : null;
  if (n && heroMins !== null && v !== heroMins) bump(n);
  heroMins = v;
}).observe($('#hero'), { childList: true });
const TAB_TITLES = { dir: 'Directions', kill: 'Pass the time', air: 'Airlines' };
let tab = 'dir';
function setTab(name, quiet) {
  tab = name; placeMode = false; $('#placeTile').hidden = true; $('#title').classList.remove('long');
  $('#seg').hidden = false; $('#closePlace').hidden = true; $('#pane-place').hidden = true; $('#modeSw').hidden = name !== 'dir';
  ['dir', 'kill', 'air'].forEach((t, i) => {
    $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    $('#pane-' + t).hidden = t !== name;
    if (t === name) $('#seg').style.setProperty('--i', i);
  });
  replay($('#pane-' + name)); replay($('#title'));
  $('#title').textContent = name === 'dir' && mode === 'arr' ? 'Arrivals' : name === 'dir' && mode === 'con' ? 'Connecting' : TAB_TITLES[name];
  $('#eyebrow').innerHTML = `<span class="ap-code">${esc(AP.code)}</span><span class="ap-name">${esc(AP.short)}</span>`; $('#eyebrow').classList.add('can');
  $('#title').hidden = true;
  if (selected) { selected.el.classList.remove('sel'); selected = null; }
  pickHall(null);
  setPin(null);
  if (name === 'dir') updateRoute(false);
  if (name === 'kill') updateIdeas();
  if (!quiet) buzz(5);
  sheetBody.scrollTop = 0;
  if (!wide() && detent === 'peek') setDetent('peek', true);
}
$('#tab-dir').onclick = () => setTab('dir');
$('#tab-kill').onclick = () => setTab('kill');
$('#tab-air').onclick = () => setTab('air');

// ---------- Place card ----------
let selected = null;
function nearbyItems(it, n = 8) {
  const seen = new Set();
  return Object.values(ITEMS)
    .filter(o => o.kind === 'amen' && o.cat !== 'rest' && o !== it && o.name !== it.name && dist(o, it) < 34 && (!o.lvl || !it.lvl || o.lvl === it.lvl))
    .sort((a, b) => dist(a, it) - dist(b, it))
    .filter(o => !seen.has(o.name) && seen.add(o.name)).slice(0, n);
}
const nearbyNames = (it, n = 6) => nearbyItems(it, n).map(o => o.name);
const tileFor = it => it.kind === 'gate' ? `<span class="tile ${it.con}">${icon('gate')}</span>`
  : it.kind === 'amen' ? `<span class="tile ${it.cat}">${icon(it.icon || it.cat)}</span>` : `<span class="tile place ${it.pk || ''}">${icon(it.icon || 'place')}</span>`;
function showPlace(it, fromMap) {
  if (!it) return;
  if (selected) selected.el.classList.remove('sel');
  selected = it; it.el.classList.add('sel'); setPin(it);
  pickHall(it.kind === 'place' && it.node === ROLE.ticketing ? 'up' : it.kind === 'place' && it.node === ROLE.baggage ? 'lo' : null);
  if (it.lvl && it.lvl !== floor) setFloor(it.lvl); else cullLabels();
  placeMode = true;
  $('#seg').hidden = true; $('#closePlace').hidden = false; $('#modeSw').hidden = true;
  $('#eyebrow').classList.remove('can'); openAirports(false); $('#title').hidden = false;
  ['dir', 'kill', 'air'].forEach(t => $('#pane-' + t).hidden = true);
  const pane = $('#pane-place'); pane.hidden = false; replay(pane); replay($('#title'));
  $('#title').textContent = it.name; $('#title').classList.toggle('long', it.name.length > 22);
  $('#eyebrow').textContent = it.kind === 'gate' ? `Concourse ${it.con}` : it.kind === 'amen' ? (/^Carousel \d/.test(it.name) ? 'Baggage claim' : /^(Escalators|Elevator)$/.test(it.name) ? 'Between floors' : CATS[it.cat].label) : (it.node === ROLE.checkpoint ? 'Main terminal' : 'Arrive & depart');
  const tile = $('#placeTile'); tile.innerHTML = tileFor(it); tile.hidden = false; replay(tile.firstChild);
  // walk time from wherever directions currently start (security if that's this place)
  const fromIt = ITEMS[$('#from').value] && $('#from').value !== it.id ? ITEMS[$('#from').value] : ITEMS[CHK];
  const walk = fromIt !== it ? route(fromIt, it) : null;
  const hs = hoursStatus(it);
  const summary = [];
  if (hs) summary.push(`<span class="${hs.state === 'open' ? 'ok' : hs.state === 'closed' ? 'no' : 'warn'}">${esc(hs.text)}</span>`);
  const wm = isChk(it.id) ? waitMin() : null;
  if (wm != null) summary.push(`<span class="${wm >= 30 ? 'no' : wm >= 15 ? 'warn' : 'ok'}">~${wm} min wait</span>`);
  if (it.kind === 'amen') summary.push(`<span>${esc(it.near)}</span>`);
  if (it.kind === 'gate') summary.push(`<span class="marks">${AIRLINES.filter(a => a.cons.includes(it.con) && !a.partner).slice(0, 5).map(a => airMark(a, 20)).join('')}</span>`);
  if (it.zone === 'L' || it.kind === 'place') summary.push(`<span>${it.lvl === 'lo' ? 'Lower level' : 'Upper level'}</span>`);
  let html = summary.length ? `<p class="summary">${summary.join('')}</p>` : '';
  html += `<div class="bgroup">
    <button class="primary" data-act="to">${icon('walk')}Directions${walk && walk.path ? `<span class="sub">${minutes(walk.units)} min</span>` : ''}</button>
    <button data-act="from">${icon('flag')}Start here</button></div>`;
  // what to know before you go: the airport's tip for this place
  const tip = (AP.ui.arrivals || []).find(a => a[0] === it.id);
  if (tip) html += `<div class="group tip">${tileFor(it)}<span>${esc(tip[2])}</span></div>`;
  const rows = [];
  if (it.note) rows.push(['About', esc(it.note)]);
  if (wm != null) rows.push(['Security wait', `About ${wm} min${live.wait.precheck ? ' · PreCheck open' : ''} · ${ago(live.wait.updated)}`]);
  if (it.hours) rows.push(['Schedule', esc(hoursLine(it))]);
  if (it.kind === 'amen' && it.cat !== 'rest' && !/^(Carousel \d+|Escalators|Elevator)$/.test(it.name)) rows.push(['Typical visit', `About ${it.dwell} min`]);
  if (walk && walk.path && !isChk(fromIt.id)) rows.push([`From ${esc(fromIt.label || fromIt.name)}`, `${minutes(walk.units)} min · ${meters(walk.len)} m`]);
  if (it.zone !== 'L' && !isChk(it.id)) {
    const { units, len } = secRoute(it);
    rows.push(['From security', `${minutes(units)} min · ${meters(len)} m`]);
  }
  if (it.kind === 'gate') rows.push(['Concourse', `${it.con} · ${CON_RANGE[it.con]}`]);
  const chkCfg = it.kind === 'place' && (AP.CHECKPOINTS || {})[it.node];
  if (chkCfg && (chkCfg.busy || chkCfg.open)) rows.push(['Hours', chkCfg.busy ? 'Opens when it’s busy' : `${ampm(chkCfg.open)} – ${ampm(chkCfg.close)}${chkOpen(it.node) ? '' : ' · closed now'}`]);
  if (rows.length) html += `<div class="group">${rows.map(([k, v]) => `<div class="row"><span class="rl" style="flex:none">${k}</span><span style="flex:1;min-width:0;color:var(--label-2);text-align:right">${v}</span></div>`).join('')}</div>`;
  if (it.kind === 'gate') {
    html += `<div class="group-title">Airlines in Concourse ${it.con}</div><div class="group tags">${AIRLINES.filter(a => a.cons.includes(it.con)).map(a => `<span class="tag air-tag">${airMark(a, 22)}${esc(a.name)}</span>`).join('')}</div>`;
  }
  // ticketing: the checkpoints off the hall, nearest first, and whether each is open
  if (it.kind === 'place' && it.node === ROLE.ticketing && AP.CHECKPOINTS) {
    const list = Object.keys(AP.CHECKPOINTS).map(id => ({ id, it: ITEMS['v:' + id], open: chkOpen(id), m: minutes(route(it, ITEMS['v:' + id]).units) })).sort((a, b) => (b.open - a.open) || a.m - b.m);
    html += `<div class="group-title">Security checkpoints</div><div class="group">${list.map(c => `<button class="row" data-near="${c.it.id}"><span class="rl">${esc(c.it.name.replace(/^TSA /, ''))}</span><span style="flex:1;text-align:right;color:var(--label-2)">${c.open ? c.m + ' min walk' : AP.CHECKPOINTS[c.id].busy ? 'Opens when busy' : 'Closed now'}</span></button>`).join('')}</div>`;
  }
  // baggage claim: every carousel, one tap to its spot
  if (it.kind === 'place' && it.node === ROLE.baggage && Object.keys(CAROUSEL).length) {
    html += `<div class="group-title">Carousels</div><div class="gate-chips">${Object.keys(CAROUSEL).map(n => `<button data-near="${CAROUSEL[n].id}" class="gate-chip car-chip">${n}</button>`).join('')}</div>`;
    html += `<p class="foot" style="margin:-6px 16px 0">Your flight's carousel is on the arrival screens by the escalators, and in Clearway once you track the flight.</p>`;
  }
  if (it.hours && !it.hours.h24 && !it.hours.close) html += `<p class="foot" style="margin:-6px 16px 0">Opening times from the airport's directory. Closing times aren't published; they follow the last flights.</p>`;
  const near = it.kind !== 'place' ? nearbyItems(it) : [];
  if (near.length) html += `<div class="group-title">Nearby</div><div class="near">${near.map(o => {
    const s = hoursStatus(o), m = Math.max(1, Math.round(dist(o, it) / M_PER_MIN));
    return `<button data-near="${o.id}">${tileFor(o)}<b>${esc(o.name)}</b><small>${s && s.state === 'closed' ? 'Closed' : m + ' min walk'}</small></button>`;
  }).join('')}</div>`;
  pane.innerHTML = html;
  pane.querySelector('[data-act="to"]').onclick = () => { buzz(); $('#to').value = it.id; if ($('#from').value === it.id) $('#from').value = CHK; setTab('dir', true); if (!wide()) setDetent('peek'); routeNow(); };
  pane.querySelectorAll('[data-near]').forEach(b => b.onclick = () => { buzz(5); showPlace(ITEMS[b.dataset.near], false); });
  pane.querySelector('[data-act="from"]').onclick = () => { buzz(); $('#from').value = it.id; if ($('#to').value === it.id) $('#to').value = CHK; setTab('dir', true); if (!wide()) setDetent('peek'); routeNow(); };
  sheetBody.scrollTop = 0;
  if (!wide()) setDetent(detent === 'full' || detent === 'peek' ? 'half' : detent);
  if (!fromMap) fitItems([it], 60, 3.5);
  else requestAnimationFrame(() => {
    // keep the tapped marker in view above the sheet
    const R = visibleRect(), { x: sx, y: sy } = toScr(it);
    if (sy > R.b - 20 || sy < R.t || sx < R.l || sx > R.r) animateTo({ k: view.k, x: view.x + ((R.l + R.r) / 2 - sx), y: view.y + ((R.t + R.b) / 2 - sy) });
  });
}
$('#closePlace').onclick = () => { buzz(5); setTab(tab, true); };

// ---------- Navigation: step by step ----------
let curSteps = [];
$('#hero').addEventListener('click', e => { if (e.target.closest('[data-go]')) startNav(); });
// Which way you turn leaving the route at distance d: compare the heading a few metres before and after
function turnAt(d) {
  if (d <= 1 || d >= routeTotal - 1) return 'straight';
  const a = pointAt(Math.max(0, d - 14)), b = pointAt(d), c = pointAt(Math.min(routeTotal, d + 14));
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  if (Math.hypot(ux, uy) < 1 || Math.hypot(vx, vy) < 1) return 'straight';
  const ang = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180 / Math.PI;   // y points down, so positive is a right turn
  const m = Math.abs(ang), side = ang > 0 ? 'right' : 'left';
  return m < 30 ? 'straight' : m < 60 ? 'slight-' + side : m < 150 ? side : 'uturn';
}
const TURN_TEXT = { follow: 'Follow the signs', straight: 'Continue straight', 'slight-left': 'Bear left', 'slight-right': 'Bear right', left: 'Turn left', right: 'Turn right', uturn: 'Turn around' };
function buildLegs() {
  // where each step sits along the drawn route
  let k = 0;
  const at = curSteps.map(s => {
    let j = routeNodes.indexOf(s.node, k); if (j < 0) j = s.end ? routeNodes.length - 1 : k;
    k = j; return j;
  });
  const legs = [];
  for (let i = 1; i < curSteps.length; i++) {
    const ia = at[i - 1], ib = at[i];
    let change = null;
    for (let j = ia + 1; j <= ib; j++) if (levelOf(routeNodes[j - 1]) !== levelOf(routeNodes[j])) {
      change = { lift: EDGE_KIND[routeNodes[j - 1] + '|' + routeNodes[j]] === 'lift', down: levelOf(routeNodes[j]) === 'lo' };
    }
    // at the foot of an escalator or out of a lift the drawn geometry doesn't match what you see, so just follow the signs
    const prev = legs[legs.length - 1];
    legs.push({ step: curSteps[i], from: curSteps[i - 1], ia, ib, d0: routeLens[ia] || 0, d1: routeLens[ib] || 0, change, turn: i === 1 ? 'start' : prev && prev.change ? 'follow' : turnAt(routeLens[ia] || 0) });
  }
  return legs;
}
function startNav() {
  if (routeNodes.length < 2 || curSteps.length < 2) return;
  buzz(); nav = { legs: buildLegs(), i: 0, done: false };
  document.body.classList.add('navigating'); chromeCache = null;
  fade($('#navBanner'), true); fade($('#navBar'), true);
  showLeg(0, 1);
  if (me && !following && $('#from').value === 'v:me' && Math.hypot(me.x, me.y) <= 2500) setLocState('follow');
}
function endNav() {
  if (!nav) return;
  nav = null; buzz(5);
  document.body.classList.remove('navigating'); chromeCache = null;
  fade($('#navBanner'), false); fade($('#navBar'), false);
  setDetent(wide() ? detent : 'peek');
  fitItems(routePts, 24, 3.5);
}
function showLeg(i, dir) {
  const legs = nav.legs;
  nav.i = Math.max(0, Math.min(legs.length, i));
  const main = $('#nbMain'), banner = $('#navBanner');
  main.classList.toggle('back', dir < 0); replay(main);
  if (nav.i === legs.length) {
    // arrived
    const s = legs[legs.length - 1].step;
    banner.classList.add('arrived');
    main.innerHTML = `<span class="nb-ico">${icon('flag')}</span><span class="nb-dist">You’re there</span><span class="nb-t">${esc(s.t)}</span>${s.n ? `<span class="nb-n">${esc(s.n)}</span>` : ''}`;
    $('#nvMins').textContent = 'Arrived'; $('#nvSub').textContent = clock(Date.now());
    $('#nvEnd').textContent = 'Done'; $('#navBar').classList.add('done');
    $('#nbNext').disabled = true; $('#nbPrev').disabled = false; $('#nbCount').textContent = `${legs.length} of ${legs.length}`;
    const p = NODE[s.node] || routePts[routePts.length - 1];
    setFloor(levelOf(s.node), true); fitBox(p.x - 30, p.y - 30, p.x + 30, p.y + 30, 10, 4);
    buzz(); return;
  }
  banner.classList.remove('arrived'); $('#navBar').classList.remove('done'); $('#nvEnd').textContent = 'End';
  const L = legs[nav.i], dist = Math.max(5, Math.round((L.d1 - L.d0) / 5) * 5);
  let ico = 'straight', cls = '', how = TURN_TEXT[L.turn] || '';
  if (L.turn === 'start') { ico = 'walk'; how = `From ${L.from.t}`; }
  else if (L.turn === 'uturn') ico = 'uturn';
  else if (L.turn.includes('left') || L.turn.includes('right')) { ico = L.turn.startsWith('slight') ? 'slight' : 'right'; if (L.turn.includes('left')) cls = 'left'; }
  if (L.change) { ico = L.change.lift ? 'lift' : 'swap'; cls = ''; how = `${L.change.lift ? 'Elevator' : 'Escalator'} ${L.change.down ? 'down to the lower level' : 'up to the upper level'}`; }
  if (L.step.end) ico = L.change ? ico : 'flag';
  const note = [how, L.step.n].filter(Boolean).join(' · ');
  main.innerHTML = `<span class="nb-ico ${cls}">${icon(ico)}</span><span class="nb-dist">${dist}<small> m</small></span><span class="nb-t">${esc(L.step.t.replace(/\s*\((upper|lower) level\)$/, ''))}</span>${note ? `<span class="nb-n">${esc(note)}</span>` : ''}`;
  $('#nbCount').textContent = `Step ${nav.i + 1} of ${legs.length}`;
  $('#nbPrev').disabled = nav.i === 0; $('#nbNext').disabled = false;
  // time left from the start of this leg
  const left = Math.max(1, Math.ceil((routeTotal - L.d0) / M_PER_MIN) + (L.change && L.change.lift ? 1 : 0));
  $('#nvMins').textContent = `${left} min`;
  $('#nvSub').textContent = `${clock(Date.now() + left * 60000)} arrival · ${meters(routeTotal - L.d0)} m`;
  // frame this leg, on the floor you start it on
  const pts = routePts.slice(L.ia, L.ib + 1);
  setFloor(levelOf(routeNodes[L.ia]), true);
  if (!following) fitItems(pts.length > 1 ? pts : [routePts[L.ia], routePts[L.ib]], 30, 3.6);   // when following, the camera stays with you
}
$('#nbMain').addEventListener('click', e => { const n = e.target.closest('.nb-n'); if (n) n.classList.toggle('open'); });
$('#nbNext').onclick = () => { if (nav) { buzz(5); showLeg(nav.i + 1, 1); } };
$('#nbPrev').onclick = () => { if (nav) { buzz(5); showLeg(nav.i - 1, -1); } };
$('#nvEnd').onclick = () => endNav();
{ // swipe the banner sideways to change step
  let sx = null;
  $('#navBanner').addEventListener('pointerdown', e => { sx = e.clientX; });
  $('#navBanner').addEventListener('pointerup', e => {
    if (sx == null || !nav) return; const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 50) dx < 0 ? $('#nbNext').click() : (!$('#nbPrev').disabled && $('#nbPrev').click());
  });
}
// with location on, move to the next step as you reach each one
function navFix(p) {
  if (!nav || nav.i >= nav.legs.length) return;
  const L = nav.legs[nav.i], target = NODE[L.step.node];
  if (target && Math.hypot(p.x - target.x, p.y - target.y) < Math.max(12, Math.min(25, (me && me.acc) || 15))) showLeg(nav.i + 1, 1);
}

// ---------- Directions ----------
function buildOptions(sel, includeLandside = true, gatesOnly = false) {
  sel.innerHTML = '';
  const group = (label, list) => {
    if (!list.length) return;
    const og = document.createElement('optgroup'); og.label = label;
    for (const it of list) { const o = document.createElement('option'); o.value = it.id; o.textContent = it.label || it.name; og.appendChild(o); }
    sel.appendChild(og);
  };
  const all = Object.values(ITEMS);
  if (includeLandside && !gatesOnly) group('Arrive & depart', all.filter(i => i.kind === 'place'));
  const gnum = g => gnumOf(g.code);
  for (const con of CONS) group(`Concourse ${con} gates`, all.filter(i => i.kind === 'gate' && i.con === con).sort((a, b) => gnum(a) - gnum(b)));
  if (gatesOnly) return;
  for (const [cat, c] of Object.entries(CATS)) {
    const list = all.filter(i => i.kind === 'amen' && i.cat === cat && (includeLandside || i.zone !== 'L'))
      .map(i => ({ ...i, label: `${i.name} · ${i.gate ? i.gate : i.zone === 'L' ? 'landside' : 'main terminal'}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    group(c.label, list);
  }
}
buildOptions($('#from')); buildOptions($('#to'));
for (const sel of [$('#from'), $('#to')]) {
  const o = document.createElement('option'); o.value = 'v:me'; o.textContent = 'My location';
  sel.insertBefore(o, sel.firstChild);
}
{ const o = document.createElement('option'); o.value = ''; o.textContent = 'Choose a destination'; $('#to').insertBefore(o, $('#to').firstChild); }
$('#from').value = AP.ui.defaults.from; $('#to').value = AP.ui.defaults.to;

// The step list: a line of stops with the distance of each leg, floor changes marked,
// and the places you pass as tappable chips
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
function renderSteps(steps, passed) {
  curSteps = steps;
  const legs = buildLegs();
  if (nav) { nav.legs = legs; showLeg(Math.min(nav.i, nav.legs.length - 1), 0); }
  $('#steps').innerHTML = steps.map((s, i) => {
    const L = i ? legs[i - 1] : null, d = L ? Math.max(5, Math.round((L.d1 - L.d0) / 5) * 5) : 0;
    const ch = L && L.change;
    const ride = L && s.alight;   // a ride on the train: its time, not a walking distance
    const meta = !L ? '' : ride ? `<span class="leg"><b>${icon('train')}${Math.max(1, Math.round((L.d1 - L.d0) / M_PER_MIN / TRAIN_SPEED + 1))} min</b>ride</span>`
      : `<span class="leg"><b>${ch ? icon(ch.lift ? 'lift' : 'swap') : ''}${Math.max(1, Math.round(d / M_PER_MIN))} min</b>${d} m</span>`;
    const lvl = ch ? `<span class="lvl">${ch.down ? 'Lower level' : 'Upper level'}</span>` : '';
    return `<li class="${s.end ? 'end' : ''}${i === 0 ? ' start' : ''}${ch ? ' change' : ''}" data-node="${esc(s.node)}" tabindex="0" role="button"><span class="stop"></span><span class="body"><span class="t">${esc(s.t.replace(/\s*\((upper|lower) level\)$/, ''))}</span>${lvl}${s.n && s.n !== 'Start' ? `<span class="n">${esc(s.n)}</span>` : ''}</span>${meta}</li>`;
  }).join('')
    + (passed.length ? `<li class="passing"><span class="pl">On the way</span><span class="pass-chips">${passed.map(p => `<button class="tag pass" data-pass="${p.id}"><span class="tile ${p.cat}">${icon(p.icon || p.cat)}</span>${esc(p.name)}</button>`).join('')}</span></li>` : '');
  $('#steps').querySelectorAll('[data-node]').forEach(li => {
    const go = () => {
      const p = NODE[li.dataset.node]; if (!p) return;
      setFloor(levelOf(li.dataset.node), true);
      buzz(5); userMoved = true;
      if (!wide() && detent === 'full') setDetent('half');
      fitBox(p.x - 45, p.y - 45, p.x + 45, p.y + 45, 10, 3.6);
    };
    li.onclick = go;
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  $('#steps').querySelectorAll('[data-pass]').forEach(b => b.onclick = e => { e.stopPropagation(); buzz(5); showPlace(ITEMS[b.dataset.pass], false); });
}
function describe(path, a, b) {
  const steps = [{ t: a.name, n: 'Start', node: nodeOf(a) }];
  const crossesSecurity = path.some((n, i) => i && SEC_EDGE.has(path[i - 1] + '|' + n));
  let lastLabel = a.kind === 'place' ? a.node : null;
  const passed = [], via = [];
  const kindAt = i => EDGE_KIND[path[i] + '|' + path[i + 1]];
  for (let i = 1; i < path.length - 1; i++) {
    const n = path[i];
    // on a train: skip the stops you ride through, and say where to get off
    const riding = kindAt(i - 1) === 'train', boarding = kindAt(i) === 'train';
    if (riding && boarding) continue;
    if (boarding) {
      let j = i; while (kindAt(j) === 'train') j++;
      const to = V[path[j]][2].replace(/^.*· /, ''), stops = path.slice(i + 1, j + 1).filter(x => V[x] && V[x][2]).length;   // (track waypoints aren't stops)
      steps.push({ t: V[n][2], n: `Ride ${stops} stop${stops > 1 ? 's' : ''} to ${to}. ${/bus/i.test(V[n][2]) ? 'Buses come every 10 minutes or so.' : 'Trains come every 2 minutes or so.'}`, node: n, train: true });
      lastLabel = n; continue;
    }
    if (riding) {
      // up to the gates, or on along the lower level (to baggage claim)
      let j = i + 1; while (j < path.length - 1 && !(V[path[j]] && V[path[j]][2])) j++;
      const up = levelOf(path[j]) === 'up';
      const toGates = AP.ui.trainToGates || 'up';   // (DFW's Skylink runs above the gates)
      steps.push({ t: 'Get off at ' + V[n][2].replace(/^.*· /, ''), n: up ? (stepFree ? `Take the elevator ${toGates} to the gates` : `Take the escalators ${toGates} to the gates`) : 'Follow the signs to ' + V[path[j]][2].replace(/^Exit to /, '').replace(/^(?!Terminal )\w/, c => c.toLowerCase()), node: n, alight: true });
      lastLabel = n; continue;
    }
    if (V[n] && V[n][2] && n !== lastLabel) {
      const ride = k => kindAt(k) === 'esc' || kindAt(k) === 'lift';
      // escalator landings are steps only where you ride them, and the ride is one step, not two
      if (/escalators/i.test(V[n][2]) && !ride(i) && !ride(i - 1)) continue;
      if (ride(i - 1) && steps.length && steps[steps.length - 1].node === path[i - 1]) { lastLabel = n; continue; }
      let note = '';
      if (isChk('v:' + n) && crossesSecurity) note = SEC_EDGE.has(n + '|' + path[i + 1]) ? (lastLabel && levelOf(lastLabel) === 'lo' ? 'Take the escalators up, screen through TSA, then continue straight ahead' : 'Screen through TSA, then continue straight ahead') : 'Leave through the exit lane';
      if (kindAt(i) === 'esc') note = levelOf(path[i + 1]) === 'lo' ? 'Take the escalator down a level' : 'Take the escalator up a level';
      else if (kindAt(i - 1) === 'esc') note = levelOf(n) === 'lo' ? 'Lower level' : 'Upper level';
      const extra = AP.ui.stepNote(n, path, i);
      if (extra) note = extra;
      else if (n.startsWith('lift_')) note = levelOf(path[i + 1]) === 'lo' ? 'Take the elevator down to the lower level' : 'Take the elevator up to the upper level';
      steps.push({ t: V[n][2], n: note, node: n }); lastLabel = n;
      if (!n.startsWith('lift_')) via.push(V[n][2].replace(/^Main terminal, past security$/, 'Main terminal').replace(/^Main terminal food court$/, 'Food court').replace(/ \((upper|lower) level\)/, ''));
    }
    if (n.startsWith('p:m:')) {
      const am = ITEMS[n.slice(2)];
      if (am && am !== b && !['rest', 'service'].includes(am.cat) && !/vending/i.test(am.name) && !passed.some(x => x.name === am.name)) passed.push(am);
    }
  }
  let endNote = '';
  if (b.kind === 'gate') endNote = b.zone === 'R' ? 'In the rotunda' : 'Watch the overhead gate numbers';
  if (b.kind === 'gate' && AP.ui.gateNote) endNote = AP.ui.gateNote(b) || endNote;
  else if (b.kind === 'amen') endNote = b.near;
  steps.push({ t: b.name, n: endNote, end: true, node: nodeOf(b) });
  return { steps, passed: passed.slice(0, 5), via };
}
function highlight(ids) {
  svg.classList.add('focusing');
  for (const m of markers) m.classList.remove('hl');
  for (const id of ids) if (ITEMS[id]) ITEMS[id].el.classList.add('hl');
  cullLabels();
}
// a from/to route someone asked for (a place card, an idea, an airline): show it in Depart mode, since
// Arrive and Connect draw their own routes
function routeNow() { if (mode !== 'dep') setMode('dep', true); updateRoute(true); saveTrip(); }
function updateRoute(fit) {
  if (mode === 'arr') return updateArrival(fit);
  if (mode === 'con') return updateConnection(fit);
  for (const sel of [$('#from'), $('#to')]) if (sel.value === 'v:me' && !ITEMS['v:me']) {
    // no fix yet: ask for location and route once it arrives
    if (watchId == null) startLocating();
    toast('Finding you… the route will start from your location.');
    sel.value = sel.id === 'from' ? AP.ui.defaults.from : AP.ui.defaults.to;
    pendingMe = sel.id;
  }
  const a = ITEMS[$('#from').value], b = ITEMS[$('#to').value];
  if (!b) {
    // no destination: plain exploring, nothing dimmed
    $('#hero').className = 'hero empty';
    $('#hero').innerHTML = `<span class="m1">Where to?</span><span class="m2">Tap a gate or place on the map, search, or pick the nearest below.</span>`;
    $('#steps').innerHTML = ''; setRoute([]);
    svg.classList.remove('focusing'); for (const m of markers) m.classList.remove('hl');
    cullLabels(); return;
  }
  if (a === b) {
    $('#hero').className = 'hero same';
    $('#hero').innerHTML = `<span class="num">0<small>min</small></span><span class="m1">You’re already there</span><span class="m2">Pick a different destination</span>`;
    $('#steps').innerHTML = ''; setRoute([]); return;
  }
  const { path, units, len, lift } = route(a, b);
  setRoute(path, minutes(units));
  const { steps, passed, via } = describe(path, a, b);
  // going through security: add the live wait, and say it on the checkpoint step
  const inbound = path.some((n, i) => isChk('v:' + n) && SEC_EDGE.has(n + '|' + path[i + 1])), sec = inbound ? waitMin() : null;
  if (sec != null) { const s = steps.find(x => isChk('v:' + x.node)); if (s) s.n = `Security wait about ${sec} min right now${s.n && s.n !== 'Start' ? '. ' + s.n : ''}`; }
  // screening at a checkpoint that hasn't opened yet (overnight): say when, and count the wait
  const shut = inbound ? path.find((n, i) => isChk('v:' + n) && SEC_EDGE.has(n + '|' + path[i + 1]) && !chkOpen(n)) : null;
  const shutC = shut && (AP.CHECKPOINTS || {})[shut], opensIn = shutC && shutC.open ? untilOpen(shutC.open) : null;
  if (opensIn != null) { const s = steps.find(x => x.node === shut); if (s) s.n = `Opens at ${fmt12(shutC.open)}; the line forms before then. ${s.n || ''}`.trim(); }
  const total = minutes(units) + (opensIn != null ? Math.max(opensIn, sec || 0) : sec || 0);
  $('#hero').className = 'hero';
  $('#hero').innerHTML = `<button class="hero-x" id="clearRoute" aria-label="Clear route">${icon('x')}</button><span class="num">${total}<small>min</small></span>
    <span class="m1">${meters(len)} m walk${lift ? ' · elevator' : ''}${opensIn != null ? ` · security opens ${fmt12(shutC.open)}` : sec != null ? ` + ~${sec} min security` : ''}</span>
    <span class="m2">Arrive ${clock(Date.now() + total * 60000)}${via.length ? ' via ' + listJoin(via.slice(0, 3).map(esc)) : ''}</span>
    <button class="go" data-go>${icon('walk')}Go</button>`;
  renderSteps(steps, passed);
  $('#clearRoute').onclick = () => { buzz(5); $('#to').value = ''; updateRoute(false); saveTrip(); };
  const ids = [a.id, b.id];
  for (const n of path) { if (ITEMS[n]) ids.push(n); if (n.startsWith('p:') && ITEMS[n.slice(2)]) ids.push(n.slice(2)); }
  highlight(ids);
  if (fit) { setFloor(levelOf(path[0]), true); fitItems(path.map(n => NODE[n]), 24, 3.5); }
}
$('#from').onchange = $('#to').onchange = () => updateRoute(true);

// ---------- Step-free routing ----------
function setStepFree(on, quiet) {
  stepFree = on; $('#stepFree').checked = on; $('#sfNote').hidden = !on;
  if (!quiet) { buzz(5); updateRoute(true); saveTrip(); cullLabels(); }
}
$('#stepFree').addEventListener('change', e => setStepFree(e.target.checked));

// ---------- Arrivals: gate → exit → baggage claim → your ride ----------
let mode = 'dep';
const ARR_DEST = AP.ui.arrivals;
const BAG_WAIT = 20;   // typical minutes from landing until bags are out
buildOptions($('#arrGate'), false, true);
$('#arrGate').value = AP.ui.defaults.arrGate;
$('#arrDest').innerHTML = ARR_DEST.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');
function updateArrival(fit) {
  // at an airport with a baggage claim and curb per terminal (DFW), use the ones where you land
  // (a pickup at your terminal: its baggage claim; a fixed place like a train station: the baggage claim
  // nearest it, so you ride the train between terminals before leaving security)
  // (checked bags come out at the terminal you land at; without them, ride between terminals first)
  const gate = ITEMS[$('#arrGate').value], pick = ITEMS[$('#arrDest').value], local = !!(AP.ui.nearest || {})[pick.id.slice(2)];
  const bag = nearestOf('v:' + ROLE.baggage, local || $('#arrBags').checked ? gate : pick), dest = nearestOf(pick.id, bag);
  const bags = $('#arrBags').checked, car = parseInt($('#arrCarousel').value, 10);
  $('#carRow').hidden = !bags;
  // a known carousel: walk to it rather than to the middle of baggage claim
  const carIt = bags && car > 0 ? CAROUSEL[car] : null, carNode = carIt ? carIt.id : null;
  const mid = carIt || bag;
  const toBag = dest.id === bag.id;
  const p1 = route(gate, mid), p2 = toBag && carNode ? { path: [carNode], units: 0, len: 0 } : route(mid, dest);
  const path = p1.path.concat(p2.path.slice(1)), units = p1.units + p2.units, len = p1.len + p2.len;
  setRoute(path, minutes(units));
  for (const [n, c] of Object.entries(CAROUSEL)) c.el.classList.toggle('mine', !!carNode && +n === car);
  const { steps, passed } = describe(path, gate, dest);
  if (carNode) {
    const ci = path.indexOf(carNode), carStep = { t: 'Carousel ' + car, n: 'Bags usually arrive 15–25 min after landing.', node: carNode };
    // your carousel stands in for "Baggage claim" along the way
    for (let j = steps.length - 2; j > 0; j--) if (steps[j].node === bag.node) steps.splice(j, 1);
    if (toBag) Object.assign(steps[steps.length - 1], { t: 'Baggage claim · carousel ' + car, node: carNode });
    else { let k = steps.findIndex((s, j) => j && path.indexOf(s.node) > ci); if (k < 0) k = steps.length - 1; steps.splice(k, 0, carStep); }
  }
  for (const s of steps) {
    if (isChk('v:' + s.node)) { s.t = 'Exit lane by ' + (/^TSA checkpoint /.test(V[s.node][2]) ? '' : 'the ') + V[s.node][2].replace(/^TSA /, ''); s.n = (stepFree ? '' : 'Then take the escalators down to baggage claim. ') + 'Once you’re through, you can’t go back to the gates.'; }
    if (s.node === bag.node && !s.end && !carNode) {
      s.n = !bags ? 'No bags? Walk straight through.'
        : car > 0 ? `Carousel ${car}. Bags usually arrive 15–25 min after landing.`
        : 'Your carousel is on the arrival screens by the escalators. Bags usually arrive 15–25 min after landing.';
    }
  }
  const info = ARR_DEST.find(x => x[0] === pick.id);
  if (steps.length && info) steps[steps.length - 1].n = info[2];
  if (toBag) { const last = steps[steps.length - 1]; last.n = bags ? (car > 0 ? (carNode ? 'Bags usually arrive 15–25 min after landing. ' : `Carousel ${car}. `) : '') + info[2] : info[2]; }
  const walk = minutes(units), total = walk + (bags ? BAG_WAIT : 0);
  $('#hero').className = 'hero';
  $('#hero').innerHTML = `<span class="num">${total}<small>min</small></span>
    <span class="m1">${meters(len)} m walk${p1.lift || p2.lift ? ' · elevator' : ''}${bags ? ` + ~${BAG_WAIT} min for bags` : ''}</span>
    <span class="m2">${esc(gate.name)} to ${esc(info ? info[1] : dest.name)}</span>
    <button class="go" data-go>${icon('walk')}Go</button>`;
  renderSteps(steps, passed);
  const ids = [gate.id, dest.id, bag.id];
  for (const n of path) { if (ITEMS[n]) ids.push(n); if (n.startsWith('p:') && ITEMS[n.slice(2)]) ids.push(n.slice(2)); }
  highlight(ids);
  if (fit) { setFloor(levelOf(path[0]), true); fitItems(path.map(n => NODE[n]), 24, 3.5); }
}
// ---------- Connecting: the gate you land at → the gate your next flight leaves from ----------
// How much time you'll have: from landing, allow a few minutes to get off the plane (and an hour for
// passport control, customs and screening again after an international flight), then the walk and any
// train ride; what's left before boarding starts is time to spare.
const DEPLANE = 10, CUSTOMS = 60, DOORS_CLOSE = 15;   // minutes; doors usually close 15 min before departure
buildOptions($('#conArr'), false, true); buildOptions($('#conDep'), false, true);
$('#conArr').value = AP.ui.defaults.arrGate; $('#conDep').value = AP.ui.defaults.gate;
const hhmm = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0');
const minOf = v => /^\d{1,2}:\d{2}/.test(v || '') ? toMin(v) : null;
// an airport-local time of day → the moment it most likely means (from 3 hours ago to 21 hours ahead)
const atLocal = m => Date.now() + ((((m - cleNow().min) % 1440) + 1440 + 180) % 1440 - 180) * 60000;
function conTimes() {
  // until you set them: landing in the next few minutes, departing 75 minutes later
  if (!$('#conLand').value && !$('#conTime').value) { const n = Math.ceil(cleNow().min / 5) * 5; $('#conLand').value = hhmm(n); $('#conTime').value = hhmm(n + 75); }
  const land = minOf($('#conLand').value), dep = minOf($('#conTime').value);
  if (land == null || dep == null) return null;
  const layover = ((dep - land) % 1440 + 1440) % 1440, landAt = atLocal(land);
  return { layover, landAt, depAt: landAt + layover * 60000 };
}
function updateConnection(fit) {
  const a = ITEMS[$('#conArr').value], b = ITEMS[$('#conDep').value], intl = $('#conIntl').checked, t = conTimes();
  if (!a || !b || !t) return;
  const same = a === b, r = same ? { path: [nodeOf(a)], units: 0, len: 0, lift: false, train: false } : route(a, b);
  setRoute(same ? [] : r.path, minutes(r.units));
  const walk = same ? 0 : minutes(r.units), need = DEPLANE + (intl ? CUSTOMS : 0) + walk;
  const toBoard = t.layover - BOARD_BEFORE, spare = toBoard - need, toDoors = t.layover - DOORS_CLOSE;
  const [cls, verdict, advice] =
      spare >= 30 ? ['ok', 'Plenty of time', 'Time to eat or sit down before boarding.']
    : spare >= 10 ? ['ok', 'Good connection', 'Time to grab something on the way.']
    : spare >= 0 ? ['warn', 'Tight', 'Head straight to your gate.']
    : need <= toDoors ? ['warn', 'Very tight', 'You’ll get there after boarding starts, before the doors close. Go straight there.']
    : ['no', 'At risk', 'You may miss it. As soon as you land, check your airline’s app or ask at the gate; they can rebook you.'];
  // the Pass Time tab follows your next flight
  $('#ktGate').value = b.id; boardAt = t.depAt - BOARD_BEFORE * 60000; updateClock();
  let steps = [], passed = [];
  if (!same) ({ steps, passed } = describe(r.path, a, b));
  else steps = [{ t: b.name, n: 'Your next flight leaves from the same gate.', end: true, node: nodeOf(b) }];
  steps[0].n = intl
    ? 'Off the plane (about 10 min), then passport control, customs and re-checking your bags, then security again (about an hour). Follow the signs for connecting flights.'
    : 'Allow about 10 minutes to get off the plane. You stay past security.';
  $('#hero').className = 'hero';
  $('#hero').innerHTML = `<span class="num">${Math.abs(spare)}<small>min</small></span>
    <span class="m1">${spare >= 0 ? 'to spare' : 'short'} · ${esc(verdict)}</span>
    <span class="m2">${walk} min ${r.train ? 'by train and on foot' : 'walk'}${intl ? ' + customs' : ''} · boarding about ${clock(t.depAt - BOARD_BEFORE * 60000)}</span>
    ${same ? '' : `<button class="go" data-go>${icon('walk')}Go</button>`}`;
  renderSteps(steps, passed);
  // somewhere to eat, a coffee and a restroom near your next gate, when there's time for them
  let near = [];
  if (spare >= 15) {
    const { D } = fromSrc(nodeOf(b));
    for (const cat of ['food', 'coffee', 'rest']) {
      let best = null;
      for (const it of Object.values(ITEMS)) {
        if (it.kind !== 'amen' || it.cat !== cat || /vending/i.test(it.name) || D[it.id] == null || D[it.id] > 300) continue;
        if ((hoursStatus(it) || {}).state === 'closed') continue;
        if (!best || D[it.id] < D[best.id]) best = it;
      }
      if (best) near.push(best);
    }
  }
  $('#steps').insertAdjacentHTML('afterbegin', `<li class="passing con-head"><span class="status ${cls}">${esc(verdict)}</span><span class="n">${esc(advice)}</span></li>`);
  if (near.length) $('#steps').insertAdjacentHTML('beforeend', `<li class="passing"><span class="pl">Near ${esc(b.name.replace(/^Gate /, 'gate '))}</span><span class="pass-chips">${near.map(p => `<button class="tag pass" data-pass="${p.id}"><span class="tile ${p.cat}">${icon(p.icon || p.cat)}</span>${esc(p.name)}</button>`).join('')}</span></li>`);
  $('#steps').querySelectorAll('.con-head ~ li [data-pass], .con-head ~ li[data-pass]').forEach(x => x.onclick = e => { e.stopPropagation(); buzz(5); showPlace(ITEMS[x.dataset.pass], false); });
  const ids = [a.id, b.id, ...near.map(x => x.id)];
  for (const n of r.path) { if (ITEMS[n]) ids.push(n); if (n.startsWith('p:') && ITEMS[n.slice(2)]) ids.push(n.slice(2)); }
  highlight(ids);
  if (fit) { setFloor(levelOf(r.path[0]), true); if (same) fitBox(NODE[nodeOf(b)].x - 60, NODE[nodeOf(b)].y - 60, NODE[nodeOf(b)].x + 60, NODE[nodeOf(b)].y + 60, 10, 3.4); else fitItems(r.path.map(n => NODE[n]), 24, 3.5); }
}
for (const id of ['conArr', 'conDep', 'conLand', 'conTime', 'conIntl']) $('#' + id).addEventListener('change', () => { buzz(5); updateConnection(id === 'conArr' || id === 'conDep'); saveTrip(); });

function setMode(m, quiet) {
  mode = m;
  document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#modeSw').style.setProperty('--i', { dep: 0, arr: 1, con: 2 }[m]);
  const arr = m === 'arr', con = m === 'con';
  $('#arrForm').hidden = !arr; $('#flightArr').hidden = !arr;
  $('#conForm').hidden = !con; $('#flightCon').hidden = !con;
  document.querySelector('#pane-dir .fromto').hidden = arr || con;
  $('#quick').hidden = arr || con;
  if (tab === 'dir' && !placeMode) $('#title').textContent = arr ? 'Arrivals' : con ? 'Connecting' : TAB_TITLES.dir;
  if (!quiet) { buzz(5); replay($('#pane-dir')); if (!wide()) setDetent('peek'); }
  updateRoute(!quiet);
  if (!quiet) saveTrip();
}
document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.onclick = () => { if (mode !== b.dataset.mode) setMode(b.dataset.mode); });
for (const id of ['arrGate', 'arrDest', 'arrBags', 'arrCarousel']) $('#' + id).addEventListener('change', () => { updateArrival(id !== 'arrCarousel' && id !== 'arrBags'); saveTrip(); });
$('#arrCarousel').addEventListener('input', () => updateArrival(false));

$('#swap').onclick = () => {
  const f = $('#from').value; $('#from').value = $('#to').value; $('#to').value = f;
  $('#swap').classList.toggle('spin'); buzz(); updateRoute(false);
};

// ---------- Opening hours ----------
// Status is worked out in the airport's local time, wherever the phone is
const CLE_TZ = AP.tz;
function cleNow(t = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CLE_TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), min: (+parts.hour % 24) * 60 + +parts.minute };
}
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt12 = s => { const [h, m] = s.split(':').map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const LATE = 21 * 60;   // after 9 PM, places with no published closing time may be closing
function hoursStatus(it, t) {
  const h = it.hours; if (!h) return null;
  if (h.h24) return { state: 'open', text: 'Open 24 hours' };
  if (h.vary) return { state: 'unknown', text: 'Hours vary' };
  const at = cleNow(t);
  if (h.days && !h.days.includes(at.dow)) return { state: 'closed', text: 'Closed today' };
  if (at.min < toMin(h.open)) return { state: 'closed', text: 'Opens ' + fmt12(h.open) };
  if (h.close) return at.min < toMin(h.close) ? { state: 'open', text: 'Open until ' + fmt12(h.close) } : { state: 'closed', text: 'Closed for the day' };
  if (at.min >= LATE) return { state: 'late', text: `Opened ${fmt12(h.open)} · may be closing` };
  return { state: 'open', text: 'Open since ' + fmt12(h.open) };
}
function hoursLine(it) {
  const h = it.hours; if (!h) return null;
  if (h.h24) return 'Open 24 hours, every day';
  if (h.vary) return 'Hours vary';
  const days = !h.days ? 'Daily' : h.days.length === 5 ? 'Monday–Friday' : h.days.length === 6 && !h.days.includes(0) ? 'Monday–Saturday (closed Sunday)' : 'Some days';
  return `${days} from ${fmt12(h.open)}` + (h.close ? ` to ${fmt12(h.close)}` : '');
}
// grey out places that are closed right now; refreshed every minute
function markClosed() {
  for (const it of Object.values(ITEMS)) if (it.kind === 'amen' && it.el) {
    const s = hoursStatus(it); it.el.classList.toggle('closed', !!s && s.state === 'closed');
  }
}
markClosed(); setInterval(markClosed, 60000);

// ---------- Go to the nearest… ----------
const QUICK = [
  ['rest', 'Restroom', 'rest', i => i.cat === 'rest' && (!stepFree || /Accessible/.test(i.name))],
  ['coffee', 'Coffee', 'coffee', i => i.cat === 'coffee' && !/vending/i.test(i.name)],
  ['food', 'Food', 'food', i => i.cat === 'food' && !/vending/i.test(i.name)],
  ['bar', 'Bar', 'bar', i => i.cat === 'bar'],
  ['charge', 'Charging', 'service', i => /FuelRod/.test(i.name)],
  ['gate', 'My gate', 'gate'],
];
function goNearest(key) {
  const q = QUICK.find(x => x[0] === key); if (!q) return;
  if (ITEMS['v:me']) $('#from').value = 'v:me';           // start from you when we know where you are
  const from = ITEMS[$('#from').value];
  let best = null;
  if (key === 'gate') best = ITEMS[$('#ktGate').value];
  else {
    const { D } = fromSrc(nodeOf(from));
    const pick = skipClosed => { let b = null; for (const it of Object.values(ITEMS)) {
      if (it.kind !== 'amen' || !q[3](it) || D[it.id] == null) continue;
      if (skipClosed && (hoursStatus(it) || {}).state === 'closed') continue;
      if (!b || D[it.id] < D[b.id]) b = it; } return b; };
    best = pick(true) || pick(false);
  }
  if (!best) return;
  buzz();
  if (mode !== 'dep') setMode('dep', true);
  if (tab !== 'dir' || placeMode) setTab('dir', true);
  $('#to').value = best.id;
  if (!wide()) setDetent('peek');
  updateRoute(true); saveTrip();
  const where = best.gate ? 'near gate ' + best.gate : best.zone === 'L' ? 'before security' : 'in the main terminal';
  const mins = minutes(route(from, best).units);
  if (key === 'rest') toast(stepFree ? `Nearest accessible restroom is ${where}, ${mins} min away.` : `Nearest restrooms are ${where}, ${mins} min away.`);
  else if (key !== 'gate') toast(`Nearest ${q[1].toLowerCase()}: ${best.name}, ${where} (${mins} min).`);
}
$('#quick').innerHTML = QUICK.map(([k, label, ico]) =>
  `<button class="chip" data-q="${k}"><span class="tile ${ico === 'gate' ? 'gate' : ico}">${icon(ico)}</span>${label}</button>`).join('');
$('#quick').querySelectorAll('[data-q]').forEach(b => b.onclick = () => goNearest(b.dataset.q));
// Android home-screen shortcuts and links: #restroom, #coffee, #food, #gate
const ACTIONS = { restroom: 'rest', coffee: 'coffee', food: 'food', bar: 'bar', charging: 'charge', gate: 'gate' };
window.cleAction = name => { if (ACTIONS[name]) goNearest(ACTIONS[name]); };

// ---------- Pass the time ----------
buildOptions($('#ktGate'), false, true);
$('#ktGate').value = AP.ui.defaults.gate;
let ktCat = 'all', lastIdeas = [];
const ktCats = $('#ktCats');
for (const [cat, label] of [['all', 'Everything'], ...Object.entries(CATS).filter(([c]) => c !== 'rest').map(([c, v]) => [c, v.label])]) {
  const b = document.createElement('button');
  b.className = 'chip'; b.dataset.cat = cat; b.setAttribute('aria-pressed', String(cat === 'all'));
  b.innerHTML = (cat === 'all' ? '' : `<span class="tile ${cat}">${icon(cat)}</span>`) + label;
  if (cat === 'all') b.style.paddingLeft = '14px';
  b.onclick = () => {
    ktCat = cat; buzz(5);
    ktCats.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    updateIdeas();
  };
  ktCats.appendChild(b);
}
// Boarding is kept as a clock time, so "55 min" counts down instead of resetting each launch
let boardAt = Date.now() + 55 * 60000, reminderAt = 0;
// times are shown in the airport's time zone, like the boards and your boarding pass
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: AP.tz });
const minsLeft = () => Math.max(0, Math.round((boardAt - Date.now()) / 60000));
function leavePlan() {
  // walk from where you are (or the Directions start) to your gate, plus 5 minutes' slack
  const gate = ITEMS[$('#ktGate').value], from = ITEMS['v:me'] || ITEMS[$('#from').value];
  const walk = from && from !== gate ? minutes(route(from, gate).units) : 0;
  const sec = from && (from.zone === 'L' || isChk(from.id)) && gate.zone !== 'L' && typeof waitMin === 'function' ? waitMin() || 0 : 0;
  return { gate, from, walk, sec, at: boardAt - (walk + sec + 5) * 60000 };
}
// Home-screen widget (Android): gate, boarding, leave-by and walk, sent whenever they change
let widgetSent = '';
function pushWidget() {
  if (!(window.CLEApp && CLEApp.updateWidget)) return;
  const p = leavePlan(), f = typeof live !== 'undefined' && live.flight && flightSide(live.flight) === 'departure' ? live.flight : null;
  const data = JSON.stringify({ code: AP.code, airport: AP.short, tz: AP.tz, gate: p.gate ? p.gate.code : '', board: Math.round(boardAt),
    leave: Math.round(p.at), walk: p.walk + (p.sec || 0), flight: f ? f.flight : '', status: f ? flightStatus(f, 'departure')[1] : '' });
  if (data === widgetSent) return;
  widgetSent = data;
  try { CLEApp.updateWidget(data); } catch (e) {}
}
// which checkpoints are open right now, from their posted hours at the airport's local time
const hm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const ampm = t => { const [h, m] = t.split(':').map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// minutes from now until a checkpoint's opening time (airport time)
function untilOpen(open) { return ((hm(open) - cleNow().min) % 1440 + 1440) % 1440; }
function chkOpen(id, t = Date.now()) {
  const c = (AP.CHECKPOINTS || {})[id]; if (!c) return true; if (c.busy) return false; if (!c.open) return true;   // no published hours
  const [H, M] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: AP.tz }).format(t).split(':').map(Number);
  const now = H * 60 + M; return now >= hm(c.open) && now < hm(c.close);
}
let closedKey = null;
function updateCheckpoints() {
  if (!AP.CHECKPOINTS) return;
  const ids = Object.keys(AP.CHECKPOINTS), closed = ids.filter(id => !chkOpen(id));
  // all closed overnight: route through the main one anyway (its line forms before it opens)
  const set = closed.length === ids.length ? closed.filter(id => id !== ROLE.checkpoint) : closed;
  const key = set.join();
  if (key === closedKey) return;
  closedKey = key; closedNodes = new Set(set);
  if (committed && tab === 'dir' && !placeMode) updateRoute(false);
}
updateCheckpoints(); setInterval(updateCheckpoints, 60000);
function updateClock() {
  $('#ktClock').textContent = 'Boarding at about ' + clock(boardAt);
  const p = leavePlan();
  const where = p.from && p.from.id === 'v:me' ? 'from where you are' : p.from ? 'from ' + p.from.name : '';
  $('#ktLeave').innerHTML = (p.at <= Date.now() ? `Head to ${esc(p.gate.name)} <b>now</b>` : `Head to ${esc(p.gate.name)} by <b>${clock(p.at)}</b>`)
    + `<small>${p.walk} min walk ${esc(where)}${p.sec ? ` + ~${p.sec} min security` : ''}</small>`;
  const rb = $('#remind');
  rb.hidden = !(window.CLEApp && CLEApp.scheduleReminder);
  const on = reminderAt > Date.now();
  rb.setAttribute('aria-pressed', String(on));
  rb.querySelector('span').textContent = on ? `Reminder at ${clock(reminderAt)} · Cancel` : 'Remind me when to leave';
  pushWidget();
}
setInterval(() => { if (!$('#pane-kill').hidden) updateIdeas(); }, 30000);
$('#remind').onclick = () => {
  buzz();
  if (reminderAt > Date.now()) {
    try { CLEApp.cancelReminder(); } catch (e) {}
    reminderAt = 0; toast('Reminder cancelled.');
  } else {
    const p = leavePlan();
    if (p.at <= Date.now() + 60000) { toast(`It’s time to head to ${p.gate.name} now.`); return; }
    try {
      CLEApp.scheduleReminder(p.at, `Time to head to ${p.gate.name}`, `Boarding starts around ${clock(boardAt)}. It’s about a ${p.walk}-minute walk.`);
      reminderAt = p.at; toast(`We’ll remind you at ${clock(p.at)}.`);
    } catch (e) { toast('Couldn’t set a reminder on this device.'); }
  }
  saveTrip(); updateClock();
};
let ideasOpen = false, okOpen = false;
const minor = it => /vending|FuelRod|Lottery|charging/i.test(it.name) ? 1 : 0;
function updateIdeas() {
  const gate = ITEMS[$('#ktGate').value], range = $('#ktMin'), mins = minsLeft();
  range.value = Math.min(+range.max, Math.max(+range.min, mins));
  $('#ktOut').innerHTML = mins >= 60 ? `${Math.floor(mins / 60)}<small>h</small> ${mins % 60}<small>min</small>` : `${mins}<small>min</small>`;
  updateClock();
  range.style.setProperty('--p', ((+range.value - range.min) / (range.max - range.min) * 100) + '%');
  const { D } = fromSrc(nodeOf(gate));
  const seen = new Set();
  const order = { ok: 0, warn: 1, no: 2 };
  const list = Object.values(ITEMS)
    .filter(i => i.kind === 'amen' && i.zone !== 'L' && i.zone !== 'LIFT' && i.cat !== 'rest' && !/^Water fountain/.test(i.name) && (ktCat === 'all' || i.cat === ktCat))
    .map(i => {
      const walk = minutes(D[i.id]), spare = mins - 10 - walk * 2 - i.dwell, hs = hoursStatus(i);
      let status = spare >= 5 ? 'ok' : spare >= 0 ? 'warn' : 'no', why = null;
      if (hs && hs.state === 'closed') { status = 'no'; why = hs.text.replace('Closed for the day', 'Closed'); }
      else if (hs && hs.state === 'late' && status === 'ok') { status = 'warn'; why = 'May close'; }
      return { i, walk, spare, status, why };
    })
    // real places before vending machines, lottery and charging spots, then the closest
    .sort((p, q) => order[p.status] - order[q.status] || minor(p.i) - minor(q.i) || p.walk - q.walk)
    .filter(r => !seen.has(r.i.name) && seen.add(r.i.name));
  lastIdeas = list;
  // how much time there really is: boarding less the buffer
  const free = Math.max(0, mins - 10), fits = list.filter(r => r.status === 'ok').length;
  const row = r => `
    <button class="row idea ${r.status}" data-id="${r.i.id}">
      <span class="tile ${r.i.cat}">${icon(r.i.icon || r.i.cat)}</span>
      <span class="grow"><span class="t">${esc(r.i.name)}</span><span class="s">${esc(r.i.gate || 'Main terminal')} · ${r.walk ? r.walk + ' min away' : 'right here'}</span></span>
      <span class="status ${r.status}">${esc(r.why || `${r.walk * 2 + r.i.dwell} min`)}</span>
    </button>`;
  const counts = { 'Time for these': list.filter(r => r.status === 'ok').length };
  const group = (title, rows, cls = '') => rows.length ? `<div class="group-title">${title}<span class="gt-walk">${counts[title] || rows.length}</span></div><div class="group ${cls}" style="--inset:58px">${rows.map(row).join('')}</div>` : '';
  const ok = list.filter(r => r.status === 'ok'), warn = list.filter(r => r.status === 'warn'), no = list.filter(r => r.status === 'no');
  $('#ktFree').innerHTML = `<b>${free >= 60 ? `${Math.floor(free / 60)} h ${free % 60} min` : `${free} min`} free</b>${fits ? `Time for ${fits} ${fits === 1 ? 'place' : 'places'}` : 'Stay near your gate'}<small>Keeps 10 minutes before boarding</small>`;
  const SHOW = 12;
  let html = group('Time for these', okOpen ? ok : ok.slice(0, SHOW));
  if (ok.length > SHOW) html += `<button class="more" id="okMore" aria-expanded="${okOpen}">${okOpen ? 'Show fewer' : `Show all ${ok.length}`}${icon('chev')}</button>`;
  html += group('Cutting it close', warn);
  html += `<p class="foot" style="margin:-8px 16px 0">Times are there and back from your gate, plus a typical visit.</p>`;
  if (no.length) html += `<button class="more" id="ideasMore" aria-expanded="${ideasOpen}">${ideasOpen ? 'Hide' : 'Show'} ${no.length} without enough time or closed${icon('chev')}</button>` + (ideasOpen ? group('Not this time', no, 'dim') : '');
  if (!list.length) html = '<div class="group"><div class="row"><span class="s">Nothing like that past security.</span></div></div>';
  $('#ideas').innerHTML = html;
  const okm = $('#okMore'); if (okm) okm.onclick = () => { okOpen = !okOpen; buzz(5); updateIdeas(); };
  const more = $('#ideasMore'); if (more) more.onclick = () => { ideasOpen = !ideasOpen; buzz(5); updateIdeas(); };
  $('#ideas').querySelectorAll('[data-id]').forEach(b => b.onclick = () => showIdea(ITEMS[b.dataset.id]));
}
function showIdea(it) {
  $('#from').value = $('#ktGate').value; $('#to').value = it.id;
  routeNow(); showPlace(it, true);
}
$('#ktGate').onchange = updateIdeas;
$('#ktMin').oninput = () => { boardAt = Date.now() + +$('#ktMin').value * 60000; updateIdeas(); };
$('#surprise').onclick = () => {
  const ok = lastIdeas.filter(r => r.status === 'ok');
  const pool = ok.length ? ok : lastIdeas.filter(r => r.status === 'warn');
  if (!pool.length) { $('#ktToast').textContent = 'Not enough time to wander. Stay near your gate.'; $('#ktToast').hidden = false; buzz(30); return; }
  $('#ktToast').hidden = true;
  buzz(12);
  showIdea(pool[Math.floor(Math.random() * pool.length)].i);
};

// ---------- Airlines ----------
// an airline's mark: its two-letter code on a tile in its brand colour
const airMark = (a, size = 30) => `<span class="air-mark" style="--ac:${esc(a.color || 'var(--label-2)')};--ai:${esc(a.ink || '#fff')};--as:${size}px" aria-hidden="true">${esc(a.code || a.name.slice(0, 2).toUpperCase())}</span>`;
// walk from security to each concourse: nearest and farthest gate
const CON_WALK = {};
for (const con of CONS) {
  const gates = Object.values(ITEMS).filter(it => it.kind === 'gate' && it.con === con);
  const legs = gates.map(g => ({ g, m: minutes(secRoute(g).units) })).sort((x, y) => x.m - y.m);
  if (legs.length) CON_WALK[con] = { min: legs[0].m, max: legs[legs.length - 1].m, near: legs[0].g, gates: gates.sort((x, y) => gnumOf(x.code) - gnumOf(y.code)) };
}
const walkRange = con => { const w = CON_WALK[con]; return !w ? '' : w.min === w.max ? `${w.min} min` : `${w.min}–${w.max} min`; };
$('#airNote').textContent = AP.ui.airlinesNote || '';
$('#airTip').textContent = (AP.ui.airlinesTip ? AP.ui.airlinesTip + ' ' : '') + 'Gates change, so check your boarding pass and the departure screens.';
// Grouped by concourse; an airline in several concourses appears under each, and airlines
// without a fixed concourse come last
const airRow = (a, i) => `
    <button class="row air-row" data-i="${i}">${airMark(a, 38)}
      <span class="grow"><span class="t">${esc(a.name)}</span>${a.note ? `<span class="s">${esc(a.note)}</span>` : ''}</span>
      <svg class="ico chev"><use href="#i-chev"/></svg>
    </button>`;
const unplaced = AIRLINES.filter(a => !a.cons.length);
$('#airlines').innerHTML = CONS.filter(con => AIRLINES.some(a => a.cons.includes(con))).map(con => `
  <div class="group-title">${badgeSvg(con, 22)}Concourse ${con} · ${CON_RANGE[con]}<span class="gt-walk">${icon('walk')}${walkRange(con)}</span></div>
  <div class="group" style="--inset:16px">${AIRLINES.map((a, i) => a.cons.includes(con) ? airRow(a, i) : '').join('')}</div>`).join('')
  + (unplaced.length ? `<div class="group-title">Gate varies</div><div class="group" style="--inset:16px">${unplaced.map(a => airRow(a, AIRLINES.indexOf(a))).join('')}</div>` : '');
const airGates = a => Object.values(ITEMS).filter(it => it.kind === 'gate' && a.cons.includes(it.con));
const fitAirline = a => a.cons.length === 1 ? fitCon(a.con) : a.cons.length ? fitItems(airGates(a), 24, 5) : fitAll();
function highlightAirline(a) {
  buzz();
  highlight(airGates(a).map(it => it.id));
  setRoute([]);
  if (!wide() && detent !== 'peek') setDetent('peek');
  fitAirline(a);
}
// An airline's card: where it flies from, how far that is, and its gates
function showAirline(a) {
  buzz();
  if (selected) { selected.el.classList.remove('sel'); selected = null; }
  pickHall(null);
  setPin(null); setRoute([]); setFloor('up', true);
  highlight(airGates(a).map(it => it.id));
  placeMode = true;
  $('#seg').hidden = true; $('#closePlace').hidden = false; $('#modeSw').hidden = true;
  $('#eyebrow').classList.remove('can'); openAirports(false); $('#title').hidden = false;
  ['dir', 'kill', 'air'].forEach(t => $('#pane-' + t).hidden = true);
  const pane = $('#pane-place'); pane.hidden = false; replay(pane); replay($('#title'));
  $('#title').textContent = a.name; $('#title').classList.remove('long');
  $('#eyebrow').textContent = a.code ? `Airline · ${a.code}` : 'Airline';
  const tile = $('#placeTile'); tile.innerHTML = airMark(a, 44); tile.hidden = false; replay(tile.firstChild);
  const one = a.cons.length === 1, walks = a.cons.map(c => CON_WALK[c]).filter(Boolean);
  const nearest = walks.slice().sort((x, y) => x.min - y.min)[0];
  const lo = walks.length ? Math.min(...walks.map(w => w.min)) : 0, hi = walks.length ? Math.max(...walks.map(w => w.max)) : 0;
  const others = one ? AIRLINES.filter(o => o !== a && o.cons.includes(a.con)) : [];
  let html = !a.cons.length ? `<p class="summary"><span>Check the departure screens for the gate</span></p>`
    : one ? `<p class="summary"><span>Concourse ${a.con}</span><span>Gates ${esc(CON_RANGE[a.con])}</span></p>`
    : `<p class="summary"><span>Concourses ${listJoin(a.cons)}</span></p>`;
  html += `<div class="bgroup">
    <button class="primary" data-act="walk"${nearest ? '' : ' disabled'}>${icon('walk')}Directions${nearest ? `<span class="sub">${nearest.min} min</span>` : ''}</button>
    <button data-act="show">${one ? badgeSvg(a.con, 22) : icon('gate')}Show gates</button></div>`;
  const rows = [['Check in', `${esc(ITEMS['v:' + ROLE.ticketing] ? ITEMS['v:' + ROLE.ticketing].name.replace(/\s*\(.*\)$/, '') : 'Ticketing')}`]];
  if (walks.length) rows.push(['From security', `${lo === hi ? lo : lo + '–' + hi} min ${AP.ui.transitWord || 'walk'}`]);
  if (a.partner) rows[0][1] += ` · ${esc(a.partner)} counter`;
  if (a.ops) rows.unshift(['Operated by', esc(listJoin(a.ops))]);
  if (a.partner) rows.unshift(['Flies for', esc(a.partner)]);
  if (a.note) rows.unshift(['Flies', esc(a.note)]);
  html += `<div class="group">${rows.map(([k, v]) => `<div class="row"><span class="rl" style="flex:none">${k}</span><span style="flex:1;min-width:0;color:var(--label-2);text-align:right">${v}</span></div>`).join('')}</div>`;
  if (one && CON_WALK[a.con]) html += `<div class="group-title">Gates</div><div class="gate-chips">${CON_WALK[a.con].gates.map(g => `<button data-gate="${g.id}" class="gate-chip ${g.con}">${esc(g.code)}</button>`).join('')}</div>`;
  else if (a.cons.length > 1) html += `<div class="group-title">Concourses</div><div class="gate-chips">${a.cons.map(c => `<button data-con="${c}" class="gate-chip ${c}">${c}</button>`).join('')}</div>`;
  if (others.length) html += `<div class="group-title">Also in Concourse ${a.con}</div><div class="group tags">${others.map(o => `<button class="tag air-tag" data-air="${AIRLINES.indexOf(o)}">${airMark(o, 22)}${esc(o.name)}</button>`).join('')}</div>`;
  html += `<p class="foot" style="margin:-6px 16px 0">Gates change, so check your boarding pass and the departure screens.</p>`;
  pane.innerHTML = html;
  pane.querySelector('[data-act="walk"]').onclick = () => {
    if (!nearest) return; buzz(); $('#from').value = CHK; $('#to').value = nearest.near.id; setTab('dir', true); if (!wide()) setDetent('peek'); routeNow();
  };
  pane.querySelector('[data-act="show"]').onclick = () => { buzz(5); if (!wide()) setDetent('peek'); fitAirline(a); };
  pane.querySelectorAll('[data-gate]').forEach(b => b.onclick = () => { buzz(5); showPlace(ITEMS[b.dataset.gate], false); });
  pane.querySelectorAll('.gate-chip[data-con]').forEach(b => b.onclick = () => { buzz(5); if (!wide()) setDetent('peek'); fitCon(b.dataset.con); });
  pane.querySelectorAll('[data-air]').forEach(b => b.onclick = () => showAirline(AIRLINES[+b.dataset.air]));
  sheetBody.scrollTop = 0;
  if (!wide()) setDetent('half');
  fitAirline(a);
}
$('#airlines').querySelectorAll('[data-i]').forEach(b => b.onclick = () => showAirline(AIRLINES[+b.dataset.i]));

// ---------- Search ----------
const q = $('#q'), results = $('#results');
let hits = [], active = 0;
const store = {
  get(k, d) { try { const v = localStorage.getItem('cle.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cle.' + k, JSON.stringify(v)); } catch (e) {} },
};
const kindOf = it => it.kind === 'gate' ? `Concourse ${it.con}` : it.kind === 'amen' ? (it.near || '') + ((s => s ? ' · ' + s.text : '')(hoursStatus(it))) : 'Arrive & depart';
const itemHit = it => ({ label: it.name, kind: kindOf(it), lead: tileFor(it), id: it.id, go: () => showPlace(it, false) });
function mark(label, needle) {
  const i = needle ? norm(label).indexOf(needle) : -1;
  return i < 0 ? esc(label) : esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + needle.length)) + '</mark>' + esc(label.slice(i + needle.length));
}
function renderHits(sections, needle) {
  let html = '', n = 0;
  for (const [title, list] of sections) {
    if (!list.length) continue;
    if (title) html += `<div class="sec">${title}</div>`;
    html += list.map(h => `<button data-i="${n}" class="${n++ === active ? 'active' : ''}">${h.lead}<span><span>${mark(h.label, needle)}</span><span class="k">${h.html ? h.kind : esc(h.kind)}</span></span></button>`).join('');
  }
  return html;
}
function suggestions() {
  const recent = store.get('recent', []).map(id => ITEMS[id]).filter(Boolean).slice(0, 4);
  const popular = AP.ui.popular.map(id => ITEMS[id])
    .concat(Object.values(ITEMS).filter(i => i.kind === 'amen' && AP.ui.popularRe.test(i.name)))
    .filter(i => !recent.includes(i)).slice(0, 5);
  hits = [...recent.map(itemHit), ...popular.map(itemHit)]; active = -1;
  results.innerHTML = `<div class="sec">Airlines</div><div class="airline-row">${AIRLINES.map((a, i) => `<button data-air="${i}">${airMark(a, 24)}${esc(a.name)}</button>`).join('')}</div>`
    + renderHits([['Recent', recent.map(itemHit)], ['Popular', popular.map(itemHit)]]);
  results.classList.toggle('fresh', results.hidden); if (results.hidden) stagger(results, ':scope > button'); results.hidden = false; wireResults();
}
// Everyday words for each kind of place, so "pizza" or "bathroom" finds something
const SYNONYMS = {
  food: 'food eat restaurant meal lunch dinner breakfast pizza burger burrito taco sandwich salad chicken sushi bagel grill kitchen snack',
  coffee: 'coffee cafe café latte espresso tea donut doughnut pastry pretzel cinnamon yogurt ice cream dessert smoothie juice sweet treat',
  bar: 'bar beer wine drink drinks cocktail pub brewery alcohol',
  shop: 'shop shopping store news newsstand magazine book gift souvenir sunglasses electronics headphones luggage',
  play: 'relax massage spa lounge chairs play kids lottery',
  service: 'charge charger charging phone outlet power atm cash money information help desk lost pet animal relief wifi pharmacy vending sim',
  rest: 'restroom restrooms bathroom toilet toilets washroom loo wc lavatory family changing',
};
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
// one typo (a missing, extra, swapped or wrong letter) still matches a word
function near1(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)
    || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}
// how well a query matches some text: 3 starts with, 2 a word starts with, 1 contains, 0.5 one typo, 0 no
function score(text, s) {
  const t = norm(text);
  if (t.startsWith(s)) return 3;
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some(w => w.startsWith(s))) return 2;
  if (t.includes(s)) return 1;
  const qs = s.split(/\s+/);
  return qs.every(qw => words.some(w => w.startsWith(qw) || near1(qw, w) || near1(qw, w.slice(0, qw.length)))) ? .5 : 0;
}
function runSearch() {
  const raw = q.value.trim(), s = norm(raw);
  $('#qClear').hidden = !s;
  if (!s) { if (document.activeElement === q) suggestions(); else results.hidden = true; return; }
  const code = s.replace(/^gate\s*/, '').replace(/\s+/g, '');
  // airline codes match too, unless a gate has that number (JetBlue is B6)
  const isGateCode = Object.values(ITEMS).some(it => it.kind === 'gate' && it.code.toLowerCase() === code);
  // the airline that actually flies it (SkyWest, Envoy…) finds the brand it flies for
  const air = AIRLINES.map(a => ({ a, sc: Math.max(score(a.name, s), ...[...(a.ops || []), ...(a.aka || [])].map(n => score(n, s) * .9), !isGateCode && a.code && a.code.toLowerCase() === s && !a.partner ? 3 : 0) })).filter(x => x.sc)
    .sort((x, y) => y.sc - x.sc)
    .map(({ a }) => ({ label: a.name, kind: !a.cons.length ? 'Airline · gate varies' : a.cons.length > 1 ? `Airline · Concourses ${a.cons.join(', ')}` : `Airline · Concourse ${a.con} · ${CON_RANGE[a.con]}`, lead: airMark(a, 30), go: () => showAirline(a) }));
  // categories the query names, by label or everyday word
  const cats = Object.keys(CATS).filter(c => score(CATS[c].label, s) >= 1 || SYNONYMS[c].split(' ').some(w => w.startsWith(s) || (s.length >= 4 && near1(s, w))));
  // nearest first, from where directions start (or where you are)
  const from = ITEMS['v:me'] || ITEMS[$('#from').value] || ITEMS[CHK];
  const D = from ? fromSrc(nodeOf(from)).D : {};
  const walk = it => D[it.id] != null ? minutes(D[it.id]) : null;
  const gates = [], places = [], seen = new Set();
  for (const it of Object.values(ITEMS)) {
    if (it.id === 'v:me') continue;
    if (it.kind === 'gate') { if (code && it.code.toLowerCase().startsWith(code)) gates.push(it); continue; }
    // places also answer to everyday words for them ("security" finds the checkpoints)
    const sc = Math.max(score(it.name, s), it.cat && cats.includes(it.cat) ? 1.5 : 0, ...(PLACE_WORDS_OF()[it.node] || []).map(w => score(w, s) * 1.25));
    if (!sc) continue;
    const key = it.name + '|' + (it.gate || it.zone); if (seen.has(key)) continue; seen.add(key);
    places.push({ it, sc, w: walk(it) });
  }
  const gnum = it => +it.code.replace(/\D/g, '');
  gates.sort((x, y) => (x.code.toLowerCase() === code ? -1 : 0) - (y.code.toLowerCase() === code ? -1 : 0) || gnum(x) - gnum(y));
  // strong name matches first, then by walk; within a category search, purely by walk
  const strong = p => cats.length ? p.sc >= 3 && !CATS[p.it.cat]?.label.toLowerCase().startsWith(s) : p.sc >= 2;
  // vending machines after real places, unless that's what you're after ("coffee" finds cafés first)
  const vend = p => /vending/i.test(p.it.name) && !/vend/.test(s);
  places.sort((x, y) => vend(x) - vend(y) || strong(y) - strong(x) || (x.w ?? 999) - (y.w ?? 999) || y.sc - x.sc);
  const hitFor = ({ it, w }) => ({ ...itemHit(it), kind: (w != null && it !== from ? `<b>${w} min</b> · ` : '') + esc(kindOf(it)), html: true });
  const typo = places.length && places.every(p => p.sc < 1) && !gates.length && !air.length;
  const placeTitle = cats.length === 1 && places.every(p => p.sc < 2) ? `${CATS[cats[0]].label} · nearest first` : places.length > 1 ? 'Places · nearest first' : '';
  const sections = [['Airlines', air.slice(0, 3)], ['Gates', gates.slice(0, 6).map(itemHit)], [placeTitle, places.slice(0, 10).map(hitFor)]];
  hits = sections.flatMap(([, l]) => l); active = 0;
  const showTitles = sections.filter(([, l]) => l.length).length > 1 || !!placeTitle;
  results.innerHTML = hits.length
    ? (typo ? `<div class="hint">Showing results for similar spellings</div>` : '') + renderHits(sections.map(([t, l]) => [showTitles ? t : '', l]), gates.length && s.length < 2 ? '' : s)
    : `<div class="empty">No results for “${esc(raw)}”. Try a gate like B6, an airline, or a word like coffee, pizza or restroom.</div>`;
  results.classList.toggle('fresh', results.hidden); if (results.hidden) stagger(results, ':scope > button'); results.hidden = false; wireResults();
}
function wireResults() {
  results.querySelectorAll('[data-i]').forEach(b => b.onclick = () => pick(+b.dataset.i));
  results.querySelectorAll('[data-air]').forEach(b => b.onclick = () => { results.hidden = true; q.blur(); showAirline(AIRLINES[+b.dataset.air]); });
}
function pick(i) {
  const h = hits[i]; if (!h) return;
  if (h.id) store.set('recent', [h.id, ...store.get('recent', []).filter(x => x !== h.id)].slice(0, 6));
  results.hidden = true; q.blur(); h.go();
}
q.addEventListener('input', runSearch);
q.addEventListener('focus', runSearch);
q.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); pick(Math.max(active, 0)); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!hits.length) return;
    active = (Math.max(active, e.key === 'ArrowDown' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
    results.querySelectorAll('[data-i]').forEach(b => b.classList.toggle('active', +b.dataset.i === active));
  } else if (e.key === 'Escape') { results.hidden = true; q.blur(); }
});
$('#qClear').onclick = () => { q.value = ''; q.focus(); runSearch(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) results.hidden = true; });

// ---------- Airport picker ----------
const apMenu = $('#apMenu'), apBtn = $('#eyebrow');
function openAirports(open) {
  fade(apMenu, open); apBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  apMenu.innerHTML = Object.values(AIRPORTS).map(a => `<button role="menuitemradio" aria-checked="${a.code === AP.code}" data-ap="${a.code}">
      <span class="code">${esc(a.code)}</span><span><span>${esc(a.name)}</span><span class="s">${esc(a.city)}</span></span>
      <span style="color:var(--primary)">${a.code === AP.code ? icon('check') : ''}</span></button>`).join('')
    + `<div class="soon">More airports are on the way.</div>`;
  stagger(apMenu, 'button');
  apMenu.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => {
    if (b.dataset.ap === AP.code) return openAirports(false);
    try { localStorage.setItem('cw.airport', b.dataset.ap); } catch (e) {}
    location.reload();
  });
}
apBtn.addEventListener('click', () => { if (!placeMode) { buzz(5); openAirports(apMenu.hidden || apMenu.classList.contains('leaving')); } });
document.addEventListener('pointerdown', e => { if (!apMenu.hidden && !e.target.closest('#apMenu, #eyebrow')) openAirports(false); });

// Android back button: close overlays before leaving the app
window.cleBack = () => {
  if (nav) { endNav(); return true; }
  if (!layersEl.hidden) { openLayers(false); return true; }
  if (!apMenu.hidden) { openAirports(false); return true; }
  if (!toastEl.hidden) { toastEl.hidden = true; return true; }
  if (!results.hidden) { results.hidden = true; return true; }
  if (placeMode) { setTab(tab, true); return true; }
  if (!wide() && detent === 'full') { setDetent('half'); return true; }
  return false;
};

// ---------- Live: my flight and security waits (from the Clearway Live server, see server/) ----------
const live = { flight: null, track: null, err: '', busy: false, wait: null, fetched: 0 };
const FLIGHT_KEY = 'flight.' + AP.code;
async function liveGet(path) {
  if (!LIVE_API) throw Object.assign(new Error('off'), { off: true });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(LIVE_API + path, { signal: ctl.signal, cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || 'HTTP ' + r.status), { status: r.status });
    return body;
  } finally { clearTimeout(timer); }
}
const localDate = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: AP.tz }).format(t);   // YYYY-MM-DD at the airport
const tclock = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: AP.tz }) : '–';
const normFlightNo = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
// "C22", or "22" in terminal "C", → that gate on the map
function gateItem(end) {
  if (!end || !end.gate) return null;
  let g = end.gate.toUpperCase().replace(/\s+/g, '').replace(/^GATE/, '');
  if (/^\d/.test(g) && /^[A-Z]$/.test(end.terminal || '')) g = end.terminal + g;
  return ITEMS['g:' + g] || null;
}
const flightSide = f => f.departure && f.departure.airport === AP.code ? 'departure' : f.arrival && f.arrival.airport === AP.code ? 'arrival' : null;
function flightStatus(f, side) {
  const e = f[side] || {}, late = e.scheduled && (e.actual || e.estimated) ? Math.round((new Date(e.actual || e.estimated) - new Date(e.scheduled)) / 60000) : 0;
  switch (f.status) {
    case 'cancelled': return ['no', 'Cancelled'];
    case 'diverted': return ['no', 'Diverted'];
    case 'boarding': return ['info', 'Boarding'];
    case 'gate-closed': return ['warn', 'Gate closed'];
    case 'departed': return ['info', side === 'arrival' ? 'In the air' : 'Departed'];
    case 'arrived': return ['ok', 'Landed'];
  }
  if (late >= 15) return ['warn', `Delayed ${late} min`];
  if (late <= -5) return ['ok', `Early ${-late} min`];
  return ['ok', 'On time'];
}
const BOARD_BEFORE = 35;   // minutes before departure that boarding usually starts
// Put the flight's gate, boarding time and carousel into the app; say so when the gate changes
function applyFlight(f, prev) {
  const side = flightSide(f); if (!side) return;
  const e = f[side], g = gateItem(e), prevGate = prev && prev.flight === f.flight && prev[side] ? prev[side].gate : null;
  if (prevGate && e.gate && prevGate !== e.gate) { toast(`Gate change: ${f.flight} is now at gate ${e.gate}`); buzz(40); }
  if (side === 'departure') {
    if (g) {
      const wasGate = $('#ktGate').value;
      $('#ktGate').value = g.id;
      if (mode === 'dep' && (!prev || $('#to').value === wasGate || !$('#to').value)) { $('#to').value = g.id; if (tab === 'dir' && !placeMode) updateRoute(!prev); }
    }
    const dep = e.estimated || e.scheduled;
    if (dep) boardAt = new Date(dep).getTime() - BOARD_BEFORE * 60000;
    if (g) $('#conDep').value = g.id;
    if (dep) $('#conTime').value = hhmm(cleNow(new Date(dep).getTime()).min);
    if (mode === 'con') updateConnection(!prev);
    updateClock(); if (!$('#pane-kill').hidden) updateIdeas();
  } else {
    if (g) $('#arrGate').value = g.id;
    if (/^\d{1,2}$/.test(e.baggage || '')) $('#arrCarousel').value = e.baggage;
    if (mode === 'arr') updateArrival(!prev);
    conArrival(f);
  }
  saveTrip();
}
function flightHtml() {
  const f = live.flight;
  if (!f) {
    const msg = live.busy ? 'Looking up your flight…' : live.err || (LIVE_API ? 'Fills in your gate, boarding time and baggage carousel, and tells you if the gate changes.' : 'Live flight status isn’t connected in this version.');
    return `<form class="group flight-form" data-fform><span class="tile" style="background:var(--brand)">${icon('plane')}</span>
      <input name="no" autocomplete="off" autocapitalize="characters" enterkeyhint="go" maxlength="9" placeholder="${scanKind ? 'Flight, e.g. DL 1234' : 'Flight number, e.g. DL 1234'}" aria-label="Flight number" value="${esc(live.track ? live.track.number : '')}"${LIVE_API ? '' : ' disabled'}>
      ${scanKind ? `<button type="button" class="scan" data-fscan aria-label="Scan your boarding pass"${LIVE_API && !live.busy ? '' : ' disabled'}>${icon('scan')}</button>` : ''}
      <button type="submit"${LIVE_API && !live.busy ? '' : ' disabled'}>Track</button></form>
      <p class="flight-msg${live.err ? ' err' : ''}">${esc(msg)}${scanKind && LIVE_API && !live.err && !live.busy ? ' Or scan your boarding pass.' : ''}</p>`;
  }
  const side = flightSide(f), a = AIRLINES.find(x => x.code === (f.airline && f.airline.iata));
  const route = `${esc((f.departure && (f.departure.city || f.departure.airport)) || '')} → ${esc((f.arrival && (f.arrival.city || f.arrival.airport)) || '')}`;
  const lead = a ? airMark(a, 40) : `<span class="tile" style="width:40px;height:40px;border-radius:12px;background:var(--brand)">${icon('plane')}</span>`;
  if (!side) return `<div class="group flight-card"><div class="fc-top">${lead}<span class="grow"><span class="t">${esc(f.flight)}</span><span class="s">${route}</span></span></div>
    <p class="flight-msg err" style="padding:0;margin:0">This flight doesn’t leave from or land at ${esc(AP.code)} today.</p>
    <div class="fc-foot"><span></span><button data-fstop>Track a different flight</button></div></div>`;
  const [cls, text] = flightStatus(f, side), e = f[side], g = gateItem(e);
  const time = (lbl, est, sch) => `<div class="fc-cell"><small>${lbl}</small><b>${tclock(est || sch)}</b>${est && sch && Math.abs(new Date(est) - new Date(sch)) > 4 * 60000 ? `<s>${tclock(sch)}</s>` : '<em>scheduled</em>'}</div>`;
  const gateCell = g ? `<button class="fc-cell" data-fgate="${g.id}"><small>Gate</small><b>${esc(e.gate)}</b></button>` : `<div class="fc-cell"><small>Gate</small><b>${esc(e.gate || '–')}</b>${e.gate ? '' : '<em>not yet</em>'}</div>`;
  const cells = side === 'departure'
    ? gateCell + time('Departs', e.estimated || e.actual, e.scheduled) + `<div class="fc-cell"><small>Boarding</small><b>${(e.estimated || e.scheduled) ? tclock(new Date(new Date(e.estimated || e.scheduled) - BOARD_BEFORE * 60000).toISOString()) : '–'}</b><em>about</em></div>`
    : gateCell + time('Lands', e.actual || e.estimated, e.scheduled) + `<div class="fc-cell"><small>Bags</small><b>${esc(e.baggage || '–')}</b><em>${e.baggage ? 'carousel' : 'not yet'}</em></div>`;
  const pass = live.track && live.track.pass, chips = pass ? [pass.seat && `Seat ${esc(pass.seat)}`, pass.group && `Group ${esc(pass.group)}`, pass.precheck && 'TSA PreCheck'].filter(Boolean) : [];
  const countdown = side === 'departure' && window.CLEApp && CLEApp.setCountdown
    ? `<label class="fc-cd"><span class="grow"><b>Gate countdown</b><small>Boarding time and when to leave, on your lock screen</small></span><input type="checkbox" class="switch" data-fcd${countdownOn ? ' checked' : ''}></label>` : '';
  return `<div class="group flight-card"><div class="fc-top">${lead}<span class="grow"><span class="t">${esc(f.flight)}</span><span class="s">${route}</span></span><span class="status ${cls}">${esc(text)}</span></div>
    ${chips.length ? `<div class="fc-chips">${chips.map(c => `<span>${c}</span>`).join('')}</div>` : ''}
    <div class="fc-grid">${cells}</div>${countdown}
    <div class="fc-foot"><span>${live.busy ? 'Updating…' : live.err ? esc(live.err) : 'Updated ' + ago(live.fetched ? new Date(live.fetched).toISOString() : f.updated)}</span><button data-fstop>Stop tracking</button></div></div>`;
}
function renderFlight() {
  for (const id of ['flightKill', 'flightArr', 'flightCon']) {
    const box = $('#' + id); box.innerHTML = flightHtml();
    const form = box.querySelector('[data-fform]');
    if (form) form.onsubmit = ev => { ev.preventDefault(); buzz(); trackFlight(form.elements.no.value); };
    const stop = box.querySelector('[data-fstop]');
    if (stop) stop.onclick = () => { buzz(5); live.flight = null; live.track = null; live.err = ''; live.inbound = null; store.set('inbound.' + AP.code, null); store.set(FLIGHT_KEY, null); renderFlight(); };
    const scan = box.querySelector('[data-fscan]');
    if (scan) scan.onclick = () => { buzz(); scanPass(); };
    const cd = box.querySelector('[data-fcd]');
    if (cd) cd.onchange = () => setCountdown(cd.checked, true);
    const gate = box.querySelector('[data-fgate]');
    if (gate) gate.onclick = () => { buzz(5); showPlace(ITEMS[gate.dataset.fgate], false); };
  }
}
async function trackFlight(no, quiet, forDate, pass) {
  no = normFlightNo(no);
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(no)) { live.err = 'Enter a flight number like DL 1234.'; renderFlight(); return; }
  const same = live.track && live.track.number === no;
  const date = forDate || (same ? live.track.date : localDate());
  pass = pass || (same ? live.track.pass : null);
  live.busy = true; live.err = ''; renderFlight();
  try {
    const f = await liveGet(`/flight?number=${no}&date=${date}&airport=${AP.code}`), prev = live.flight;
    live.flight = f; live.track = { number: no, date, pass }; live.fetched = Date.now();
    store.set(FLIGHT_KEY, live.track);
    applyFlight(f, prev);
  } catch (e) {
    live.err = e.off ? 'Live flight status isn’t connected in this version.' : e.status === 404 ? `Couldn’t find ${no} ${date === localDate() ? 'today' : 'on ' + date}. Check the number on your boarding pass.` : 'Couldn’t reach flight status. Check your connection.';
    if (!quiet) buzz(30);
  }
  live.busy = false; renderFlight();
}
// ---------- Boarding pass ----------
// The barcode on a boarding pass follows IATA's Bar Coded Boarding Pass standard (BCBP, "M1…"):
// fixed-width fields for each flight leg (record locator, from, to, airline, flight number, day of the
// year, cabin, seat, check-in number), then optional data. It's read here on the phone; only the
// flight number and date go to flight status, as when you type them. Names and booking codes are dropped.
function parseBCBP(raw) {
  const s = String(raw || '').replace(/[\r\n]/g, '');
  if (!/^M[1-4]/.test(s) || s.length < 60) return null;
  const n = +s[1], legs = [];
  let pos = 23;
  for (let i = 0; i < n; i++) {
    const L = s.slice(pos, pos + 37); if (L.length < 37) break;
    const condLen = parseInt(L.slice(35, 37), 16) || 0, cond = s.slice(pos + 37, pos + 37 + condLen);
    const fl = L.slice(16, 21).trim(), m = /^0*(\d{1,4})([A-Z]?)$/.exec(fl);
    const leg = { from: L.slice(7, 10).trim(), to: L.slice(10, 13).trim(), carrier: L.slice(13, 16).trim(), flight: m ? m[1] + m[2] : fl.replace(/^0+/, ''),
      day: parseInt(L.slice(21, 24), 10), cabin: L.slice(24, 25).trim(), seat: L.slice(25, 29).trim().replace(/^0+/, ''), seq: L.slice(29, 34).trim() };
    // the repeated optional block for each leg ends with the "fast track" flag
    let rep = cond;
    if (i === 0 && cond[0] === '>') rep = cond.slice(4 + (parseInt(cond.slice(2, 4), 16) || 0));
    const rs = parseInt(rep.slice(0, 2), 16) || 0, r = rep.slice(2, 2 + rs);
    leg.fastTrack = r.length >= 42 && r[41] === 'Y';
    pos += 37 + condLen; legs.push(leg);
  }
  if (!legs.length || !/^[A-Z]{3}$/.test(legs[0].from)) return null;
  // PreCheck: printed in the airline's free-form data on most US passes
  const precheck = /TSA ?PRE|PRECHK|TSAPRECHECK/i.test(s) || legs.some(l => l.fastTrack);
  // boarding group or zone, when the airline prints it in its data ("GRP3", "GROUP B", "ZONE 2")
  const group = (/GRP ?(\d{1,2}|[A-F])(?![A-Z0-9])|GROUP ?(\d{1,2}|[A-F])(?![A-Z0-9])|ZONE ?(\d)(?!\d)/.exec(s.slice(60)) || []).slice(1).find(Boolean);
  return { legs, precheck, group: group || '' };
}
// day of the year → the date it most likely means (the nearest one, from a month ago onwards)
function passDate(day) {
  const now = new Date(), y = now.getFullYear();
  const cands = [y - 1, y, y + 1].map(yr => new Date(Date.UTC(yr, 0, day)));
  const best = cands.filter(d => d - now > -31 * 86400000).sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0] || cands[1];
  return best.toISOString().slice(0, 10);
}
// a flight landing here fills in where and when the connection starts
function conArrival(f) {
  const e = f && f.arrival; if (!e || e.airport !== AP.code) return;
  const g = gateItem(e), at = e.actual || e.estimated || e.scheduled;
  if (g) $('#conArr').value = g.id;
  if (at) $('#conLand').value = hhmm(cleNow(new Date(at).getTime()).min);
  if (mode === 'con') updateConnection(false);
}
// the flight you're connecting from: looked up with the tracked one, so a late arrival shows up
function refreshInbound() {
  const t = live.inbound; if (!t || !LIVE_API) return;
  if (t.date < localDate(Date.now() - 86400000)) { live.inbound = null; store.set('inbound.' + AP.code, null); return; }
  liveGet(`/flight?number=${t.number}&date=${t.date}&airport=${AP.code}`).then(conArrival).catch(() => {});
}
// a pass with two flights that meet here: track the next one (gate, time, changes) and look up the
// one you're landing on once, for its gate and landing time
function useConnection(p, i) {
  const inb = p.legs[i], out = p.legs[i + 1];
  if (mode !== 'con') setMode('con', true);
  setTab('dir', true);
  toast(`Connecting here: ${inb.carrier} ${inb.flight} from ${inb.from}, then ${out.carrier} ${out.flight} to ${out.to}.` + (LIVE_API ? '' : ' Pick the gates and times; live flight status isn’t connected in this version.'));
  if (!LIVE_API) return saveTrip();
  trackFlight(out.carrier + out.flight, false, passDate(out.day), { seat: out.seat, precheck: p.precheck, group: p.group, from: out.from, to: out.to });
  live.inbound = { number: normFlightNo(inb.carrier + inb.flight), date: passDate(inb.day) };
  store.set('inbound.' + AP.code, live.inbound);
  refreshInbound();
  saveTrip();
}
function usePass(p, legIx) {
  const leg = p.legs[legIx];
  const pass = { seat: leg.seat, precheck: p.precheck, group: p.group, from: leg.from, to: leg.to };
  const arr = leg.to === AP.code && leg.from !== AP.code;
  if ((arr ? 'arr' : 'dep') !== mode) setMode(arr ? 'arr' : 'dep', true);
  if (!arr) setTab('kill', true);
  toast(`${leg.carrier} ${leg.flight} · ${leg.from} → ${leg.to}${leg.seat ? ' · seat ' + leg.seat : ''}`);
  trackFlight(leg.carrier + leg.flight, false, passDate(leg.day), pass);
}
function onPassScanned(raw) {
  const p = parseBCBP(raw);
  if (!p) { buzz(30); toast('That doesn’t look like a boarding pass barcode. Try the one on your pass or in your airline’s app.'); return; }
  // the leg that leaves from here, else lands here, else one at another airport Clearway has
  const at = code => p.legs.findIndex(l => l.from === code), to = code => p.legs.findIndex(l => l.to === code);
  // two flights that meet here (or at another airport Clearway has): a connection
  const conn = code => p.legs.findIndex((l, k) => l.to === code && p.legs[k + 1] && p.legs[k + 1].from === code);
  if (conn(AP.code) >= 0) { buzz(); return useConnection(p, conn(AP.code)); }
  let i = at(AP.code); if (i < 0) i = to(AP.code);
  if (i >= 0) { buzz(); return usePass(p, i); }
  for (const code of Object.keys(AIRPORTS)) {
    const c = conn(code);
    let j = c >= 0 ? c : at(code); if (j < 0) j = to(code);
    if (j >= 0) {
      store.set('pass.pending', { ap: code, pass: p, leg: j, conn: c >= 0, at: Date.now() });
      try { localStorage.setItem('cw.airport', code); } catch (e) {}
      toast(`Opening ${AIRPORTS[code].short || code} for ${p.legs[j].carrier} ${p.legs[j].flight}…`);
      return setTimeout(() => location.reload(), 900);
    }
  }
  const l = p.legs[0];
  toast(`${l.carrier} ${l.flight} flies ${l.from} → ${l.to}. Clearway has maps for ${Object.keys(AIRPORTS).join(' and ')} so far.`);
}
window.cleBoardingPass = raw => onPassScanned(raw);
window.cleBoardingPassError = why => { if (why !== 'cancel') toast('Couldn’t open the scanner. You can type the flight number instead.'); };
// which scanner: the Android app's (Google code scanner), else the browser's barcode reader on a photo
let scanKind = window.CLEApp && CLEApp.scanBoardingPass ? 'native' : null;
if (!scanKind && 'BarcodeDetector' in window) BarcodeDetector.getSupportedFormats().then(f => {
  if (f.includes('pdf417') || f.includes('aztec')) { scanKind = 'photo'; renderFlight(); }
}).catch(() => {});
function scanPass() {
  if (scanKind === 'native') { try { CLEApp.scanBoardingPass(); } catch (e) { cleBoardingPassError('error'); } return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    try {
      const codes = await new BarcodeDetector({ formats: ['pdf417', 'aztec', 'qr_code', 'data_matrix'] }).detect(await createImageBitmap(file));
      if (codes.length) onPassScanned(codes[0].rawValue);
      else toast('No barcode found in that photo. Try again, closer and flat on.');
    } catch (e) { toast('Couldn’t read that photo.'); }
  };
  inp.click();
}
// the lock-screen gate countdown (Android): off until you turn it on
let countdownOn = store.get('countdown', false);
function setCountdown(on, ask) {
  countdownOn = on; store.set('countdown', on);
  try { CLEApp.setCountdown(on); } catch (e) {}
  if (ask && on) toast('Gate countdown is on. It updates as your flight does.');
}
if (countdownOn && window.CLEApp && CLEApp.setCountdown) try { CLEApp.setCountdown(true); } catch (e) {}

// refresh a tracked flight every 2 minutes while the app is open, until it has landed
setInterval(() => {
  const f = live.flight;
  if (!live.track || document.hidden || live.busy) return;
  if (f && f.status === 'arrived' && f.arrival && Date.now() - new Date(f.arrival.actual || f.arrival.estimated || f.arrival.scheduled) > 3600000) return;
  trackFlight(live.track.number, true);
  if (mode === 'con') refreshInbound();
}, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && live.track && Date.now() - live.fetched > 90000) trackFlight(live.track.number, true); });

// Security wait: shown on the checkpoint, added to routes through it and to the leave-by time
const waitMin = () => live.wait && Number.isFinite(live.wait.minutes) && Date.now() - new Date(live.wait.updated) < 45 * 60000 ? live.wait.minutes : null;
async function loadWait() {
  if (!LIVE_API) return;
  try { live.wait = await liveGet('/wait?airport=' + AP.code); } catch (e) { live.wait = null; }
  if (tab === 'dir' && !placeMode) updateRoute(false);
  updateClock();
  if (placeMode && selected && selected.id === CHK) showPlace(selected, true);
}
setInterval(() => { if (!document.hidden) loadWait(); }, 5 * 60000);

// ---------- Remember the trip between launches ----------
const TRIP_KEY = AP.code === 'CLE' ? 'trip' : 'trip.' + AP.code;
function saveTrip() {
  const keep = v => v === 'v:me' ? null : v;
  store.set(TRIP_KEY, { from: keep($('#from').value), to: keep($('#to').value), gate: $('#ktGate').value, boardAt, reminderAt, cat: ktCat, tab,
    mode, stepFree, arr: { gate: $('#arrGate').value, dest: $('#arrDest').value, bags: $('#arrBags').checked, car: $('#arrCarousel').value },
    con: { a: $('#conArr').value, d: $('#conDep').value, land: $('#conLand').value, dep: $('#conTime').value, intl: $('#conIntl').checked } });
}
(() => {
  const t = store.get(TRIP_KEY, null);
  if (!t) return;
  if (ITEMS[t.from]) $('#from').value = t.from;
  if (ITEMS[t.to] || t.to === '') $('#to').value = t.to;
  if (ITEMS[t.gate]) $('#ktGate').value = t.gate;
  if (t.boardAt > Date.now() - 5 * 60000) boardAt = t.boardAt;    // forget a flight that has already boarded
  if (t.reminderAt > Date.now()) reminderAt = t.reminderAt;
  if (t.cat && ktCats.querySelector(`[data-cat="${t.cat}"]`)) ktCats.querySelector(`[data-cat="${t.cat}"]`).click();
  if (['dir', 'kill', 'air'].includes(t.tab)) tab = t.tab;
  if (t.arr) {
    if (ITEMS[t.arr.gate]) $('#arrGate').value = t.arr.gate;
    if (ARR_DEST.some(x => x[0] === t.arr.dest)) $('#arrDest').value = t.arr.dest;
    $('#arrBags').checked = t.arr.bags !== false;
    if (/^\d{1,2}$/.test(t.arr.car || '')) $('#arrCarousel').value = t.arr.car;
  }
  if (t.con) {
    if (ITEMS[t.con.a]) $('#conArr').value = t.con.a;
    if (ITEMS[t.con.d]) $('#conDep').value = t.con.d;
    if (minOf(t.con.land) != null && minOf(t.con.dep) != null) { $('#conLand').value = t.con.land; $('#conTime').value = t.con.dep; }
    $('#conIntl').checked = !!t.con.intl;
  }
  if (t.mode === 'arr' || t.mode === 'con') mode = t.mode;
  if (t.stepFree) setStepFree(true, true);
})();
for (const id of ['from', 'to', 'ktGate', 'ktMin']) $('#' + id).addEventListener('change', saveTrip);
$('#ktGate').addEventListener('change', updateClock);
['tab-dir', 'tab-kill', 'tab-air', 'swap'].forEach(id => $('#' + id).addEventListener('click', () => setTimeout(saveTrip)));
ktCats.addEventListener('click', () => setTimeout(saveTrip));

// ---------- Start ----------
let lastWide = wide();
addEventListener('resize', () => {
  chromeCache = null;
  setDetent(detent, false);
  sizeSvg();
  if (wide() !== lastWide) { lastWide = wide(); fitAll(true); } else render();
});
renderFlight();
{ const t = store.get(FLIGHT_KEY, null); if (t && t.date >= localDate() && LIVE_API) { live.track = t; trackFlight(t.number, true); } }
live.inbound = store.get('inbound.' + AP.code, null); if (mode === 'con') refreshInbound();
// a boarding pass scanned at the other airport's map: it switched here and picks it up
{ const p = store.get('pass.pending', null); store.set('pass.pending', null); if (p && p.ap === AP.code && Date.now() - p.at < 60000) (p.conn ? useConnection : usePass)(p.pass, p.leg); }
loadWait();
if (mode !== 'dep') setMode(mode, true);
updateRoute(false);
setTab(tab, true);
const launchAction = (location.hash || '').slice(1);
if (ACTIONS[launchAction]) { tab = 'dir'; setTimeout(() => cleAction(launchAction), 450); }
setDetent('peek', false);
const initialFit = instant => {
  if (!wide() && routePts.length > 1 && tab === 'dir') fitItems(routePts, 18, 3, instant); else fitAll(instant);
};
// open on a slightly pulled-back overview, then glide in to the trip
fitAll(true);
if (!reduced) { const R = visibleRect(); zoomAt((R.l + R.r) / 2, (R.t + R.b) / 2, 0.82); }
let flown = false;
setTimeout(() => { flown = true; if (!userMoved) initialFit(false); }, 380);
// fonts change the sheet header height once they load; re-fit if the map hasn't been touched
document.fonts && document.fonts.ready.then(() => { setDetent(detent, false); chromeCache = null; if (!userMoved && flown) initialFit(false); });
})();
</script>
</body>
</html>
