import WebSocket from 'ws';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BOUNDS = [[[31.7, -65.6], [32.9, -63.9]]];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  const mmsi = String(req.query?.mmsi ?? '').trim();
  if (!/^\d{9}$/.test(mmsi)) return res.status(400).json({ error: '9-digit mmsi query param required' });
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return res.status(503).json({ mmsi, samples: [], error: 'AISSTREAM_API_KEY is not configured on Vercel' });
  const samples = [];
  try {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
      let settled = false;
      const timer = setTimeout(() => finish(), 15000);
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        error ? reject(error) : resolve();
      }
      socket.on('open', () => socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: BOUNDS, FiltersShipMMSI: [mmsi], FilterMessageTypes: ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'] })));
      socket.on('message', raw => {
        try {
          const envelope = JSON.parse(raw.toString());
          const type = envelope?.MessageType || '';
          if (!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'].includes(type)) return;
          const payload = envelope?.Message?.[type] ?? {};
          const meta = envelope?.MetaData ?? {};
          const lat = finite(meta?.Latitude ?? payload?.Latitude);
          const lon = finite(meta?.Longitude ?? payload?.Longitude);
          if (lat === null || lon === null) return;
          samples.push({ lat, lon, t: Date.now() / 1000 });
          if (samples.length >= 3) finish();
        } catch {}
      });
      socket.on('error', () => finish(new Error('AISStream connection failed')));
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ mmsi, samples, source: 'AISStream direct Vercel sample' });
  } catch (error) {
    return res.status(502).json({ mmsi, samples, error: error instanceof Error ? error.message : 'AISStream unavailable' });
  }
}
