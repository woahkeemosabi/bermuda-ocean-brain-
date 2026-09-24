const ENDPOINT = 'https://api.rainviewer.com/public/weather-maps.json';

export default async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(ENDPOINT, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Bermuda-Ocean-Brain/1.0' },
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Radar source unavailable' });
    const body = await upstream.json();
    const frames = Array.isArray(body?.radar?.past) ? body.radar.past : [];
    const frame = frames.at(-1);
    const host = String(body?.host || '');
    const path = String(frame?.path || '');

    // RainViewer migrated frame IDs from numeric timestamps to opaque IDs.
    // Validate the fixed host and path shape without assuming the identifier is numeric.
    if (
      host !== 'https://tilecache.rainviewer.com' ||
      !/^\/v2\/radar\/[A-Za-z0-9_-]{6,64}$/.test(path) ||
      !Number.isFinite(Number(frame?.time))
    ) {
      console.warn('[radar-manifest] malformed upstream manifest', { host, path, time: frame?.time });
      return res.status(502).json({ error: 'Radar manifest malformed' });
    }

    const time = new Date(Number(frame.time) * 1000).toISOString();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ host, path, time, attribution: 'RainViewer' });
  } catch (error) {
    console.warn('[radar-manifest]', error);
    return res.status(502).json({ error: 'Radar source unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
