// Clearway Live: a tiny Cloudflare Worker that gives the app live flight status and security
// wait times. It holds the data providers' API keys (the app can't keep a secret) and turns their
// responses into one small, stable format. It stores nothing and logs no flight numbers.
//
//   GET /flight?number=DL1234&date=2026-10-05&airport=ATL   → one flight (see normFlight)
//   GET /wait?airport=CLE                                   → security wait (see normWait)
//
// Secrets (wrangler secret put …): AERODATABOX_KEY (RapidAPI key for AeroDataBox),
// TSAWAITTIMES_KEY (tsawaittimes.com API key). Either may be left unset; that endpoint then
// answers 503 and the app simply doesn't show that piece.

const FLIGHT_TTL = 120;   // seconds a flight answer is cached (also keeps within the provider's quota)
const WAIT_TTL = 300;

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
    const url = new URL(req.url);
    try {
      if (url.pathname === '/flight') return await cached(req, ctx, FLIGHT_TTL, () => flight(url, env));
      if (url.pathname === '/wait') return await cached(req, ctx, WAIT_TTL, () => wait(url, env));
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message || 'failed' }, e.status || 502);
    }
  },
};

// ---------- Flight status (AeroDataBox) ----------
async function flight(url, env) {
  if (!env.AERODATABOX_KEY) throw httpError(503, 'flight status not configured');
  const number = (url.searchParams.get('number') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const date = url.searchParams.get('date') || '';
  const airport = (url.searchParams.get('airport') || '').toUpperCase();
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(number)) throw httpError(400, 'flight number like DL1234');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'date as YYYY-MM-DD');
  const r = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${number}/${date}?withAircraftImage=false&withLocation=false`, {
    headers: { 'X-RapidAPI-Key': env.AERODATABOX_KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
  });
  if (r.status === 204 || r.status === 404) throw httpError(404, 'no such flight that day');
  if (!r.ok) throw httpError(502, 'flight provider ' + r.status);
  const legs = await r.json();
  if (!Array.isArray(legs) || !legs.length) throw httpError(404, 'no such flight that day');
  // a flight number can have several legs; prefer the one touching the app's airport
  const leg = legs.find(l => l.departure?.airport?.iata === airport) || legs.find(l => l.arrival?.airport?.iata === airport) || legs[0];
  return normFlight(leg);
}

const STATUS = {
  Expected: 'scheduled', CheckIn: 'scheduled', Boarding: 'boarding', GateClosed: 'gate-closed', Departed: 'departed',
  EnRoute: 'departed', Approaching: 'departed', Delayed: 'delayed', Arrived: 'arrived', Canceled: 'cancelled',
  CanceledUncertain: 'cancelled', Diverted: 'diverted',
};
function normFlight(f) {
  const end = m => m ? ({
    airport: m.airport?.iata || '', city: m.airport?.municipalityName || m.airport?.name || '',
    terminal: m.terminal || '', gate: m.gate || '', baggage: m.baggageBelt || '',
    scheduled: m.scheduledTime?.utc ? iso(m.scheduledTime.utc) : '',
    estimated: (m.revisedTime || m.predictedTime)?.utc ? iso((m.revisedTime || m.predictedTime).utc) : '',
    actual: m.runwayTime?.utc ? iso(m.runwayTime.utc) : '',
  }) : null;
  return {
    flight: f.number || '', airline: { name: f.airline?.name || '', iata: f.airline?.iata || '' },
    status: STATUS[f.status] || 'unknown', departure: end(f.departure), arrival: end(f.arrival),
    updated: f.lastUpdatedUtc ? iso(f.lastUpdatedUtc) : new Date().toISOString(), source: 'AeroDataBox',
  };
}
// "2026-10-05 17:05Z" → ISO
const iso = s => new Date(s.replace(' ', 'T').replace(/Z?$/, 'Z')).toISOString();

// ---------- Security wait (tsawaittimes.com) ----------
async function wait(url, env) {
  if (!env.TSAWAITTIMES_KEY) throw httpError(503, 'wait times not configured');
  const airport = (url.searchParams.get('airport') || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(airport)) throw httpError(400, 'airport as a 3-letter code');
  const r = await fetch(`https://www.tsawaittimes.com/api/airport/${encodeURIComponent(env.TSAWAITTIMES_KEY)}/${airport}/json`);
  if (!r.ok) throw httpError(502, 'wait provider ' + r.status);
  return normWait(airport, await r.json());
}
function normWait(airport, w) {
  const minutes = Number.isFinite(+w.rightnow) ? Math.round(+w.rightnow) : null;
  if (minutes === null) throw httpError(404, 'no wait time for ' + airport);
  return { airport, minutes, precheck: +w.precheck === 1, updated: new Date().toISOString(), source: 'TSAWaitTimes.com' };
}

// ---------- plumbing ----------
async function cached(req, ctx, ttl, make) {
  const cache = caches.default, key = new Request(new URL(req.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return cors(new Response(hit.body, hit));
  const res = json(await make(), 200, ttl);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
function json(body, status = 200, ttl = 0) {
  return cors(new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store' },
  }));
}
function cors(res) {
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('access-control-allow-methods', 'GET, OPTIONS');
  return res;
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
