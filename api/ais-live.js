import WebSocket from 'ws';

const OPEN_WATERS_URL = 'https://ais.openwaters.io/v1/vessels';
const FACHA_URL = 'https://api.facha.dev/v1/ship/radius/32.3078/-64.7505/100';
const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BBOX = '31.55,-65.75,33.05,-63.75';
const AIS_BOUNDS = [[[31.55, -65.75], [33.05, -63.75]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNow(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function ageSeconds(iso) {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
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
    type: props.type ?? props.type_name ?? '',
    destination: String(props.destination ?? '').trim(),
    callSign: String(props.callsign ?? props.callSign ?? '').trim(),
    length: finite(props.length),
    beam: finite(props.beam),
    speed: finite(props.sog),
    course: finite(props.cog),
    heading: finite(props.heading),
    navStatus: props.nav_status_name ?? props.nav_status ?? '',
    last_position_UTC: isoOrNow(props.seen),
    age_s: ageSeconds(props.seen),
    source: String(props.source ?? 'Open Waters AIS'),
    station: String(props.station ?? ''),
  };
}

function normalizeFacha(row) {
  const mmsi = String(row?.mmsi ?? '').trim();
  const lat = finite(row?.latitude);
  const lon = finite(row?.longitude);
  if (!mmsi || lat === null || lon === null) return null;
  const bow = finite(row?.dimensionToBow);
  const stern = finite(row?.dimensionToStern);
  const length = bow !== null && stern !== null ? bow + stern : finite(row?.length);
  return {
    mmsi,
    lat,
    lon,
    name: String(row?.name ?? `MMSI ${mmsi}`).trim(),
    imo: row?.imoNumber ?? row?.imo ?? '',
    type: row?.vesselType ?? row?.vesselTypeSlug ?? row?.type ?? '',
    destination: String(row?.destination ?? '').trim(),
    callSign: String(row?.callSign ?? '').trim(),
    length,
    beam: finite(row?.beam),
    speed: finite(row?.speedOverGround),
    course: finite(row?.courseOverGround),
    heading: finite(row?.heading),
    navStatus: row?.navigationalStatus ?? '',
    last_position_UTC: isoOrNow(row?.timestamp),
    age_s: ageSeconds(row?.timestamp),
    source: 'facha.dev AIS',
    station: '',
  };
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json, application/geo+json', 'User-Agent': 'Bermuda-Ocean-Brain-Data-Proof/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenWaters() {
  const data = await fetchJson(`${OPEN_WATERS_URL}?bbox=${encodeURIComponent(BBOX)}`);
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map(normalizeOpenWaters).filter(Boolean);
}

async function fetchFacha() {
  const data = await fetchJson(FACHA_URL);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.vessels) ? data.vessels : Array.isArray(data?.data) ? data.data : [];
  return rows.map(normalizeFacha).filter(Boolean);
}

function mergeRows(groups, maxRows) {
  const merged = new Map();
  for (const rows of groups) {
    for (const row of rows) {
      if (!row?.mmsi) continue;
      const prev = merged.get(row.mmsi);
      if (!prev || Date.parse(row.last_position_UTC) >= Date.parse(prev.last_position_UTC)) merged.set(row.mmsi, { ...prev, ...row });
      else merged.set(row.mmsi, { ...row, ...prev });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => Date.parse(b.last_position_UTC) - Date.parse(a.last_position_UTC))
    .slice(0, maxRows);
}

function normalizeStatic(type, payload, meta) {
  if (type === 'ShipStaticData') {
    return {
      name: String(payload?.Name ?? meta?.ShipName ?? '').trim(),
      type: payload?.Type ?? payload?.ShipType ?? '',
      destination: String(payload?.Destination ?? '').trim(),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: String(payload?.CallSign ?? '').trim(),
    };
  }
  if (type === 'StaticDataReport') {
    return {
      name: String(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName ?? '').trim(),
      type: payload?.ShipType ?? payload?.ReportB?.ShipType ?? '',
      destination: String(payload?.Destination ?? payload?.ReportB?.Destination ?? '').trim(),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: String(payload?.CallSign ?? payload?.ReportB?.CallSign ?? '').trim(),
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
  const seen = isoOrNow(meta?.time_utc ?? meta?.TimeUTC);
  return {
    mmsi,
    lat,
    lon,
    name: String(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`).trim(),
    imo: details.imo || '',
    type: details.type ?? '',
    destination: details.destination || '',
    callSign: details.callSign || '',
    length: null,
    beam: null,
    speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(payload?.TrueHeading ?? payload?.Heading),
    navStatus: payload?.NavigationalStatus ?? payload?.NavigationStatus ?? '',
    last_position_UTC: seen,
    age_s: ageSeconds(seen),
    source: 'AISStream',
    station: '',
  };
}

async function sampleAis(apiKey, sampleMs) {
  const rows = new Map();
  const statics = new Map();
  const diag = { connected: false, frames: 0, positionFrames: 0, error: null };
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let settled = false;
    const hardTimer = setTimeout(() => finish(), sampleMs);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { socket.close(); } catch {}
      if (error) reject(error); else resolve();
    }
    socket.on('open', () => {
      diag.connected = true;
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: AIS_BOUNDS, FilterMessageTypes: TYPES }));
    });
    socket.on('message', raw => {
      diag.frames += 1;
      try {
        const envelope = JSON.parse(raw.toString());
        if (envelope?.error) {
          diag.error = String(envelope.error);
          return;
        }
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
        if (row) {
          diag.positionFrames += 1;
          rows.set(row.mmsi, row);
        }
      } catch {}
    });
    socket.on('error', () => finish(new Error('AISStream connection failed')));
    socket.on('close', () => { if (!settled && rows.size > 0) finish(); });
  });
  return { rows: Array.from(rows.values()), diag };
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows ?? 1200) || 1200));
  const diagnosticsMode = String(req.query?.diagnostic ?? '') === '1';
  const sampleMs = diagnosticsMode ? 12000 : 7000;
  res.setHeader('Cache-Control', 'no-store');

  const diagnostics = [];
  const groups = [];

  const openStarted = Date.now();
  try {
    const rows = await fetchOpenWaters();
    groups.push(rows);
    diagnostics.push({ source: 'Open Waters', ok: true, count: rows.length, ms: Date.now() - openStarted, coverage: BBOX, note: 'Last-known positions up to 30 minutes when coverage exists.' });
  } catch (error) {
    diagnostics.push({ source: 'Open Waters', ok: false, count: 0, ms: Date.now() - openStarted, error: String(error?.message || error) });
  }

  const fachaStarted = Date.now();
  try {
    const rows = await fetchFacha();
    groups.push(rows);
    diagnostics.push({ source: 'facha.dev', ok: true, count: rows.length, ms: Date.now() - fachaStarted, coverage: '100 km radius' });
  } catch (error) {
    diagnostics.push({ source: 'facha.dev', ok: false, count: 0, ms: Date.now() - fachaStarted, error: String(error?.message || error) });
  }

  if (apiKey && (diagnosticsMode || mergeRows(groups, maxRows).length === 0)) {
    const aisStarted = Date.now();
    try {
      const sampled = await sampleAis(apiKey, sampleMs);
      groups.push(sampled.rows);
      diagnostics.push({ source: 'AISStream', ok: true, count: sampled.rows.length, ms: Date.now() - aisStarted, connected: sampled.diag.connected, frames: sampled.diag.frames, positionFrames: sampled.diag.positionFrames, streamError: sampled.diag.error, sampleMs });
    } catch (error) {
      diagnostics.push({ source: 'AISStream', ok: false, count: 0, ms: Date.now() - aisStarted, error: String(error?.message || error), sampleMs });
    }
  } else if (!apiKey) {
    diagnostics.push({ source: 'AISStream', ok: false, count: 0, error: 'AISSTREAM_API_KEY missing from Production environment.' });
  } else {
    diagnostics.push({ source: 'AISStream', ok: true, count: null, skipped: true, note: 'Snapshot source already returned vessels; add ?diagnostic=1 to force a live sample.' });
  }

  const rows = mergeRows(groups, maxRows);
  const status = rows.length ? 'data-present' : 'no-data-received';
  return res.status(200).json({
    rows,
    source: rows.length ? Array.from(new Set(rows.map(row => row.source))).join(' + ') : 'No vessel source returned positions',
    status,
    error: rows.length ? null : 'No AIS vessel positions were received from the configured sources. This is a feed/coverage result, not proof that Bermuda has zero vessels.',
    coverage: 'Bermuda operational region',
    sampledAt: new Date().toISOString(),
    diagnostics,
  });
}
