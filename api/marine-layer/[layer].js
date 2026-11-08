// Bermuda MSP ArcGIS proxy migrated from the existing AppDeploy Ocean Brain backend.
// Explicit allowlist prevents callers from proxying arbitrary external URLs.
const SERVICE = 'https://services1.arcgis.com/4TXrdeWh0RyCqPgB/ArcGIS/rest/services/BDA_MSP_DataForSeaSketch_Vector_v2/FeatureServer';
const LAYERS = Object.freeze({
  'territorial-sea': 295,
  'eez': 294,
  'coral-reef-type': 287,
  'coral-cover': 288,
  'seagrass': 286,
  'shelf': 302,
  'slope': 300,
  'seamounts': 305,
});
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const slug = String(req.query?.layer ?? '');
  if (!Object.prototype.hasOwnProperty.call(LAYERS, slug)) {
    return res.status(404).json({ error: 'Unknown Bermuda marine layer' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL(`${SERVICE}/${LAYERS[slug]}/query`);
    url.search = new URLSearchParams({
      where: '1=1', outFields: '*', returnGeometry: 'true',
      outSR: '4326', f: 'geojson',
    }).toString();
    const upstream = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/geo+json, application/json' } });
    if (!upstream.ok) throw new Error(`ArcGIS HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
      throw new Error('ArcGIS returned an invalid GeoJSON feature collection');
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.warn('[bermuda-msp]', slug, error instanceof Error ? error.message : String(error));
    return res.status(502).json({ error: 'Bermuda marine layer unavailable', layer: slug });
  } finally {
    clearTimeout(timer);
  }
}
