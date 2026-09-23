const UPSTREAM = 'https://bermuda-ocean-brain-8g1utl.v2.appdeploy.ai';

export default async function handler(req, res) {
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows ?? 12000) || 12000));
  try {
    const upstream = await fetch(`${UPSTREAM}/api/ais-live?maxRows=${maxRows}`, { headers: { Accept: 'application/json' } });
    const text = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json').send(text);
  } catch (error) {
    res.status(502).json({ rows: [], status: 'degraded', error: 'AIS upstream unavailable', refreshing: true });
  }
}
