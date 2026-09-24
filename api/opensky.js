const LAT = 32.3078;
const LON = -64.7505;
const RADIUS_NM = 250;
const ADSB_LOL = 'https://api.adsb.lol';

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
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

function openSkyState(ac, nowSec) {
  const lat = finite(ac?.lat);
  const lon = finite(ac?.lon);
  if (lat === null || lon === null || !ac?.hex) return null;
  const seen = Math.max(0, finite(ac?.seen) ?? 0);
  const seenPos = Math.max(0, finite(ac?.seen_pos) ?? seen);
  const onGround = ac?.alt_baro === 'ground';
  return [
    String(ac.hex).toLowerCase(),                        // 0 icao24
    typeof ac.flight === 'string' ? ac.flight.trim() || null : null, // 1 callsign
    null,                                               // 2 origin_country
    Math.max(0, Math.round(nowSec - seenPos)),           // 3 time_position
    Math.max(0, Math.round(nowSec - seen)),              // 4 last_contact
    lon,                                                // 5 longitude
    lat,                                                // 6 latitude
    onGround ? null : feetToMetres(ac?.alt_baro),        // 7 baro_altitude
    onGround,                                           // 8 on_ground
    knotsToMps(ac?.gs),                                 // 9 velocity
    finite(ac?.track),                                  // 10 true_track
    feetPerMinuteToMps(ac?.baro_rate ?? ac?.geom_rate),  // 11 vertical_rate
    null,                                               // 12 sensors
    feetToMetres(ac?.alt_geom),                         // 13 geo_altitude
    ac?.squawk ? String(ac.squawk) : null,              // 14 squawk
    false,                                              // 15 spi
    0,                                                  // 16 position_source (ADS-B)
    null,                                               // 17 category
  ];
}

export default async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    // Keep the acquisition region stable around Bermuda. Camera motion must not
    // silently change which aircraft are considered part of the island picture.
    const url = `${ADSB_LOL}/v2/lat/${LAT}/lon/${LON}/dist/${RADIUS_NM}`;
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Bermuda-Ocean-Brain/1.0' },
    });
    if (!upstream.ok) {
      res.setHeader('x-flight-source', 'ADSB.lol');
      return res.status(upstream.status).json({ time: Math.floor(Date.now() / 1000), states: [] });
    }
    const payload = await upstream.json();
    const upstreamNow = finite(payload?.now);
    const nowSec = upstreamNow === null
      ? Math.floor(Date.now() / 1000)
      : upstreamNow > 10_000_000_000
        ? upstreamNow / 1000
        : upstreamNow;
    const states = Array.isArray(payload?.ac)
      ? payload.ac.map((aircraft) => openSkyState(aircraft, nowSec)).filter(Boolean)
      : [];

    res.setHeader('x-flight-source', 'ADSB.lol · ODbL 1.0');
    res.setHeader('x-flight-coverage', `Bermuda · ${RADIUS_NM} NM radius`);
    res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=12');
    return res.status(200).json({ time: Math.round(nowSec), states });
  } catch (error) {
    console.warn('[opensky-adapter]', error);
    res.setHeader('x-flight-source', 'ADSB.lol');
    return res.status(502).json({ time: Math.floor(Date.now() / 1000), states: [] });
  } finally {
    clearTimeout(timer);
  }
}
