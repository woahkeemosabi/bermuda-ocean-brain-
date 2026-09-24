const LAT = 32.3078;
const LON = -64.7505;
const DIRECT_RADIUS_NM = 250;
const REGIONAL_RADIUS_NM = 650;

const DIRECT_SOURCES = [
  {
    name: 'Airplanes.live',
    url: `https://api.airplanes.live/v2/point/${LAT}/${LON}/${DIRECT_RADIUS_NM}`,
  },
  {
    name: 'ADSB.lol',
    url: `https://api.adsb.lol/v2/point/${LAT}/${LON}/${DIRECT_RADIUS_NM}`,
  },
  {
    name: 'adsb.fi',
    url: `https://opendata.adsb.fi/api/v3/lat/${LAT}/lon/${LON}/dist/${DIRECT_RADIUS_NM}`,
  },
];

const OPENSKY_URL =
  'https://opensky-network.org/api/states/all?lamin=22&lomin=-78&lamax=43&lomax=-51';

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const feetToMetres = (value) => {
  const number = finite(value);
  return number === null ? null : number * 0.3048;
};
const knotsToMps = (value) => {
  const number = finite(value);
  return number === null ? null : number * 0.514444;
};
const feetPerMinuteToMps = (value) => {
  const number = finite(value);
  return number === null ? null : number * 0.00508;
};

function distanceNm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function openSkyState(ac, nowSec) {
  const lat = finite(ac?.lat);
  const lon = finite(ac?.lon);
  if (lat === null || lon === null || !ac?.hex) return null;
  const seen = Math.max(0, finite(ac?.seen) ?? 0);
  const seenPos = Math.max(0, finite(ac?.seen_pos) ?? seen);
  const onGround = ac?.alt_baro === 'ground';
  return [
    String(ac.hex).toLowerCase(),
    typeof ac.flight === 'string' ? ac.flight.trim() || null : null,
    null,
    Math.max(0, Math.round(nowSec - seenPos)),
    Math.max(0, Math.round(nowSec - seen)),
    lon,
    lat,
    onGround ? null : feetToMetres(ac?.alt_baro),
    onGround,
    knotsToMps(ac?.gs),
    finite(ac?.track),
    feetPerMinuteToMps(ac?.baro_rate ?? ac?.geom_rate),
    null,
    feetToMetres(ac?.alt_geom),
    ac?.squawk ? String(ac.squawk) : null,
    false,
    0,
    finite(ac?.category),
    typeof ac?.t === 'string' ? ac.t.trim().toUpperCase() || null : null,
    typeof ac?.r === 'string' ? ac.r.trim().toUpperCase() || null : null,
    typeof ac?.ownOp === 'string' ? ac.ownOp.trim() || null : null,
    typeof ac?.category === 'string' ? ac.category.trim().toUpperCase() || null : null,
    typeof ac?.desc === 'string' ? ac.desc.trim() || null : null,
    finite(ac?.dbFlags),
  ];
}

async function fetchJson(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Bermuda-Ocean-Brain/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDirectPayload(payload) {
  const rows = Array.isArray(payload?.ac)
    ? payload.ac
    : Array.isArray(payload?.aircraft)
      ? payload.aircraft
      : [];
  const upstreamNow = finite(payload?.now ?? payload?.ctime);
  const nowSec = upstreamNow === null
    ? Math.floor(Date.now() / 1000)
    : upstreamNow > 10_000_000_000
      ? upstreamNow / 1000
      : upstreamNow;
  const states = rows
    .map((aircraft) => openSkyState(aircraft, nowSec))
    .filter(Boolean)
    .filter((state) => distanceNm(LAT, LON, state[6], state[5]) <= DIRECT_RADIUS_NM + 5);
  return { states, nowSec };
}

function normalizeOpenSkyPayload(payload) {
  const nowSec = finite(payload?.time) ?? Math.floor(Date.now() / 1000);
  const rows = Array.isArray(payload?.states) ? payload.states : [];
  const states = rows
    .filter((state) => Array.isArray(state) && Number.isFinite(Number(state[6])) && Number.isFinite(Number(state[5])))
    .map((state) => ({ state, distance: distanceNm(LAT, LON, Number(state[6]), Number(state[5])) }))
    .filter((entry) => entry.distance <= REGIONAL_RADIUS_NM)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 700)
    .map((entry) => entry.state);
  return { states, nowSec };
}

export default async function handler(req, res) {
  const errors = [];
  let successfulEmpty = null;

  for (const source of DIRECT_SOURCES) {
    try {
      const payload = await fetchJson(source.url);
      const normalized = normalizeDirectPayload(payload);
      if (normalized.states.length) {
        res.setHeader('x-flight-source', `${source.name} · live ADS-B`);
        res.setHeader('x-flight-coverage', `Bermuda · ${DIRECT_RADIUS_NM} NM radius`);
        res.setHeader('Cache-Control', 'public, s-maxage=12, stale-while-revalidate=18');
        return res.status(200).json({ time: Math.round(normalized.nowSec), states: normalized.states });
      }
      successfulEmpty = { source: source.name, nowSec: normalized.nowSec };
    } catch (error) {
      errors.push(`${source.name}: ${String(error?.message || error)}`);
    }
  }

  try {
    const payload = await fetchJson(OPENSKY_URL, 8500);
    const normalized = normalizeOpenSkyPayload(payload);
    res.setHeader('x-flight-source', 'OpenSky Network · regional fallback');
    res.setHeader('x-flight-coverage', `Bermuda regional airspace · ${REGIONAL_RADIUS_NM} NM`);
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=30');
    return res.status(200).json({ time: Math.round(normalized.nowSec), states: normalized.states });
  } catch (error) {
    errors.push(`OpenSky: ${String(error?.message || error)}`);
  }

  if (successfulEmpty) {
    res.setHeader('x-flight-source', `${successfulEmpty.source} · live ADS-B`);
    res.setHeader('x-flight-coverage', `Bermuda · ${DIRECT_RADIUS_NM} NM radius`);
    res.setHeader('Cache-Control', 'public, s-maxage=12, stale-while-revalidate=18');
    return res.status(200).json({ time: Math.round(successfulEmpty.nowSec), states: [] });
  }

  console.warn('[aircraft-adapter]', errors.join(' | '));
  res.setHeader('x-flight-source', 'Aircraft feeds unavailable');
  return res.status(502).json({
    time: Math.floor(Date.now() / 1000),
    states: [],
    error: 'Aircraft feeds unavailable',
  });
}
