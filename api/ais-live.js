import WebSocket from 'ws';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BOUNDS = [[[31.7, -65.6], [32.9, -63.9]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatic(type, payload, meta) {
  if (type === 'ShipStaticData') {
    return {
      name: String(payload?.Name ?? meta?.ShipName ?? '').trim(),
      type: payload?.Type ?? payload?.ShipType ?? '',
      destination: String(payload?.Destination ?? '').trim(),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: String(payload?.CallSign ?? '').trim(),
      length: (() => {
        const a = finite(payload?.Dimension?.A ?? payload?.DimensionA ?? payload?.ToBow);
        const b = finite(payload?.Dimension?.B ?? payload?.DimensionB ?? payload?.ToStern);
        return a !== null && b !== null ? a + b : null;
      })(),
    };
  }
  if (type === 'StaticDataReport') {
    return {
      name: String(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName ?? '').trim(),
      type: payload?.ShipType ?? payload?.ReportB?.ShipType ?? '',
      destination: String(payload?.Destination ?? payload?.ReportB?.Destination ?? '').trim(),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: String(payload?.CallSign ?? payload?.ReportB?.CallSign ?? '').trim(),
      length: null,
    };
  }
  return null;
}

function normalizePosition(type, payload, meta, statics) {
  if (!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'].includes(type)) return null;
  const mmsi = String(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI ?? '').trim();
  const lat = finite(meta?.Latitude ?? meta?.latitude ?? payload?.Latitude);
  const lon = finite(meta?.Longitude ?? meta?.longitude ?? payload?.Longitude);
  if (!mmsi || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const details = statics.get(mmsi) ?? {};
  const name = String(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`).trim();
  return {
    mmsi,
    lat,
    lon,
    name,
    imo: details.imo || '',
    type: details.type ?? '',
    destination: details.destination || '',
    callSign: details.callSign || '',
    length: details.length ?? null,
    speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(payload?.TrueHeading ?? payload?.Heading),
    last_position_UTC: String(meta?.time_utc ?? meta?.TimeUTC ?? new Date().toISOString()),
  };
}

async function sampleAis(apiKey, sampleMs) {
  const rows = new Map();
  const statics = new Map();
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let settled = false;
    let quietTimer;
    const hardTimer = setTimeout(() => finish(), sampleMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve();
    }

    socket.on('open', () => {
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: BOUNDS, FilterMessageTypes: TYPES }));
    });

    socket.on('message', raw => {
      try {
        const envelope = JSON.parse(raw.toString());
        const type = envelope?.MessageType || '';
        const payload = envelope?.Message?.[type] ?? {};
        const meta = envelope?.MetaData ?? {};
        if (type === 'SubscriptionConfirmation') return;
        if (type === 'ShipStaticData' || type === 'StaticDataReport') {
          const mmsi = String(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI ?? '').trim();
          const details = normalizeStatic(type, payload, meta);
          if (mmsi && details) statics.set(mmsi, { ...(statics.get(mmsi) ?? {}), ...details });
          return;
        }
        const row = normalizePosition(type, payload, meta, statics);
        if (!row) return;
        rows.set(row.mmsi, row);
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(), 2500);
      } catch {}
    });

    socket.on('error', () => finish(new Error('AISStream connection failed')));
    socket.on('close', () => { if (!settled && rows.size > 0) finish(); });
  });
  return Array.from(rows.values());
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows ?? 1200) || 1200));
  const sampleMs = Math.max(5000, Math.min(22000, Number(req.query?.sampleMs ?? 18000) || 18000));
  res.setHeader('Cache-Control', 'no-store');
  if (!apiKey) {
    return res.status(503).json({ rows: [], status: 'missing-key', error: 'AISSTREAM_API_KEY is not configured on Vercel', coverage: 'Bermuda' });
  }
  try {
    const rows = (await sampleAis(apiKey, sampleMs)).slice(0, maxRows);
    return res.status(200).json({
      rows,
      source: 'AISStream',
      status: rows.length ? 'live' : 'no-sample',
      error: rows.length ? null : 'No AIS position messages arrived during this live sample window.',
      coverage: 'Bermuda',
      sampledAt: new Date().toISOString(),
      refreshing: rows.length === 0,
    });
  } catch (error) {
    return res.status(502).json({ rows: [], status: 'degraded', error: error instanceof Error ? error.message : 'AISStream unavailable', coverage: 'Bermuda', refreshing: true });
  }
}
