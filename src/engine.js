// ---------- Active airport ----------
const AP = AIRPORTS[ACTIVE_AIRPORT] || AIRPORTS[Object.keys(AIRPORTS)[0]];
const { GEO, V, EDGES, SPINES, ROT, MAP_BOUNDS, AIRLINES, CON_RANGE, GATE_POS, AMEN, HOURS } = AP;
const ROT_GATES = new Set(AP.ROT_GATES);
const ROLE = AP.roles;

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
  if (Array.isArray(at)) {
    const [x, y, zone, gate] = at;
    if (zone === 'LIFT') Object.assign(it, { x, y, zone, lift: gate, near: V[gate][2] });
    else Object.assign(it, { x, y, zone, gate, near: gate ? 'Near gate ' + gate : zone === 'L' ? 'Landside, before security' : 'Main terminal' });
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
  it.icon = /^Elevator$/.test(name) ? 'lift' : /^Water fountain/.test(name) ? 'water' : /^Accessible restroom/.test(name) ? 'access' : cat;
  ITEMS[it.id] = it;
});

// ---------- Floors ----------
// 'up' = upper level (gates, security, ticketing, airside shops); 'lo' = lower level
// (baggage claim, ground transportation, and the RTA platform below it).
const LOWER_V = new Set(AP.LOWER_V);
for (const it of Object.values(ITEMS))
  it.lvl = it.zone === 'LIFT' ? null : it.kind === 'place' ? (LOWER_V.has(it.node) ? 'lo' : 'up') : (it.zone === 'L' && it.y > -150 ? 'lo' : 'up');
function levelOf(node) {
  if (V[node]) return LOWER_V.has(node) ? 'lo' : 'up';
  const it = ITEMS[node.startsWith('p:') ? node.slice(2) : node];
  return it && it.lvl ? it.lvl : 'up';
}

// ---------- Graph with every item attached to its nearest walkway ----------
const G = {};   // node -> [{to, w}]
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
  for (let i = 1; i < chain.length; i++) link(chain[i-1], chain[i], kind);
  if (kind) EDGE_KIND[a + '|' + b] = EDGE_KIND[b + '|' + a] = kind;
});
const nodeOf = it => it.kind === 'place' ? it.node : it.id;

// Step-free routing skips escalators; elevators cost a short wait (about a minute) on top of the walk
let stepFree = false;
const LIFT_WAIT = 75;   // metres-equivalent at 75 m/min
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
      const nd = D[u] + w + (kind === 'lift' ? LIFT_WAIT : 0);
      if (D[to] === undefined || nd < D[to]) { D[to] = nd; prev[to] = u; }
    }
  }
  return { D, prev };
}
const dCache = {};
const fromSrc = id => { const key = id + (stepFree ? '|sf' : ''); return dCache[key] || (dCache[key] = dijkstra(id)); };
function route(aItem, bItem) {
  const s = nodeOf(aItem), t = nodeOf(bItem), { D, prev } = fromSrc(s);
  const path = [t]; while (path[0] !== s) path.unshift(prev[path[0]]);
  // units: time-equivalent (includes elevator waits); len: metres actually walked
  let len = 0; for (let i = 1; i < path.length; i++) len += dist(NODE[path[i - 1]], NODE[path[i]]);
  return { path, units: D[t], len, lift: path.some((n, i) => i && EDGE_KIND[path[i - 1] + '|' + n] === 'lift') };
}
const meters = u => Math.round(u * M_PER_UNIT / 10) * 10;
const minutes = u => Math.max(1, Math.round(u * M_PER_UNIT / M_PER_MIN));

