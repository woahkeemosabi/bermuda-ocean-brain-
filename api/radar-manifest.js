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
    const host = String(body?.host || '');
    const raw = Array.isArray(body?.radar?.past) ? body.radar.past : [];
    const frames = raw.slice(-8).map((frame) => ({
      path: String(frame?.path || ''),
      time: new Date(Number(frame?.time) * 1000).toISOString(),
    })).filter((frame) => /^\/v2\/radar\/[A-Za-z0-9_-]{6,64}$/.test(frame.path));
    if (host !== 'https://tilecache.rainviewer.com' || !frames.length)
      return res.status(502).json({ error: 'Radar manifest malformed' });
    const latest = frames.at(-1);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ host, path: latest.path, time: latest.time, frames, attribution: 'RainViewer' });
  } catch (error) {
    console.warn('[radar-manifest]', error);
    return res.status(502).json({ error: 'Radar source unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
