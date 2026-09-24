const NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json';

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export default async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(NHC, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Bermuda-Ocean-Brain/1.0' },
    });
    if (!response.ok) return res.status(502).json({ storms: [], error: 'NHC unavailable' });
    const payload = await response.json();
    const storms = (Array.isArray(payload?.activeStorms) ? payload.activeStorms : [])
      .filter((storm) => String(storm?.id || '').toLowerCase().startsWith('al'))
      .map((storm) => ({
        id: String(storm.id),
        name: String(storm.name || 'Unnamed'),
        classification: String(storm.classification || ''),
        windKt: numberOrNull(storm.intensity),
        pressureHpa: numberOrNull(storm.pressure),
        latitude: numberOrNull(storm.latitudeNumeric),
        longitude: numberOrNull(storm.longitudeNumeric),
        movementDir: numberOrNull(storm.movementDir),
        movementMph: numberOrNull(storm.movementSpeed),
        updatedAt: storm.lastUpdate || null,
      }))
      .filter((storm) => Number.isFinite(storm.latitude) && Number.isFinite(storm.longitude));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ source: 'NOAA/NHC', storms });
  } catch (error) {
    console.warn('[cyclones]', error);
    return res.status(502).json({ storms: [], error: 'NHC unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
