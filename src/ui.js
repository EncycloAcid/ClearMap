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
const CON_SHAPE = { A: blob(0, 0), B: blob(4, .16), C: blob(9, .075) };
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
const walkPath = new Path2D(['c0,c1,c2,c3,c4,crot', 'b0,b1,b2', 'hub,a0,a1,a2', 'c0,fc,hub,b0']
  .map(s => 'M' + s.split(',').map(id => V[id][0] + ' ' + V[id][1]).join('L')).join(''));
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
    'walk', 'route', 'conA', 'conB', 'conC', 'corridor', 'stairs', 'runway-mark']) p[k] = g(k);
  const tint = parseFloat(g('con-tint')) || .1;
  for (const c of 'ABC') p['term' + c] = /^#[0-9a-f]{6}$/i.test(p['con' + c]) && /^#[0-9a-f]{6}$/i.test(p.bldg) ? hexMix(p['con' + c], p.bldg, tint) : p.bldg;
  return p;
}
const repaint = () => { pal = null; if (committed) render(true); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// Sharp redraw of the base map on screen (when the map settles). It also drops the gesture cache.
function drawBase() {
  paintBase(bctx, baseCanvas.width, baseCanvas.height, view.x + ox, view.y + oy, view.k);
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
  paintBase(cctx, cw, ch, view.x + ox + mx, view.y + oy + my, view.k);
  cacheView = { ...view, mx, my };
}
function scheduleCache() {
  if (cacheIdle) return;
  const run = () => { cacheIdle = null; if (!cacheView && !ptrs.size && !moving) buildCache(); };
  cacheIdle = window.requestIdleCallback ? requestIdleCallback(run, { timeout: 400 }) : setTimeout(run, 80);
}
function blitBase() {
  const W = vw, H = vh;
  let C = cacheView, r = C ? view.k / C.k : 0;
  // where the cached area lands on screen now; rebuild if the view has left it or zoomed too far
  const place = () => ({ x: view.x - r * C.x - r * C.mx, y: view.y - r * C.y - r * C.my });
  let o = C && place();
  if (!C || r > 1.6 || r < .62 || o.x > 0 || o.y > 0 || o.x + r * (W + 2 * C.mx) < W || o.y + r * (H + 2 * C.my) < H) {
    buildCache(.12); C = cacheView; r = 1; o = place();   // mid-gesture: a slimmer margin keeps this frame quick
  }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(cache, dpr * o.x, dpr * o.y, cache.width * r, cache.height * r);
}
function paintBase(c, cw, ch, tx, ty, k) {
  pal = pal || readPalette();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = pal.map; c.fillRect(0, 0, cw, ch);
  c.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
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
  c.save(); c.translate(2, 4.5); c.fillStyle = pal['bldg-shadow'];
  for (const t of ['termM', 'termA', 'termB', 'termC', 'termD']) if (P2[t]) c.fill(P2[t]);
  c.restore();
  const edge = 1 / Math.max(k, .5);
  fill('termD', pal['term-closed']); stroke('termD', pal['bldg-edge'], edge, [3, 2]);
  fill('termM', pal.bldg); stroke('termM', pal['bldg-edge'], edge);
  // the concourses only have an upper level, so they fade back on the lower floor
  const lower = floor === 'lo';
  for (const t of 'ABC') {
    if (!lower) { fill('term' + t, pal['term' + t]); stroke('term' + t, pal['bldg-edge'], edge); continue; }
    c.globalAlpha = .55; fill('term' + t, pal['term-closed']); stroke('term' + t, pal['bldg-edge'], edge * .8); c.globalAlpha = 1;
  }
  if (!lower) stroke('bridges', pal.bridge, 3.6);
  // this floor's walkways (OpenStreetMap indoor ways) and the escalators between floors
  stroke(lower ? 'walk0' : 'walk1', pal.corridor, 5);
  if (lower) stroke('walkm1', pal.corridor, 5, [5, 4]);
  stroke('stairs', pal.stairs, 2.6, [.9, .9]);
  if (!lower) {
    // the checkpoint line across the corridor from ticketing
    c.strokeStyle = pal.route; c.globalAlpha = .75; c.lineWidth = 1.8; c.setLineDash([3, 2.4]);
    const sl = AP.ui.securityLine; c.beginPath(); c.moveTo(sl[0], sl[1]); c.lineTo(sl[2], sl[3]); c.stroke();
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
    el('use', { class: 'glyph', href: '#i-' + (it.icon || it.cat), x: -3.6, y: -3.6, width: 7.2, height: 7.2 }, sz);
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
const meG = el('g', { opacity: 0, style: 'pointer-events:none' });
const meAcc = el('circle', { class: 'me-acc', r: 0, 'vector-effect': 'non-scaling-stroke' }, meG);
const meMark = el('g', {}, meG);
const meCone = el('path', { class: 'me-cone', d: 'M0 0L-7 -17A18 18 0 0 1 7 -17Z', opacity: 0 }, meMark);
el('circle', { class: 'me-halo', r: 9 }, meMark);
el('circle', { class: 'me-dot', r: 5.2 }, meMark);
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
  if (me) { meAcc.setAttribute('cx', me.x); meAcc.setAttribute('cy', me.y); meMark.setAttribute('transform', `translate(${me.x} ${me.y}) scale(${s})`); }
  if (pinItem) pinG.setAttribute('transform', `translate(${pinItem.x} ${pinItem.y}) scale(${s * 1.15})`);
  for (const e of escBadges) e.g.setAttribute('transform', `translate(${e.x} ${e.y}) scale(${s})`);
  if (routePts.length > 1) {
    const a = routePts[0], b = routePts[routePts.length - 1], m = pointAt(routeTotal * 0.5);
    routeStart.setAttribute('transform', `translate(${a.x} ${a.y}) scale(${s})`);
    routeEnd.setAttribute('transform', `translate(${b.x} ${b.y}) scale(${s})`);
    eta.setAttribute('transform', `translate(${m.x} ${m.y}) scale(${s})`);
  }
}
// escalator badges where a route changes floor; tap one to switch floors
const escLayer = el('g', {});
let escBadges = [];
const puckG = el('g', { style: 'pointer-events:none', opacity: 0 });
el('circle', { class: 'puck-halo', r: 9 }, puckG);
el('circle', { class: 'puck', r: 4.6 }, puckG);

// ---------- Pan / zoom in screen pixels ----------
const view = { k: 1, x: 0, y: 0 };
let markerScale = 1;
function clampView() {
  // keep at least part of the airport on screen
  const W = vw, H = vh, m = 90;
  const M = MAP_BOUNDS, l = view.x + view.k * M.x0, r = view.x + view.k * M.x1, t = view.y + view.k * M.y0, b = view.y + view.k * M.y1;
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
let committed = null, commitTimer = null, moving = false, scaledAtK = 0, framePending = false;   // moving: glide or camera animation
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
  const r = view.k / committed.k;
  // zoomed far enough that sliding markers would look wrong: re-lay-out now
  if (r > 1.9 || r < .55) return render();
  blitBase();
  svg.style.transform = `translate(${view.x - r * committed.x}px, ${view.y - r * committed.y}px) scale(${r})`;
}
function render() {
  clearTimeout(commitTimer);
  clampView();
  committed = { ...view };
  if (ptrs.size || moving) blitBase(); else drawBase();
  svg.style.transform = '';
  world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  // marker sizes only depend on zoom, so a plain pan skips rewriting ~200 transforms
  if (view.k !== scaledAtK) {
    scaledAtK = view.k;
    markerScale = 1 / Math.pow(view.k, 0.62);
    for (const m of markers) m.setAttribute('transform', `translate(${m.dataset.x} ${m.dataset.y}) scale(${markerScale})`);
    for (const g of areaLabels) g.setAttribute('transform', `translate(${g.dataset.x} ${g.dataset.y}) scale(${markerScale})`);
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
  const scr = p => ({ x: view.x + view.k * p.x, y: view.y + view.k * p.y });
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
    const dot = grank(it) >= 0 && pills.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
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
    const t = it.el.querySelector(':scope > text');
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
const clampK = k => Math.max(0.25, Math.min(10, k));
function zoomAt(px, py, f) {
  const nk = clampK(view.k * f), r = nk / view.k;
  view.x = px - (px - view.x) * r; view.y = py - (py - view.y) * r; view.k = nk; apply();
}
let anim = null;
function animateTo(target) {
  cancelAnimationFrame(anim); cancelAnimationFrame(glide);
  if (reduced) { Object.assign(view, target); render(); return; }
  // Fly the centre of the screen in a straight line while zoom changes
  // geometrically, so places don't drift sideways; long hops ease out a
  // little and back in, like Apple Maps.
  const W = vw / 2, H = vh / 2, from = { ...view };
  const c0 = { x: (W - from.x) / from.k, y: (H - from.y) / from.k }, c1 = { x: (W - target.x) / target.k, y: (H - target.y) / target.k };
  const hop = Math.hypot(c1.x - c0.x, c1.y - c0.y) * Math.min(from.k, target.k) / Math.max(W, H);
  const lift = Math.min(0.45, Math.max(0, hop - 0.6) * 0.25);
  const dur = Math.min(900, 480 + hop * 120), t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.exp(-7 * p) * (1 + 7 * p);          // critically damped, no overshoot
    const k = from.k * Math.pow(target.k / from.k, e) * (1 - lift * Math.sin(Math.PI * e));
    const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e;
    view.k = k; view.x = W - cx * k; view.y = H - cy * k;
    if (p < 1) { moving = true; apply(); anim = requestAnimationFrame(step); } else { moving = false; Object.assign(view, target); render(); }
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
function fitBox(x0, y0, x1, y1, pad = 20, maxK = 4, instant = false) {
  const R = visibleRect(), w = Math.max(x1 - x0, 30), h = Math.max(y1 - y0, 30);
  const k = clampK(Math.min((R.r - R.l - pad * 2) / w, (R.b - R.t - pad * 2) / h, maxK));
  const target = { k, x: (R.l + R.r) / 2 - k * (x0 + x1) / 2, y: (R.t + R.b) / 2 - k * (y0 + y1) / 2 };
  if (instant) { Object.assign(view, target); render(); } else animateTo(target);
}
function fitItems(list, pad, maxK, instant) {
  const xs = list.map(i => i.x), ys = list.map(i => i.y);
  fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), pad, maxK, instant);
}
const fitAll = instant => fitBox(MAP_BOUNDS.x0, MAP_BOUNDS.y0, MAP_BOUNDS.x1, MAP_BOUNDS.y1, 4, 4, instant);
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
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinch) { zoomAt(mid.x, mid.y, d / pinch.d); view.x += mid.x - pinch.mid.x; view.y += mid.y - pinch.mid.y; apply(); }
    pinch = { d, mid }; moved = 99; panned = false;
  }
});
function nearestMarker(cx, cy, maxPx = 24) {
  let best = null, bd = maxPx;
  for (const m of markers) {
    if (!m.dataset.id || m.getBoundingClientRect().width === 0) continue;
    const sx = view.x + view.k * +m.dataset.x, sy = view.y + view.k * +m.dataset.y, d = Math.hypot(sx - cx, sy - cy);
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
$('#conCap').innerHTML = 'ABC'.split('').map(c => `<button class="shape-btn" data-zoom="${c}" aria-label="Zoom to Concourse ${c}">${badgeSvg(c, 28)}</button>`).join('');
document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { buzz(); fitCon(b.dataset.zoom); });

// ---------- Walking puck that travels the route ----------
let routePts = [], routeLens = [], routeTotal = 0, puckRAF = null;
function placePuck(p) {
  if (!routePts.length) { puckG.setAttribute('opacity', 0); return; }
  p = p || puckG._p || routePts[0];
  puckG._p = p;
  puckG.setAttribute('opacity', 1);
  puckG.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${markerScale})`);
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
function setRoute(nodes, mins) {
  for (const m of markers) m.classList.remove('dest');
  const endGate = id => ITEMS[id] && ITEMS[id].kind === 'gate' ? ITEMS[id] : null;
  const g0 = nodes.length > 1 && endGate(nodes[0]), g1 = nodes.length > 1 && endGate(nodes[nodes.length - 1]);
  if (g0) g0.el.classList.add('dest'); if (g1) g1.el.classList.add('dest');
  svg.classList.toggle('gate-start', !!g0); svg.classList.toggle('gate-end', !!g1);
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
    escBadges.push({ g, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
  floor = f; svg.dataset.floor = f;
  document.querySelectorAll('#floorCap [data-floor]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.floor === f)));
  $('#floorCap').style.setProperty('--i', f === 'lo' ? 1 : 0);
  if (routeDrawn >= 1) drawRoute(1);
  if (committed) render();
  if (!quiet) { buzz(5); toast(FLOOR_NAME[f]); }
}
document.querySelectorAll('#floorCap [data-floor]').forEach(b => b.onclick = () => setFloor(b.dataset.floor));
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
function setLocState(state) {
  locBtn.classList.toggle('busy', state === 'busy');
  locBtn.setAttribute('aria-pressed', String(state === 'follow'));
  following = state === 'follow';
}
function nearestWalkNode(p) {
  let best = null, bd = Infinity;
  for (const id in NODE) {
    if (/^(g|m|v):/.test(id)) continue;          // walkway points only, not destinations
    const d = dist(NODE[id], p); if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function onFix(pos) {
  const { latitude, longitude, accuracy, heading, speed } = pos.coords;
  const p = toMap(latitude, longitude), far = Math.hypot(p.x, p.y);
  me = { ...p, acc: accuracy };
  meG.setAttribute('opacity', 1);
  meAcc.setAttribute('r', Math.max(accuracy, 4));
  const moving = heading != null && !isNaN(heading) && (speed || 0) > 0.5;
  meCone.setAttribute('opacity', moving ? 1 : 0);
  if (moving) meCone.setAttribute('transform', `rotate(${heading})`);
  placeDecor();
  if (far > 2500) {
    if (firstFix) toast(`You’re ${(far / 1609).toFixed(1)} miles from ${AP.code}. Your dot will appear when you’re at the airport.`);
    firstFix = false; setLocState('on'); return;
  }
  // "My location" can start a route once we're at the airport
  const node = nearestWalkNode(p);
  ITEMS['v:me'] = { id: 'v:me', kind: 'place', name: 'My location', node, zone: 'L', x: p.x, y: p.y, el: meG };
  navFix(p);
  if (pendingMe) { $('#' + pendingMe).value = 'v:me'; pendingMe = null; meNode = null; if (tab === 'dir' && !placeMode) updateRoute(true); }
  if (node !== meNode) {
    meNode = node;
    if ($('#from').value === 'v:me' && tab === 'dir' && !placeMode) updateRoute(false);
  }
  if (firstFix || following) {
    const r = Math.max(accuracy, 30);
    fitBox(p.x - r, p.y - r, p.x + r, p.y + r, 20, 3.2);
    if (firstFix) setLocState('follow');
  }
  firstFix = false;
}
function onLocError(err) {
  setLocState('off');
  const app = window.CLEApp;
  if (err.code === 1) toast(app ? 'Location is off for ' + APP_NAME + '. Allow it in Settings to see where you are.' : 'This page can’t use your location. Open the Android app to see where you are.',
    app && app.openSettings ? () => app.openSettings() : null);
  else if (err.code === 2) toast('Can’t find your location. Turn on Location in your phone’s quick settings.');
  else toast('Finding your location is taking too long. Try again near a window.');
  stopLocating(true);
}
function stopLocating(keepDot) {
  if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (!keepDot) { me = null; meG.setAttribute('opacity', 0); }
}
function startLocating() {
  if (!navigator.geolocation) { toast('Location isn’t available on this device.'); return; }
  setLocState('busy'); firstFix = true;
  watchId = navigator.geolocation.watchPosition(onFix, onLocError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
locBtn.onclick = () => {
  buzz();
  if (watchId == null) startLocating();
  else if (!following && me && Math.hypot(me.x, me.y) <= 2500) { setLocState('follow'); const r = Math.max(me.acc, 30); fitBox(me.x - r, me.y - r, me.x + r, me.y + r, 20, 3.2); }
  else { setLocState('off'); stopLocating(false); }
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
  $('#title').textContent = name === 'dir' && mode === 'arr' ? 'Arrivals' : TAB_TITLES[name];
  $('#eyebrow').innerHTML = `<span class="ap-code">${esc(AP.code)}</span><span class="ap-name">${esc(AP.short)}</span>`; $('#eyebrow').classList.add('can');
  $('#title').hidden = true;
  if (selected) { selected.el.classList.remove('sel'); selected = null; }
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
  if (it.lvl && it.lvl !== floor) setFloor(it.lvl); else cullLabels();
  placeMode = true;
  $('#seg').hidden = true; $('#closePlace').hidden = false; $('#modeSw').hidden = true;
  $('#eyebrow').classList.remove('can'); openAirports(false); $('#title').hidden = false;
  ['dir', 'kill', 'air'].forEach(t => $('#pane-' + t).hidden = true);
  const pane = $('#pane-place'); pane.hidden = false; replay(pane); replay($('#title'));
  $('#title').textContent = it.name; $('#title').classList.toggle('long', it.name.length > 22);
  $('#eyebrow').textContent = it.kind === 'gate' ? `Concourse ${it.con}` : it.kind === 'amen' ? CATS[it.cat].label : (it.node === ROLE.checkpoint ? 'Main terminal' : 'Arrive & depart');
  const tile = $('#placeTile'); tile.innerHTML = tileFor(it); tile.hidden = false; replay(tile.firstChild);
  // walk time from wherever directions currently start (security if that's this place)
  const fromIt = ITEMS[$('#from').value] && $('#from').value !== it.id ? ITEMS[$('#from').value] : ITEMS[CHK];
  const walk = fromIt !== it ? route(fromIt, it) : null;
  const hs = hoursStatus(it);
  const summary = [];
  if (hs) summary.push(`<span class="${hs.state === 'open' ? 'ok' : hs.state === 'closed' ? 'no' : 'warn'}">${esc(hs.text)}</span>`);
  if (it.kind === 'amen') summary.push(`<span>${esc(it.near)}</span>`);
  if (it.kind === 'gate') summary.push(`<span class="marks">${AIRLINES.filter(a => a.con === it.con).slice(0, 5).map(a => airMark(a, 20)).join('')}</span>`);
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
  if (it.hours) rows.push(['Schedule', esc(hoursLine(it))]);
  if (it.kind === 'amen' && it.cat !== 'rest') rows.push(['Typical visit', `About ${it.dwell} min`]);
  if (walk && walk.path && fromIt.id !== CHK) rows.push([`From ${esc(fromIt.label || fromIt.name)}`, `${minutes(walk.units)} min · ${meters(walk.len)} m`]);
  if (it.zone !== 'L' && it.id !== CHK) {
    const { units, len } = route(ITEMS[CHK], it);
    rows.push(['From security', `${minutes(units)} min · ${meters(len)} m`]);
  }
  if (it.kind === 'gate') rows.push(['Concourse', `${it.con} · ${CON_RANGE[it.con]}`]);
  if (rows.length) html += `<div class="group">${rows.map(([k, v]) => `<div class="row"><span class="rl" style="flex:none">${k}</span><span style="flex:1;min-width:0;color:var(--label-2);text-align:right">${v}</span></div>`).join('')}</div>`;
  if (it.kind === 'gate') {
    html += `<div class="group-title">Airlines in Concourse ${it.con}</div><div class="group tags">${AIRLINES.filter(a => a.con === it.con).map(a => `<span class="tag air-tag">${airMark(a, 22)}${esc(a.name)}</span>`).join('')}</div>`;
  }
  if (it.hours && !it.hours.h24 && !it.hours.close) html += `<p class="foot" style="margin:-6px 16px 0">Opening times from the airport's directory. Closing times aren't published; they follow the last flights.</p>`;
  const near = it.kind !== 'place' ? nearbyItems(it) : [];
  if (near.length) html += `<div class="group-title">Nearby</div><div class="near">${near.map(o => {
    const s = hoursStatus(o), m = Math.max(1, Math.round(dist(o, it) / M_PER_MIN));
    return `<button data-near="${o.id}">${tileFor(o)}<b>${esc(o.name)}</b><small>${s && s.state === 'closed' ? 'Closed' : m + ' min walk'}</small></button>`;
  }).join('')}</div>`;
  pane.innerHTML = html;
  pane.querySelector('[data-act="to"]').onclick = () => { buzz(); $('#to').value = it.id; if ($('#from').value === it.id) $('#from').value = CHK; setTab('dir', true); if (!wide()) setDetent('peek'); updateRoute(true); };
  pane.querySelectorAll('[data-near]').forEach(b => b.onclick = () => { buzz(5); showPlace(ITEMS[b.dataset.near], false); });
  pane.querySelector('[data-act="from"]').onclick = () => { buzz(); $('#from').value = it.id; if ($('#to').value === it.id) $('#to').value = CHK; setTab('dir', true); if (!wide()) setDetent('peek'); updateRoute(true); };
  sheetBody.scrollTop = 0;
  if (!wide()) setDetent(detent === 'full' || detent === 'peek' ? 'half' : detent);
  if (!fromMap) fitItems([it], 60, 3.5);
  else requestAnimationFrame(() => {
    // keep the tapped marker in view above the sheet
    const R = visibleRect(), sx = view.x + view.k * it.x, sy = view.y + view.k * it.y;
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
  fitItems(pts.length > 1 ? pts : [routePts[L.ia], routePts[L.ib]], 30, 3.6);
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
  const gnum = g => +g.code.slice(1);
  for (const con of 'ABC') group(`Concourse ${con} gates`, all.filter(i => i.kind === 'gate' && i.con === con).sort((a, b) => gnum(a) - gnum(b)));
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
    const meta = L ? `<span class="leg"><b>${ch ? icon(ch.lift ? 'lift' : 'swap') : ''}${Math.max(1, Math.round(d / M_PER_MIN))} min</b>${d} m</span>` : '';
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
  const crossesSecurity = path.some((n, i) => i && ((n === ROLE.checkpoint && path[i - 1] === ROLE.hub) || (n === ROLE.hub && path[i - 1] === ROLE.checkpoint)));
  let lastLabel = a.kind === 'place' ? a.node : null;
  const passed = [], via = [];
  for (let i = 1; i < path.length - 1; i++) {
    const n = path[i];
    if (V[n] && V[n][2] && n !== lastLabel) {
      let note = '';
      if (n === ROLE.checkpoint && crossesSecurity) note = path.indexOf(ROLE.hub) > i ? (path[i - 1] === ROLE.baggage || lastLabel === ROLE.baggage || lastLabel === ROLE.transit ? 'Take the escalators up, screen through TSA, then continue straight ahead' : 'Screen through TSA, then continue straight ahead') : 'Leave through the exit lane';
      if (n === ROLE.ticketing && path[i + 1] === ROLE.baggage) note = 'Take the escalator down a level';
      if (n === ROLE.baggage && path[i - 1] === ROLE.ticketing) note = 'Lower level';
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
function updateRoute(fit) {
  if (mode === 'arr') return updateArrival(fit);
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
  $('#hero').className = 'hero';
  $('#hero').innerHTML = `<button class="hero-x" id="clearRoute" aria-label="Clear route">${icon('x')}</button><span class="num">${minutes(units)}<small>min</small></span>
    <span class="m1">${meters(len)} m walk${lift ? ' · elevator' : ''}</span>
    <span class="m2">Arrive ${clock(Date.now() + minutes(units) * 60000)}${via.length ? ' via ' + listJoin(via.slice(0, 3).map(esc)) : ''}</span>
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
  const gate = ITEMS[$('#arrGate').value], dest = ITEMS[$('#arrDest').value], bag = ITEMS['v:' + ROLE.baggage];
  const bags = $('#arrBags').checked, car = parseInt($('#arrCarousel').value, 10);
  $('#carRow').hidden = !bags;
  const p1 = route(gate, bag), p2 = route(bag, dest);
  const path = p1.path.concat(p2.path.slice(1)), units = p1.units + p2.units, len = p1.len + p2.len;
  setRoute(path, minutes(units));
  const { steps, passed } = describe(path, gate, dest);
  for (const s of steps) {
    if (s.node === ROLE.ticketing) { s.t = 'Escalators down to the lower level'; s.n = ''; }
    if (s.node === ROLE.checkpoint) { s.t = 'Exit lane by the security checkpoint'; s.n = (stepFree ? '' : 'Then take the escalators down to baggage claim. ') + 'Once you’re through, you can’t go back to the gates.'; }
    if (s.node === ROLE.baggage && !s.end) {
      s.n = !bags ? 'No bags? Walk straight through.'
        : car > 0 ? `Carousel ${car}. Bags usually arrive 15–25 min after landing.`
        : 'Your carousel is on the arrival screens by the escalators. Bags usually arrive 15–25 min after landing.';
    }
  }
  const info = ARR_DEST.find(x => x[0] === dest.id);
  if (steps.length && info) steps[steps.length - 1].n = info[2];
  if (dest.id === 'v:' + ROLE.baggage) { const last = steps[steps.length - 1]; last.n = bags ? (car > 0 ? `Carousel ${car}. ` : '') + info[2] : info[2]; }
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
function setMode(m, quiet) {
  mode = m;
  document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#modeSw').style.setProperty('--i', m === 'arr' ? 1 : 0);
  const arr = m === 'arr';
  $('#arrForm').hidden = !arr;
  document.querySelector('#pane-dir .fromto').hidden = arr;
  $('#quick').hidden = arr;
  if (tab === 'dir' && !placeMode) $('#title').textContent = arr ? 'Arrivals' : TAB_TITLES.dir;
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
  if (mode === 'arr') setMode('dep', true);
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
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const minsLeft = () => Math.max(0, Math.round((boardAt - Date.now()) / 60000));
function leavePlan() {
  // walk from where you are (or the Directions start) to your gate, plus 5 minutes' slack
  const gate = ITEMS[$('#ktGate').value], from = ITEMS['v:me'] || ITEMS[$('#from').value];
  const walk = from && from !== gate ? minutes(route(from, gate).units) : 0;
  return { gate, from, walk, at: boardAt - (walk + 5) * 60000 };
}
function updateClock() {
  $('#ktClock').textContent = 'Boarding at about ' + clock(boardAt);
  const p = leavePlan();
  const where = p.from && p.from.id === 'v:me' ? 'from where you are' : p.from ? 'from ' + p.from.name : '';
  $('#ktLeave').innerHTML = (p.at <= Date.now() ? `Head to ${esc(p.gate.name)} <b>now</b>` : `Head to ${esc(p.gate.name)} by <b>${clock(p.at)}</b>`)
    + `<small>${p.walk} min walk ${esc(where)}</small>`;
  const rb = $('#remind');
  rb.hidden = !(window.CLEApp && CLEApp.scheduleReminder);
  const on = reminderAt > Date.now();
  rb.setAttribute('aria-pressed', String(on));
  rb.querySelector('span').textContent = on ? `Reminder at ${clock(reminderAt)} · Cancel` : 'Remind me when to leave';
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
  updateRoute(true); showPlace(it, true);
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
for (const con of 'ABC') {
  const gates = Object.values(ITEMS).filter(it => it.kind === 'gate' && it.con === con);
  const legs = gates.map(g => ({ g, m: minutes(route(ITEMS[CHK], g).units) })).sort((x, y) => x.m - y.m);
  if (legs.length) CON_WALK[con] = { min: legs[0].m, max: legs[legs.length - 1].m, near: legs[0].g, gates: gates.sort((x, y) => parseInt(x.code.slice(1)) - parseInt(y.code.slice(1))) };
}
const walkRange = con => { const w = CON_WALK[con]; return !w ? '' : w.min === w.max ? `${w.min} min` : `${w.min}–${w.max} min`; };
$('#airlines').innerHTML = 'ABC'.split('').map(con => `
  <div class="group-title">${badgeSvg(con, 22)}Concourse ${con} · ${CON_RANGE[con]}<span class="gt-walk">${icon('walk')}${walkRange(con)}</span></div>
  <div class="group" style="--inset:16px">${AIRLINES.map((a, i) => a.con !== con ? '' : `
    <button class="row air-row" data-i="${i}">${airMark(a, 38)}
      <span class="grow"><span class="t">${esc(a.name)}</span>${a.note ? `<span class="s">${esc(a.note)}</span>` : ''}</span>
      <svg class="ico chev"><use href="#i-chev"/></svg>
    </button>`).join('')}</div>`).join('');
function highlightAirline(a) {
  buzz();
  highlight(Object.values(ITEMS).filter(it => it.kind === 'gate' && it.con === a.con).map(it => it.id));
  setRoute([]);
  if (!wide() && detent !== 'peek') setDetent('peek');
  fitCon(a.con);
}
// An airline's card: where it flies from, how far that is, and its gates
function showAirline(a) {
  buzz();
  if (selected) { selected.el.classList.remove('sel'); selected = null; }
  setPin(null); setRoute([]); setFloor('up', true);
  highlight(Object.values(ITEMS).filter(it => it.kind === 'gate' && it.con === a.con).map(it => it.id));
  placeMode = true;
  $('#seg').hidden = true; $('#closePlace').hidden = false; $('#modeSw').hidden = true;
  $('#eyebrow').classList.remove('can'); openAirports(false); $('#title').hidden = false;
  ['dir', 'kill', 'air'].forEach(t => $('#pane-' + t).hidden = true);
  const pane = $('#pane-place'); pane.hidden = false; replay(pane); replay($('#title'));
  $('#title').textContent = a.name; $('#title').classList.remove('long');
  $('#eyebrow').textContent = a.code ? `Airline · ${a.code}` : 'Airline';
  const tile = $('#placeTile'); tile.innerHTML = airMark(a, 44); tile.hidden = false; replay(tile.firstChild);
  const w = CON_WALK[a.con], others = AIRLINES.filter(o => o.con === a.con && o !== a);
  let html = `<p class="summary"><span>Concourse ${a.con}</span><span>Gates ${esc(CON_RANGE[a.con])}</span></p>`;
  html += `<div class="bgroup">
    <button class="primary" data-act="walk">${icon('walk')}Directions${w ? `<span class="sub">${w.min} min</span>` : ''}</button>
    <button data-act="show">${badgeSvg(a.con, 22)}Show gates</button></div>`;
  const rows = [
    ['Check in', `${esc(ITEMS['v:' + ROLE.ticketing] ? ITEMS['v:' + ROLE.ticketing].name.replace(/\s*\(.*\)$/, '') : 'Ticketing')}, upper level`],
    ['From security', `${walkRange(a.con)} walk`],
  ];
  if (a.note) rows.unshift(['Flies', esc(a.note)]);
  html += `<div class="group">${rows.map(([k, v]) => `<div class="row"><span class="rl" style="flex:none">${k}</span><span style="flex:1;min-width:0;color:var(--label-2);text-align:right">${v}</span></div>`).join('')}</div>`;
  if (w) html += `<div class="group-title">Gates</div><div class="gate-chips">${w.gates.map(g => `<button data-gate="${g.id}" class="gate-chip ${g.con}">${esc(g.code)}</button>`).join('')}</div>`;
  if (others.length) html += `<div class="group-title">Also in Concourse ${a.con}</div><div class="group tags">${others.map(o => `<button class="tag air-tag" data-air="${AIRLINES.indexOf(o)}">${airMark(o, 22)}${esc(o.name)}</button>`).join('')}</div>`;
  html += `<p class="foot" style="margin:-6px 16px 0">Gates change, so check your boarding pass and the departure screens.</p>`;
  pane.innerHTML = html;
  pane.querySelector('[data-act="walk"]').onclick = () => {
    if (!w) return; buzz(); $('#from').value = CHK; $('#to').value = w.near.id; setTab('dir', true); if (!wide()) setDetent('peek'); updateRoute(true);
  };
  pane.querySelector('[data-act="show"]').onclick = () => { buzz(5); if (!wide()) setDetent('peek'); fitCon(a.con); };
  pane.querySelectorAll('[data-gate]').forEach(b => b.onclick = () => { buzz(5); showPlace(ITEMS[b.dataset.gate], false); });
  pane.querySelectorAll('[data-air]').forEach(b => b.onclick = () => showAirline(AIRLINES[+b.dataset.air]));
  sheetBody.scrollTop = 0;
  if (!wide()) setDetent('half');
  fitCon(a.con);
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
  const air = AIRLINES.map(a => ({ a, sc: Math.max(score(a.name, s), !isGateCode && a.code && a.code.toLowerCase() === s ? 3 : 0) })).filter(x => x.sc)
    .sort((x, y) => y.sc - x.sc)
    .map(({ a }) => ({ label: a.name, kind: `Airline · Concourse ${a.con} · ${CON_RANGE[a.con]}`, lead: airMark(a, 30), go: () => showAirline(a) }));
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
    const sc = Math.max(score(it.name, s), it.cat && cats.includes(it.cat) ? 1.5 : 0);
    if (!sc) continue;
    const key = it.name + '|' + (it.gate || it.zone); if (seen.has(key)) continue; seen.add(key);
    places.push({ it, sc, w: walk(it) });
  }
  const gnum = it => +it.code.replace(/\D/g, '');
  gates.sort((x, y) => (x.code.toLowerCase() === code ? -1 : 0) - (y.code.toLowerCase() === code ? -1 : 0) || gnum(x) - gnum(y));
  // strong name matches first, then by walk; within a category search, purely by walk
  const strong = p => cats.length ? p.sc >= 3 && !CATS[p.it.cat]?.label.toLowerCase().startsWith(s) : p.sc >= 2;
  places.sort((x, y) => strong(y) - strong(x) || (x.w ?? 999) - (y.w ?? 999) || y.sc - x.sc);
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

// ---------- Remember the trip between launches ----------
const TRIP_KEY = AP.code === 'CLE' ? 'trip' : 'trip.' + AP.code;
function saveTrip() {
  const keep = v => v === 'v:me' ? null : v;
  store.set(TRIP_KEY, { from: keep($('#from').value), to: keep($('#to').value), gate: $('#ktGate').value, boardAt, reminderAt, cat: ktCat, tab,
    mode, stepFree, arr: { gate: $('#arrGate').value, dest: $('#arrDest').value, bags: $('#arrBags').checked, car: $('#arrCarousel').value } });
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
  if (t.mode === 'arr') mode = 'arr';
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
if (mode === 'arr') setMode('arr', true);
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
