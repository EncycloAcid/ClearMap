// ---------- Active airport ----------
const AP = AIRPORTS[ACTIVE_AIRPORT] || AIRPORTS[Object.keys(AIRPORTS)[0]];
const { GEO, V, EDGES, SPINES, MAP_BOUNDS, AIRLINES, GATE_POS, AMEN } = AP;
const HOURS = AP.HOURS || {};
const ROT = AP.ROT || null;                       // a round rotunda with gates around it (CLE's Concourse C)
const ROT_GATES = new Set(AP.ROT_GATES || []);
const ROLE = AP.roles;
// Concourses in display order, each with a colour and a badge shape
const CONS = AP.concourses.map(c => c.id);
// An airline can fly from several concourses (Delta at ATL); con is the first
for (const a of AIRLINES) { a.cons = a.cons || (a.con ? [a.con] : []); a.con = a.cons[0]; }
// Gate ranges by concourse, e.g. "A1–A34", unless the pack lists them
const gnumOf = g => parseInt(g.replace(/^\D+/, ''), 10) || 0;
const CON_RANGE = AP.CON_RANGE || Object.fromEntries(CONS.map(c => {
  const gs = Object.keys(GATE_POS).filter(g => g[0] === c).sort((a, b) => gnumOf(a) - gnumOf(b));
  return [c, gs.length ? `${gs[0]}–${gs[gs.length - 1]}` : ''];
}));

const CATS = {
  food:    { label: 'Food', dwell: 20 },
  coffee:  { label: 'Coffee & treats', dwell: 8 },
  bar:     { label: 'Bars', dwell: 30 },
  shop:    { label: 'Shops', dwell: 10 },
  play:    { label: 'Play & relax', dwell: 15 },
  service: { label: 'Services', dwell: 10 },
  rest:    { label: 'Restrooms', dwell: 5 },
};


// ---------- Geometry helpers ----------
const P = id => ({ x: V[id][0], y: V[id][1] });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i-1], pts[i]); return L; }
function along(ids, t, side, off = 18) {
  const pts = ids.map(P), L = polyLen(pts);
  let target = Math.min(t, 1) * L, i = 1;
  for (; i < pts.length; i++) { const d = dist(pts[i-1], pts[i]); if (target <= d || i === pts.length - 1) break; target -= d; }
  const a = pts[i-1], b = pts[i], d = dist(a, b), u = Math.min(target / d, 1);
  const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
  const px = dy, py = -dx;               // left of travel direction
  const ahead = t >= 1 ? 14 : 0;
  return { x: a.x + dx * (d * u + ahead) + px * side * off, y: a.y + dy * (d * u + ahead) + py * side * off };
}
const polar = (deg, r) => ({ x: ROT.x + r * Math.cos(deg * Math.PI / 180), y: ROT.y + r * Math.sin(deg * Math.PI / 180) });
// Where a point sits along a spine: fraction t, the projected point, and which side (+1 = left of travel)
function onSpine(ids, p) {
  const pts = ids.map(P), L = polyLen(pts);
  let best = null, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (l * l)));
    const q = { x: a.x + dx * u, y: a.y + dy * u }, d = dist(p, q);
    if (!best || d < best.d) best = { d, q, t: (run + u * l) / L, side: Math.sign((p.x - q.x) * dy / l - (p.y - q.y) * dx / l) || 1 };
    run += l;
  }
  return best;
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - a.x - dx * u, p.y - a.y - dy * u);
}

