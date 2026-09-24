const SERVICE = 'https://services1.arcgis.com/4TXrdeWh0RyCqPgB/ArcGIS/rest/services/BDA_MSP_DataForSeaSketch_Vector_v2/FeatureServer';
const LAYERS = {
  'territorial-seas': 295,
  'eez': 294,
  'coral-reef-type': 287,
  'coral-cover': 288,
  'seagrass': 286,
  'shelf': 302,
  'slope': 300,
  'seamounts': 305,
  'subsea-cables': 297,
};

const BERMUDA_ENVELOPE = '-65.45,31.75,-64.00,32.85';
const PAGE_SIZE = 2000;
const MAX_PAGES = 8;

function signedArea(ring = []) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j] || [];
    const [x2, y2] = ring[i] || [];
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    sum += (x1 * y2) - (x2 * y1);
  }
  return sum / 2;
}

function polygonFromRings(rings = []) {
  const polygons = [];
  let current = null;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const exterior = signedArea(ring) < 0;
    if (exterior || !current) {
      current = [ring];
      polygons.push(current);
    } else current.push(ring);
  }
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function geometryToGeoJSON(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) return { type: 'Point', coordinates: [geometry.x, geometry.y] };
  if (Array.isArray(geometry.points)) return { type: 'MultiPoint', coordinates: geometry.points };
  if (Array.isArray(geometry.paths)) return geometry.paths.length === 1
    ? { type: 'LineString', coordinates: geometry.paths[0] }
    : { type: 'MultiLineString', coordinates: geometry.paths };
  if (Array.isArray(geometry.rings)) return polygonFromRings(geometry.rings);
  return null;
}

function esriFeature(feature) {
  const geometry = geometryToGeoJSON(feature?.geometry);
  if (!geometry) return null;
  return { type: 'Feature', geometry, properties: feature?.attributes || {} };
}

async function fetchPage(id, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    geometry: BERMUDA_ENVELOPE,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    geometryPrecision: '5',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    returnExceededLimitFeatures: 'true',
  });
  const upstream = await fetch(`${SERVICE}/${id}/query?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!upstream.ok) throw new Error(`Marine layer upstream returned ${upstream.status}`);
  const data = await upstream.json();
  if (data?.error) throw new Error(data.error.message || 'ArcGIS marine layer error');
  return data;
}

export default async function handler(req, res) {
  const key = String(req.query?.layer ?? '');
  const id = LAYERS[key];
  if (!id) return res.status(404).json({ error: 'Unknown Bermuda marine layer' });

  try {
    const features = [];
    let offset = 0;
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchPage(id, offset);
      const batch = Array.isArray(data?.features) ? data.features : [];
      for (const feature of batch) {
        const converted = esriFeature(feature);
        if (converted) features.push(converted);
      }
      offset += batch.length;
      const exceeded = Boolean(data?.exceededTransferLimit);
      if (!exceeded || batch.length === 0 || batch.length < PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.setHeader('x-ocean-feature-count', String(features.length));
    res.setHeader('x-ocean-pagination-complete', complete ? 'true' : 'false');
    return res.status(200).json({ type: 'FeatureCollection', features });
  } catch (error) {
    console.error('[Marine layer proxy]', key, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Bermuda marine layer unavailable' });
  }
}
