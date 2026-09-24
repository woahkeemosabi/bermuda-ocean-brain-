import WebSocket from 'ws';

const OPEN_WATERS_URL = 'https://ais.openwaters.io/v1/vessels';
const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BBOX = '31.55,-65.75,33.05,-63.75';
const AIS_BOUNDS = [[[31.55, -65.75], [33.05, -63.75]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];
const RETAIN_MS = 30 * 60 * 1000;

let lastSuccessfulRows = [];
let lastSuccessfulAt = 0;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNow(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeOpenWaters(feature) {
  const props = feature?.properties ?? {};
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = finite(coordinates[0]);
  const lat = finite(coordinates[1]);
  const mmsi = String(props.mmsi ?? feature?.id ?? '').trim();
  if (!mmsi || lat === null || lon === null) return null;
  return {
    mmsi,
    lat,
    lon,
    name: String(props.name ?? `MMSI ${mmsi}`).trim(),
    imo: props.imo ?? '',
    type: props.type ?? '',
    destination: String(props.destination ?? '').trim(),
    callSign: String(props.callsign ?? props.callSign ?? '').trim(),
    length: finite(props.length),
    speed: finite(props.sog),
    course: finite(props.cog),
    heading: finite(props.heading),
    navStatus: props.nav_status ?? '',
    last_position_UTC: isoOrNow(props.seen),
    source: String(props.source ?? 'Open Waters AIS'),
    station: String(props.station ?? ''),
    retained: true,
  };
}

async function fetchOpenWaters(maxRows) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${OPEN_WATERS_URL}?bbox=${encodeURIComponent(BBOX)}`, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Open Waters HTTP ${response.status}`);
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return features.map(normalizeOpenWaters).filter(Boolean).slice(0, maxRows);
  } finally {
    clearTimeout(timeout);
  }
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
  return {
    mmsi,
    lat,
    lon,
    name: String(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`).trim(),
    imo: details.imo || '',
    type: details.type ?? '',
    destination: details.destination || '',
    callSign: details.callSign || '',
    length: details.length ?? null,
    speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(payload?.TrueHeading ?? payload?.Heading),
    last_position_UTC: isoOrNow(meta?.time_utc ?? meta?.TimeUTC),
    source: 'AISStream',
    retained: false,
  };
}

async function sampleAis(apiKey, sampleMs) {
  const rows = new Map();
  const statics = new Map();
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let settled = false;
    const hardTimer = setTimeout(() => finish(), sampleMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve();
    }

    socket.on('open', () => {
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: AIS_BOUNDS, FilterMessageTypes: TYPES }));
    });

    socket.on('message', raw => {
      try {
        const envelope = JSON.parse(raw.toString());
        const type = envelope?.MessageType || '';
        const payload = envelope?.Message?.[type] ?? {};
        const meta = envelope?.MetaData ?? {};
        if (type === 'ShipStaticData' || type === 'StaticDataReport') {
          const mmsi = String(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI ?? '').trim();
          const details = normalizeStatic(type, payload, meta);
          if (mmsi && details) statics.set(mmsi, { ...(statics.get(mmsi) ?? {}), ...details });
          return;
        }
        const row = normalizePosition(type, payload, meta, statics);
        if (row) rows.set(row.mmsi, row);
      } catch {}
    });

    socket.on('error', () => finish(new Error('AISStream connection failed')));
    socket.on('close', () => { if (!settled && rows.size > 0) finish(); });
  });
  return Array.from(rows.values());
}

function remember(rows) {
  if (!rows.length) return;
  lastSuccessfulRows = rows;
  lastSuccessfulAt = Date.now();
}

function cachedRows(maxRows) {
  if (!lastSuccessfulRows.length || Date.now() - lastSuccessfulAt > RETAIN_MS) return [];
  return lastSuccessfulRows.slice(0, maxRows).map(row => ({ ...row, retained: true }));
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows ?? 1200) || 1200));
  res.setHeader('Cache-Control', 'no-store');

  try {
    const retained = await fetchOpenWaters(maxRows);
    if (retained.length) {
      remember(retained);
      return res.status(200).json({
        rows: retained,
        source: 'Open Waters AIS · retained 30 min',
        status: 'retained-live',
        error: null,
        coverage: 'Bermuda waters',
        sampledAt: new Date().toISOString(),
        refreshing: false,
        retentionMinutes: 30,
      });
    }
  } catch (error) {
    console.warn('Open Waters retained AIS unavailable', error instanceof Error ? error.message : error);
  }

  if (apiKey) {
    try {
      const liveRows = (await sampleAis(apiKey, 9000)).slice(0, maxRows);
      if (liveRows.length) {
        remember(liveRows);
        return res.status(200).json({
          rows: liveRows,
          source: 'AISStream · live sample',
          status: 'live',
          error: null,
          coverage: 'Bermuda waters',
          sampledAt: new Date().toISOString(),
          refreshing: false,
          retentionMinutes: 30,
        });
      }
    } catch (error) {
      console.warn('AISStream fallback unavailable', error instanceof Error ? error.message : error);
    }
  }

  const cached = cachedRows(maxRows);
  if (cached.length) {
    return res.status(200).json({
      rows: cached,
      source: 'Bermuda Ocean Brain · recent AIS cache',
      status: 'recent-cache',
      error: null,
      coverage: 'Bermuda waters',
      sampledAt: new Date(lastSuccessfulAt).toISOString(),
      refreshing: true,
      retentionMinutes: 30,
    });
  }

  return res.status(200).json({
    rows: [],
    source: 'AIS coverage scan',
    status: 'no-coverage',
    error: null,
    coverage: 'Bermuda waters',
    sampledAt: new Date().toISOString(),
    refreshing: true,
    retentionMinutes: 30,
  });
}
