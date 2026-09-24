const PRODUCTS = Object.freeze({
  clouds: {
    base: 'https://nowcoast.noaa.gov/geoserver/observations/satellite/ows',
    layer: 'goes_longwave_imagery',
    style: 'goes-lir',
  },
  lightning: {
    base: 'https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows',
    layer: 'ldn_lightning_strike_density',
    style: 'lightning_density',
  },
});

const COPY = new Set([
  'bbox', 'width', 'height', 'crs', 'srs', 'format', 'transparent',
  'request', 'service', 'version', 'exceptions', 'time',
]);

export default async function handler(req, res) {
  const kind = String(req.query?.kind || '');
  const spec = PRODUCTS[kind];
  if (!spec) return res.status(400).send('invalid weather product');

  const upstreamUrl = new URL(spec.base);
  for (const [key, value] of Object.entries(req.query || {})) {
    const lower = key.toLowerCase();
    if (lower === 'kind' || !COPY.has(lower)) continue;
    const scalar = Array.isArray(value) ? value[0] : value;
    if (scalar !== undefined) upstreamUrl.searchParams.set(key, String(scalar));
  }
  upstreamUrl.searchParams.set('service', 'WMS');
  upstreamUrl.searchParams.set('request', 'GetMap');
  upstreamUrl.searchParams.set('layers', spec.layer);
  upstreamUrl.searchParams.set('styles', spec.style);
  upstreamUrl.searchParams.set('format', 'image/png');
  upstreamUrl.searchParams.set('transparent', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'image/png', 'User-Agent': 'Bermuda-Ocean-Brain/1.0' },
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) {
      await upstream.body?.cancel();
      return res.status(502).send('weather imagery unavailable');
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180');
    return res.status(200).send(bytes);
  } catch (error) {
    console.warn('[weather-wms]', error);
    return res.status(502).send('weather imagery unavailable');
  } finally {
    clearTimeout(timer);
  }
}
