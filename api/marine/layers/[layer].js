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

export default async function handler(req, res) {
  const key = String(req.query?.layer ?? '');
  const id = LAYERS[key];
  if (!id) return res.status(404).json({ error: 'Unknown Bermuda marine layer' });
  const url = `${SERVICE}/${id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/geo+json,application/json' } });
    if (!upstream.ok) return res.status(502).json({ error: `Marine layer upstream returned ${upstream.status}` });
    const data = await upstream.json();
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data?.features)) return res.status(502).json({ error: 'Malformed marine GeoJSON' });
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (error) {
    res.status(502).json({ error: 'Bermuda marine layer unavailable' });
  }
}