// ---------- Build items ----------
const ITEMS = {};   // id -> {id, kind, name, x, y, zone, ...}
const gateInfo = {};
for (const [g, [x, y]] of Object.entries(GATE_POS)) {
  const con = g[0], it = { id: 'g:' + g, kind: 'gate', name: 'Gate ' + g, code: g, con };
  if (ROT_GATES.has(g)) {
    // rotunda gates: badge sits just outside the wall, on the jet-bridge side
    const deg = Math.atan2(y - ROT.y, x - ROT.x) * 180 / Math.PI, r = Math.hypot(x - ROT.x, y - ROT.y) + 5;
    gateInfo[g] = { con, deg };
    Object.assign(it, polar(deg, r), { zone: 'R', wall: { x, y } });
  } else {
    const s = onSpine(SPINES[con], { x, y }), d = s.d || 1;
    gateInfo[g] = { con, t: s.t, s: s.side };
    Object.assign(it, { x: x + (x - s.q.x) / d * 5, y: y + (y - s.q.y) / d * 5, zone: con, wall: { x, y } });
  }
  ITEMS[it.id] = it;
}
for (const id of AP.PLACES) {
  const [icon, pk] = (AP.PLACE_STYLE || {})[id] || ['place', 'terminal'];
  ITEMS['v:' + id] = { id: 'v:' + id, kind: 'place', name: V[id][2], node: id, zone: 'L', icon, pk, ...P(id) };
}
const perGate = {};
AMEN.forEach(([name, cat, at, dwell, note], i) => {
  const it = { id: 'm:' + i, kind: 'amen', name, cat, dwell: dwell ?? CATS[cat].dwell, note };
  if (Array.isArray(at) && at.length === 2) {
    // a bare position: snap to the nearest walkway it could be on, and name the nearest gate
    const [x, y] = at, p = { x, y };
    let best = null;
    EDGES.forEach(([a, b, z]) => {
      if (!AP.AMEN_ZONES.includes(z)) return;
      const d = distToSeg(p, P(a), P(b));
      if (!best || d < best.d) best = { d, z };
    });
    let gate = null, gd = AP.NEAR_GATE || 60;
    for (const [g, [gx, gy]] of Object.entries(GATE_POS)) { const d = Math.hypot(gx - x, gy - y); if (d < gd) { gd = d; gate = g; } }
    const zone = best.z;
    Object.assign(it, { x, y, zone, gate, near: gate ? 'Near gate ' + gate : (AP.ui.zoneNames || {})[zone] || 'Main terminal' });
  }
  else if (Array.isArray(at)) {
    const [x, y, zone, gate, floor] = at;
    if (floor) it.floor = floor;
    if (zone === 'LIFT') Object.assign(it, { x, y, zone, lift: gate, near: V[gate][2] });
    else Object.assign(it, { x, y, zone, gate, near: gate ? 'Near gate ' + gate : zone === 'L' ? (floor === 'lo' ? 'Baggage claim' : 'Ticketing hall') : 'Main terminal' });
  }
  else {
    const gi = gateInfo[at], k = perGate[at] = (perGate[at] ?? -1) + 1;
    const shift = (k % 2 ? -1 : 1) * Math.ceil(k / 2);
    it.gate = at; it.near = 'Near gate ' + at;
    if (gi.deg !== undefined) { Object.assign(it, polar(gi.deg + shift * 8 + 3, ROT.r - 17), { zone: 'R' }); }
    else {
      const len = polyLen(SPINES[gi.con].map(P));
      Object.assign(it, along(SPINES[gi.con], Math.min(gi.t, .985) + (shift * 7 - 2) / len, gi.s, 5), { zone: gi.con });
    }
  }
  const hs = HOURS[name]; it.hours = typeof hs === 'function' ? hs(it) : hs;
  // icons that differ from their category's
  it.icon = /lounge|club/i.test(name) && cat === 'play' ? 'play' : /^Elevator$/.test(name) ? 'lift' : /^Escalators$/.test(name) ? 'swap' : /^Carousel \d+$/.test(name) ? 'bag' : /^Water fountain/.test(name) ? 'water' : /^Accessible restroom/.test(name) ? 'access' : cat;
  ITEMS[it.id] = it;
});

// ---------- Floors ----------
// 'up' and 'lo': the two floors the map switches between (see the pack's ui.floors)
const LOWER_V = new Set(AP.LOWER_V);
for (const it of Object.values(ITEMS))
  it.lvl = it.zone === 'LIFT' ? null : it.kind === 'place' ? (LOWER_V.has(it.node) ? 'lo' : 'up') : AP.amenLevel ? AP.amenLevel(it) : 'up';
function levelOf(node) {
  if (node === 'me' || node === 'me@') return meLevel;
  if (V[node]) return LOWER_V.has(node) ? 'lo' : 'up';
  const it = ITEMS[node.startsWith('p:') ? node.slice(2) : node];
  return it && it.lvl ? it.lvl : 'up';
}

