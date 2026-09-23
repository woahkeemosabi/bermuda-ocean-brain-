const UPSTREAM = 'https://bermuda-ocean-brain-8g1utl.v2.appdeploy.ai';

export default async function handler(req, res) {
  const mmsi = String(req.query?.mmsi ?? '').trim();
  if (!/^\d{5,10}$/.test(mmsi)) return res.status(400).json({ error: 'mmsi query param required' });
  try {
    const upstream = await fetch(`${UPSTREAM}/api/ais-live/track?mmsi=${encodeURIComponent(mmsi)}`, { headers: { Accept: 'application/json' } });
    const text = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (error) {
    res.status(502).json({ mmsi, samples: [], error: 'AIS track upstream unavailable' });
  }
}
