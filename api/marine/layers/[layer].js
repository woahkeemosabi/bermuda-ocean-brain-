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

// Spatially constrain heavy source layers to the Bermuda operating area.
const BERMUDA_ENVELOPE = '-65.45,31.75,-64.00,32.85';

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
    // Esri exterior rings are clockwise; holes are counter-clockwise.
    const exterior = signedArea(ring) < 0;
    if (exterior || !current) {
      current = [ring];
      polygons.push(current);
    } else {
      current.push(ring);
    }
  }

  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

function geometryToGeoJSON(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) {
    return { type: 'Point', coordinates: [geometry.x, geometry.y] };
  }
  if (Array.isArray(geometry.points)) {
    return { type: 'MultiPoint', coordinates: geometry.points };
  }
  if (Array.isArray(geometry.paths)) {
    return geometry.paths.length === 1
      ? { type: 'LineString', coordinates: geometry.paths[0] }
      : { type: 'MultiLineString', coordinates: geometry.paths };
  }
  if (Array.isArray(geometry.rings)) return polygonFromRings(geometry.rings);
  return null;
}

function esriToFeatureCollection(data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  return {
    type: 'FeatureCollection',
    features: features
      .map((feature) => ({
        type: 'Feature',
        geometry: geometryToGeoJSON(feature?.geometry),
        properties: feature?.attributes || {},
      }))
      .filter((feature) => feature.geometry),
  };
}

export default async function handler(req, res) {
  const key = String(req.query?.layer ?? '');
  const id = LAYERS[key];
  if (!id) return res.status(404).json({ error: 'Unknown Bermuda marine layer' });

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
  });

  try {
    const upstream = await fetch(`${SERVICE}/${id}/query?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Marine layer upstream returned ${upstream.status}` });
    }

    const data = await upstream.json();
    if (data?.error) {
      return res.status(502).json({ error: data.error.message || 'ArcGIS marine layer error' });
    }

    const geojson = esriToFeatureCollection(data);
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(geojson);
  } catch (error) {
    console.error('[Marine layer proxy]', key, error);
    res.status(502).json({ error: 'Bermuda marine layer unavailable' });
  }
}