// ---------- Graph with every item attached to its nearest walkway ----------
const G = {};   // node -> [{to, w}]
let meLevel = 'up';   // the floor of your location's node (see attachMe in the app)
const NODE = {}; // node -> {x,y}
const addNode = (id, p) => { NODE[id] = p; G[id] = G[id] || []; };
const link = (a, b, kind) => { const w = dist(NODE[a], NODE[b]); G[a].push({ to: b, w, kind }); G[b].push({ to: a, w, kind }); };
for (const id in V) addNode(id, P(id));
const onEdge = EDGES.map(() => []);
function project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return { u, x: a.x + dx * u, y: a.y + dy * u };
}
for (const it of Object.values(ITEMS)) {
  if (it.kind === 'place') continue;
  addNode(it.id, { x: it.x, y: it.y });
  if (it.zone === 'R') { link(it.id, 'crot'); continue; }
  if (it.zone === 'LIFT') { link(it.id, it.lift); continue; }
  let best = null;
  EDGES.forEach(([a, b, z], ei) => {
    if (z !== it.zone) return;
    if (it.lvl && it.zone === 'L' && (levelOf(a) !== it.lvl || levelOf(b) !== it.lvl)) return;   // a landside place joins a walkway on its own floor
    const pr = project(it, P(a), P(b)), d = dist(pr, it);
    if (!best || d < best.d) best = { d, ei, pr };
  });
  const pid = 'p:' + it.id;
  addNode(pid, { x: best.pr.x, y: best.pr.y });
  onEdge[best.ei].push({ u: best.pr.u, id: pid });
  link(it.id, pid);
}
const EDGE_KIND = {};
EDGES.forEach(([a, b, , kind], ei) => {
  const chain = [a, ...onEdge[ei].sort((p, q) => p.u - q.u).map(p => p.id), b];
  // 'exit' edges are one way (out through an exit you can't come back in by)
  if (kind === 'exit') { const w = dist(NODE[a], NODE[b]); G[a].push({ to: b, w, kind }); EDGE_KIND[a + '|' + b] = kind; return; }
  for (let i = 1; i < chain.length; i++) link(chain[i-1], chain[i], kind);
  if (kind) EDGE_KIND[a + '|' + b] = EDGE_KIND[b + '|' + a] = kind;
});
const nodeOf = it => it.kind === 'place' ? it.node : it.id;

// Step-free routing skips escalators; elevators cost a short wait (about a minute) on top of the walk
let stepFree = false;
const LIFT_WAIT = 75;   // metres-equivalent at 75 m/min
// An airport train (ATL's Plane Train): a minute's wait each way on and off the platform, then it covers
// ground about seven times faster than walking.
const BOARD_WAIT = 55, TRAIN_SPEED = 7;
const cost = (w, kind) => kind === 'lift' ? w + LIFT_WAIT : kind === 'board' ? w + BOARD_WAIT : kind === 'train' ? w / TRAIN_SPEED : w;
// checkpoints that are closed now (set by the app from their hours): walking *through* one costs a
// lot, so routes use an open one, but you can still start or end at it
let closedNodes = new Set();
const CLOSED_COST = 1e5;
// Crossing security (a checkpoint ↔ the secure side) weighs a lot when choosing a route, so it never
// leaves the secure side to screen again somewhere else; route() takes the weight back out of the time.
const SEC_COST = 1e4;
const SEC_PAIR = new Set(EDGES.filter(e => e[2] === 'S').flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
function dijkstra(src) {
  const D = { [src]: 0 }, prev = {}, done = new Set();
  const ids = Object.keys(G);
  while (true) {
    let u = null, best = Infinity;
    for (const id of ids) if (!done.has(id) && D[id] !== undefined && D[id] < best) { best = D[id]; u = id; }
    if (u === null) break;
    done.add(u);
    for (const { to, w, kind } of G[u]) {
      if (done.has(to) || (stepFree && kind === 'esc')) continue;
      const nd = D[u] + cost(w, kind) + (u !== src && closedNodes.has(u) ? CLOSED_COST : 0) + (u !== src && SEC_PAIR.has(u + '|' + to) ? SEC_COST : 0);   // starting at a checkpoint, its own lanes are free
      if (D[to] === undefined || nd < D[to]) { D[to] = nd; prev[to] = u; }
    }
  }
  return { D, prev };
}
const dCache = {};
const fromSrc = id => { const key = id + (stepFree ? '|sf' : '') + (closedNodes.size ? '|' + [...closedNodes].join() : ''); return dCache[key] || (dCache[key] = dijkstra(id)); };
function route(aItem, bItem) {
  const s = nodeOf(aItem), t = nodeOf(bItem), { D, prev } = fromSrc(s);
  const path = [t]; while (path[0] !== s) path.unshift(prev[path[0]]);
  // units: time-equivalent (includes elevator waits); len: metres actually walked
  let len = 0; for (let i = 1; i < path.length; i++) if (EDGE_KIND[path[i - 1] + '|' + path[i]] !== 'train') len += dist(NODE[path[i - 1]], NODE[path[i]]);
  const crossings = path.filter((n, i) => i > 1 && SEC_PAIR.has(path[i - 1] + '|' + n)).length;
  return { path, units: D[t] - crossings * SEC_COST - (path.slice(1, -1).some(n => closedNodes.has(n)) ? CLOSED_COST : 0), len, lift: path.some((n, i) => i && EDGE_KIND[path[i - 1] + '|' + n] === 'lift'), train: path.some((n, i) => i && EDGE_KIND[path[i - 1] + '|' + n] === 'train') };
}
const meters = u => Math.round(u * M_PER_UNIT / 10) * 10;
const minutes = u => Math.max(1, Math.round(u * M_PER_UNIT / M_PER_MIN));

