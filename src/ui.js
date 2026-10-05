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
    'walk', 'route', 'conA', 'conB', 'conC', 'corridor', 'stairs']) p[k] = g(k);
  for (const c of 'ABC') p['term' + c] = /^#[0-9a-f]{6}$/i.test(p['con' + c]) && /^#[0-9a-f]{6}$/i.test(p.bldg) ? hexMix(p['con' + c], p.bldg, c === 'A' ? .09 : .08) : p.bldg;
  return p;
}
const repaint = () => { pal = null; if (committed) render(true); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
function drawBase() {
  pal = pal || readPalette();
  const c = bctx, k = view.k;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = pal.map; c.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
  c.setTransform(dpr * k, 0, 0, dpr * k, dpr * (view.x + ox), dpr * (view.y + oy));
  c.lineCap = c.lineJoin = 'round';
  const fill = (key, color) => { if (P2[key]) { c.fillStyle = color; c.fill(P2[key], 'evenodd'); } };
  const stroke = (key, color, w, dash) => { if (P2[key]) { c.strokeStyle = color; c.lineWidth = w; c.setLineDash(dash || []); c.stroke(P2[key]); } };
  fill('grass', pal.grass); fill('wood', pal.wood); fill('water', pal.water);
  fill('apron', pal['apron-pave']); fill('lots', pal.lot); fill('ramp', pal['apron-pave']);
  stroke('taxiway', pal.taxi, 23); stroke('runway', pal.runway, 46);
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
  c.save(); c.translate(1.5, 3.5); c.fillStyle = pal['bldg-shadow'];
  for (const t of ['termM', 'termA', 'termB', 'termC', 'termD']) if (P2[t]) c.fill(P2[t]);
  c.restore();
  const edge = 1 / Math.max(k, .5);
  fill('termD', pal['term-closed']); stroke('termD', pal['bldg-edge'], edge, [3, 2]);
  fill('termM', pal.bldg); stroke('termM', pal['bldg-edge'], edge);
  // the concourses only have an upper level, so they fade back on the lower floor
  const lower = floor === 'lo';
  for (const t of 'ABC') { fill('term' + t, lower ? pal['term-closed'] : pal['term' + t]); stroke('term' + t, pal['bldg-edge'], edge, lower ? [3, 2] : null); }
  if (!lower) stroke('bridges', pal.bridge, 3.6);
  // this floor's walkways (OpenStreetMap indoor ways) and the escalators between floors
  stroke(lower ? 'walk0' : 'walk1', pal.corridor, 3.4);
  if (lower) stroke('walkm1', pal.corridor, 3.4, [4, 3]);
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
const lbl = (x, y, t, anchor = 'middle') => {
  const g = el('g', { class: 'area-lbl' }); g.dataset.x = x; g.dataset.y = y;
  el('text', { class: 'map-lbl', 'text-anchor': anchor }, g).textContent = t;
  g._w = t.length * 6.3; g._anchor = anchor;
  areaLabels.push(g);
};
for (const [x, y, t, anchor] of AP.ui.labels) lbl(x, y, t, anchor);

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
    el('rect', { class: 'pill', x: -w / 2, y: -5.5, width: w, height: 11, rx: 5.5 }, pop);
    el('text', { y: .4 }, pop).textContent = it.code;
  } else if (it.kind === 'amen') {
    g = el('g', { class: 'mk amen', 'data-id': it.id, 'data-cat': it.cat }, layerAmen);
    const sz = el('g', { class: 'sz' }, el('g', { class: 'pop' }, g));
    if (it.cat === 'rest') el('rect', { class: 'sym', x: -5, y: -5, width: 10, height: 10, rx: 3 }, sz);
    else el('circle', { class: 'sym', r: 5.2 }, sz);
    el('use', { class: 'glyph', href: '#i-' + (it.icon || it.cat), x: -3.6, y: -3.6, width: 7.2, height: 7.2 }, sz);
    el('text', { x: 8, y: 2 }, g).textContent = it.name;
  } else {
    g = el('g', { class: 'mk place', 'data-id': it.id }, layerPlaces);
    const sz = el('g', { class: 'sz' }, el('g', { class: 'pop' }, g));
    el('circle', { class: 'sym', r: 5.4 }, sz);
    el('use', { class: 'glyph', href: '#i-place', x: -3.6, y: -3.8, width: 7.2, height: 7.2 }, sz);
    el('text', { x: 9, y: 2.2 }, g).textContent = it.name;
  }
  if (it.kind !== 'gate') it.lw = it.name.length * (it.kind === 'place' ? 3.75 : 3.4) + 6;
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
let pinItem = null;
function setPin(it) {
  pinItem = it && it.kind !== 'gate' ? it : null;
  if (!pinItem) { pinG.setAttribute('opacity', 0); return; }
  pinG.dataset.cat = pinItem.cat || 'place';
  pinUse.setAttribute('href', '#i-' + (pinItem.icon || pinItem.cat || 'place'));
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
  const W = innerWidth, H = innerHeight, m = 90;
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
  baseCanvas.width = Math.round(innerWidth * dpr); baseCanvas.height = Math.round(innerHeight * dpr);
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
  drawBase();
  svg.style.transform = `translate(${view.x - r * committed.x}px, ${view.y - r * committed.y}px) scale(${r})`;
}
function render() {
  clearTimeout(commitTimer);
  clampView();
  committed = { ...view };
  drawBase();
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
  for (const it of Object.values(ITEMS)) if ((it.kind === 'gate' || it.kind === 'place') && !away(it)) {
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
  const chrome = (chromeCache || (chromeCache = ['.controls', '.topbar', '#sheet'].map(s => document.querySelector(s).getBoundingClientRect())))
    .map(c => ({ l: c.left, r: c.right, t: c.top, b: c.bottom }));
  if (pinItem) {
    const p = scr(pinItem), pu = u * 1.15;
    taken.push({ l: p.x - 11 * pu, r: p.x + 11 * pu, t: p.y - 30 * pu, b: p.y - 3 * pu });
  }
  if (routePts.length > 1 && eta.getAttribute('opacity') === '1') {
    const m = scr(pointAt(routeTotal * 0.5)), w = +etaRect.getAttribute('width') / 2;
    taken.push({ l: m.x - w * u, r: m.x + w * u, t: m.y - 30 * u, b: m.y - 7 * u });
  }
  const offscreen = r => r.r < 0 || r.l > innerWidth || r.b < 0 || r.t > innerHeight;
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
    const ok = !offscreen(r) && !chrome.some(c => hit(r, c)) && !taken.some(o => hit(r, o)) && !dots.some(o => hit(r, o)) && !onRoute(r);
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
  const from = { ...view }, t0 = performance.now(), dur = 650;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    // critically-damped spring-ish ease with a whisper of overshoot
    const e = 1 - Math.exp(-7 * p) * (1 + 7 * p) * (1 - p * .02) ;
    const kk = from.k * Math.pow(target.k / from.k, e);
    view.k = kk; view.x = from.x + (target.x - from.x) * e; view.y = from.y + (target.y - from.y) * e;
    if (p < 1) { moving = true; apply(); anim = requestAnimationFrame(step); } else { moving = false; Object.assign(view, target); render(); }
  };
  anim = requestAnimationFrame(step);
}
function visibleRect() {
  const W = innerWidth, H = innerHeight;
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
  const b = $('#toastAct'); b.hidden = !action; b.textContent = label; b.onclick = () => { toastEl.hidden = true; action(); };
  toastEl.hidden = false; replay(toastEl);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 7000 : 4200);
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
  if (d === 'half') return Math.min(H, Math.round(innerHeight * 0.52));
  const first = sheetBody.querySelector('.pane:not([hidden]) > *');
  let extra = first ? Math.min(first.offsetHeight, 132) + 20 : 90;
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
const chips = $('#chips');
for (const [cat, c] of Object.entries(CATS)) {
  const b = document.createElement('button');
  b.className = 'chip'; b.setAttribute('aria-pressed', 'true');
  b.innerHTML = `<span class="tile ${cat}">${icon(cat)}</span>${c.label}`;
  b.onclick = () => {
    const on = b.getAttribute('aria-pressed') === 'true';
    b.setAttribute('aria-pressed', String(!on)); svg.classList.toggle('hide-' + cat, on); buzz(5); cullLabels();
  };
  chips.appendChild(b);
}

// ---------- Tabs ----------
function replay(node) { if (reduced) return; node.classList.remove('enter'); void node.offsetWidth; node.classList.add('enter'); }
const TAB_TITLES = { dir: 'Directions', kill: 'Pass the time', air: 'Airlines' };
let tab = 'dir';
function setTab(name, quiet) {
  tab = name; placeMode = false;
  $('#seg').hidden = false; $('#closePlace').hidden = true; $('#pane-place').hidden = true; $('#modeSw').hidden = name !== 'dir';
  ['dir', 'kill', 'air'].forEach((t, i) => {
    $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    $('#pane-' + t).hidden = t !== name;
    if (t === name) $('#seg').style.setProperty('--i', i);
  });
  replay($('#pane-' + name)); replay($('#title'));
  $('#title').textContent = name === 'dir' && mode === 'arr' ? 'Arrivals' : TAB_TITLES[name];
  $('#eyebrow').textContent = `${AP.short} · ${AP.code}`; $('#eyebrow').classList.add('can');
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
function nearbyNames(it, n = 6) {
  return Object.values(ITEMS)
    .filter(o => o.kind === 'amen' && o.cat !== 'rest' && o !== it && dist(o, it) < 34)
    .sort((a, b) => dist(a, it) - dist(b, it))
    .map(o => o.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, n);
}
const tileFor = it => it.kind === 'gate' ? `<span class="tile ${it.con}">${icon('gate')}</span>`
  : it.kind === 'amen' ? `<span class="tile ${it.cat}">${icon(it.icon || it.cat)}</span>` : `<span class="tile place">${icon('place')}</span>`;
function showPlace(it, fromMap) {
  if (!it) return;
  if (selected) selected.el.classList.remove('sel');
  selected = it; it.el.classList.add('sel'); setPin(it);
  if (it.lvl && it.lvl !== floor) setFloor(it.lvl); else cullLabels();
  placeMode = true;
  $('#seg').hidden = true; $('#closePlace').hidden = false; $('#modeSw').hidden = true;
  $('#eyebrow').classList.remove('can'); openAirports(false);
  ['dir', 'kill', 'air'].forEach(t => $('#pane-' + t).hidden = true);
  const pane = $('#pane-place'); pane.hidden = false; replay(pane); replay($('#title'));
  $('#title').textContent = it.name;
  $('#eyebrow').textContent = it.kind === 'gate' ? `Concourse ${it.con}` : it.kind === 'amen' ? CATS[it.cat].label : (it.node === ROLE.checkpoint ? 'Main terminal' : 'Arrive & depart');
  let html = `<div class="bgroup">
    <button class="primary" data-act="to">${icon('walk')}Directions</button>
    <button data-act="from">${icon('flag')}Start here</button></div>`;
  const rows = [];
  if (it.kind === 'amen') rows.push(['Location', esc(it.near)]);
  if (it.note) rows.push(['About', esc(it.note)]);
  const hs = hoursStatus(it);
  if (hs) rows.push(['Hours', `<span class="status ${hs.state === 'open' ? 'ok' : hs.state === 'closed' ? 'no' : 'warn'}">${esc(hs.text)}</span>`]);
  if (it.hours) rows.push(['Schedule', esc(hoursLine(it))]);
  if (it.kind === 'amen' && it.cat !== 'rest') rows.push(['Typical visit', `About ${it.dwell} min`]);
  if (it.zone !== 'L' && it.id !== CHK) {
    const { units, len } = route(ITEMS[CHK], it);
    rows.push(['From security', `${minutes(units)} min · ${meters(len)} m`]);
  }
  if (it.zone === 'L' || it.kind === 'place') rows.push(['Level', it.lvl === 'lo' ? 'Lower level' : 'Upper level']);
  if (it.kind === 'gate') rows.push(['Concourse', `${it.con} · ${CON_RANGE[it.con]}`]);
  html += `<div class="group">${rows.map(([k, v]) => `<div class="row"><span class="rl" style="flex:none">${k}</span><span style="flex:1;min-width:0;color:var(--label-2);text-align:right">${v}</span></div>`).join('')}</div>`;
  if (it.kind === 'gate') {
    html += `<div class="group-title">Airlines in Concourse ${it.con}</div><div class="group tags">${AIRLINES.filter(a => a.con === it.con).map(a => `<span class="tag">${esc(a.name)}</span>`).join('')}</div>`;
  }
  if (it.hours && !it.hours.h24 && !it.hours.close) html += `<p class="foot" style="margin:-6px 16px 0">Opening times from the airport's directory. Closing times aren't published; they follow the last flights.</p>`;
  const near = it.kind !== 'place' ? nearbyNames(it) : [];
  if (near.length) html += `<div class="group-title">Nearby</div><div class="group tags">${near.map(n => `<span class="tag">${esc(n)}</span>`).join('')}</div>`;
  pane.innerHTML = html;
  pane.querySelector('[data-act="to"]').onclick = () => { buzz(); $('#to').value = it.id; if ($('#from').value === it.id) $('#from').value = CHK; setTab('dir', true); if (!wide()) setDetent('peek'); updateRoute(true); };
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
      if (am && am !== b && !['rest', 'service'].includes(am.cat) && !/vending/i.test(am.name) && !passed.includes(am.name)) passed.push(am.name);
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
    <span class="m2">${via.length ? 'via ' + via.slice(0, 3).map(esc).join(' · ') : 'Direct'}</span>`;
  $('#steps').innerHTML = steps.map(s => `<li class="${s.end ? 'end' : ''}" data-node="${esc(s.node)}" tabindex="0" role="button"><span class="stop"></span><span><span class="t">${esc(s.t)}</span>${s.n ? `<span class="n">${esc(s.n)}</span>` : ''}</span></li>`).join('')
    + (passed.length ? `<li class="passing">On the way: ${passed.map(esc).join(', ')}</li>` : '');
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
    <span class="m2">${esc(gate.name)} to ${esc(info ? info[1] : dest.name)}</span>`;
  $('#steps').innerHTML = steps.map(s => `<li class="${s.end ? 'end' : ''}" data-node="${esc(s.node)}" tabindex="0" role="button"><span class="stop"></span><span><span class="t">${esc(s.t)}</span>${s.n ? `<span class="n">${esc(s.n)}</span>` : ''}</span></li>`).join('')
    + (passed.length ? `<li class="passing">On the way: ${passed.map(esc).join(', ')}</li>` : '');
  $('#steps').querySelectorAll('[data-node]').forEach(li => {
    const go = () => { const p = NODE[li.dataset.node]; if (!p) return; setFloor(levelOf(li.dataset.node), true); buzz(5); userMoved = true; if (!wide() && detent === 'full') setDetent('half'); fitBox(p.x - 45, p.y - 45, p.x + 45, p.y + 45, 10, 3.6); };
    li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  const ids = [gate.id, dest.id, bag.id];
  for (const n of path) { if (ITEMS[n]) ids.push(n); if (n.startsWith('p:') && ITEMS[n.slice(2)]) ids.push(n.slice(2)); }
  highlight(ids);
  if (fit) { setFloor(levelOf(path[0]), true); fitItems(path.map(n => NODE[n]), 24, 3.5); }
}
function setMode(m, quiet) {
  mode = m;
  document.querySelectorAll('#modeSw [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
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
  $('#ktLeave').innerHTML = p.at <= Date.now()
    ? `Head to ${esc(p.gate.name)} <b>now</b> · ${p.walk} min walk ${esc(where)}`
    : `Head to ${esc(p.gate.name)} by <b>${clock(p.at)}</b> · ${p.walk} min walk ${esc(where)}`;
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
    .sort((p, q) => order[p.status] - order[q.status] || p.walk - q.walk)
    .filter(r => !seen.has(r.i.name) && seen.add(r.i.name));
  lastIdeas = list;
  const label = { ok: 'Fits', warn: 'Tight', no: 'Skip' };
  $('#ideas').style.setProperty('--inset', '58px');
  $('#ideas').innerHTML = list.slice(0, 20).map(r => `
    <button class="row" data-id="${r.i.id}">
      <span class="tile ${r.i.cat}">${icon(r.i.cat)}</span>
      <span class="grow"><span class="t">${esc(r.i.name)}</span><span class="s">${r.walk} min each way · ~${r.i.dwell} min there · ${esc(r.i.gate || 'Main terminal')}</span></span>
      <span class="status ${r.status}">${esc(r.why || label[r.status])}</span>
    </button>`).join('') || '<div class="row"><span class="s">Nothing like that past security.</span></div>';
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
  if (!pool.length) { $('#ktToast').textContent = 'Not enough time to wander. Stay near your gate.'; buzz(30); return; }
  $('#ktToast').textContent = 'Keeps a 10-minute buffer before boarding.';
  buzz(12);
  showIdea(pool[Math.floor(Math.random() * pool.length)].i);
};

// ---------- Airlines ----------
$('#airlines').innerHTML = 'ABC'.split('').map(con => `
  <div class="group-title">${badgeSvg(con, 22)}Concourse ${con} · ${CON_RANGE[con]}</div>
  <div class="group" style="--inset:16px">${AIRLINES.map((a, i) => a.con !== con ? '' : `
    <button class="row" data-i="${i}">
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
$('#airlines').querySelectorAll('[data-i]').forEach(b => b.onclick = () => highlightAirline(AIRLINES[+b.dataset.i]));

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
  const i = needle ? label.toLowerCase().indexOf(needle) : -1;
  return i < 0 ? esc(label) : esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + needle.length)) + '</mark>' + esc(label.slice(i + needle.length));
}
function renderHits(sections, needle) {
  let html = '', n = 0;
  for (const [title, list] of sections) {
    if (!list.length) continue;
    if (title) html += `<div class="sec">${title}</div>`;
    html += list.map(h => `<button data-i="${n}" class="${n++ === active ? 'active' : ''}">${h.lead}<span><span>${mark(h.label, needle)}</span><span class="k">${esc(h.kind)}</span></span></button>`).join('');
  }
  return html;
}
function suggestions() {
  const recent = store.get('recent', []).map(id => ITEMS[id]).filter(Boolean).slice(0, 4);
  const popular = AP.ui.popular.map(id => ITEMS[id])
    .concat(Object.values(ITEMS).filter(i => i.kind === 'amen' && AP.ui.popularRe.test(i.name)))
    .filter(i => !recent.includes(i)).slice(0, 5);
  hits = [...recent.map(itemHit), ...popular.map(itemHit)]; active = -1;
  results.innerHTML = `<div class="sec">Airlines</div><div class="airline-row">${AIRLINES.map((a, i) => `<button data-air="${i}">${badgeSvg(a.con, 24)}${esc(a.name)}</button>`).join('')}</div>`
    + renderHits([['Recent', recent.map(itemHit)], ['Popular', popular.map(itemHit)]]);
  results.hidden = false; wireResults();
}
function runSearch() {
  const s = q.value.trim().toLowerCase();
  $('#qClear').hidden = !s;
  if (!s) { if (document.activeElement === q) suggestions(); else results.hidden = true; return; }
  const code = s.replace(/^gate\s*/, '').replace(/\s+/g, '');
  const air = AIRLINES.filter(a => a.name.toLowerCase().includes(s))
    .map(a => ({ label: a.name, kind: `Airline · Concourse ${a.con} · ${CON_RANGE[a.con]}`, lead: badgeSvg(a.con, 30), go: () => highlightAirline(a) }));
  const gates = [], places = [], seen = new Set();
  for (const it of Object.values(ITEMS)) {
    if (it.id === 'v:me') continue;
    const isGate = it.kind === 'gate' && it.code.toLowerCase().startsWith(code);
    const isName = it.kind !== 'gate' && (it.name.toLowerCase().includes(s) || (it.cat && CATS[it.cat].label.toLowerCase().includes(s)));
    if (!isGate && !isName) continue;
    const key = it.name + kindOf(it); if (seen.has(key)) continue; seen.add(key);
    (isGate ? gates : places).push(itemHit(it));
  }
  const gnum = h => +h.label.replace(/\D/g, '');
  gates.sort((x, y) => gnum(x) - gnum(y));
  places.sort((x, y) => (x.label.toLowerCase().startsWith(s) ? 0 : 1) - (y.label.toLowerCase().startsWith(s) ? 0 : 1));
  const sections = [['', air.slice(0, 3)], ['', gates.slice(0, 6)], ['', places.slice(0, 8)]];
  hits = sections.flatMap(([, l]) => l); active = 0;
  results.innerHTML = hits.length ? renderHits(sections, s.length > 1 || !gates.length ? s : '')
    : `<div class="empty">No results for “${esc(q.value.trim())}”. Try a gate like B6, an airline, or “coffee”.</div>`;
  results.hidden = false; wireResults();
}
function wireResults() {
  results.querySelectorAll('[data-i]').forEach(b => b.onclick = () => pick(+b.dataset.i));
  results.querySelectorAll('[data-air]').forEach(b => b.onclick = () => { results.hidden = true; q.blur(); highlightAirline(AIRLINES[+b.dataset.air]); });
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
  apMenu.hidden = !open; apBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  apMenu.innerHTML = Object.values(AIRPORTS).map(a => `<button role="menuitemradio" aria-checked="${a.code === AP.code}" data-ap="${a.code}">
      <span class="code">${esc(a.code)}</span><span><span>${esc(a.name)}</span><span class="s">${esc(a.city)}</span></span>
      <span style="color:var(--primary)">${a.code === AP.code ? icon('check') : ''}</span></button>`).join('')
    + `<div class="soon">More airports are on the way.</div>`;
  apMenu.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => {
    if (b.dataset.ap === AP.code) return openAirports(false);
    try { localStorage.setItem('cw.airport', b.dataset.ap); } catch (e) {}
    location.reload();
  });
}
apBtn.addEventListener('click', () => { if (!placeMode) { buzz(5); openAirports(apMenu.hidden); } });
document.addEventListener('pointerdown', e => { if (!apMenu.hidden && !e.target.closest('#apMenu, #eyebrow')) openAirports(false); });

// Android back button: close overlays before leaving the app
window.cleBack = () => {
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
