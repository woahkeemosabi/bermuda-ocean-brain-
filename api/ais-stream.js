import WebSocket from 'ws';

const OPEN_WATERS_WS = 'wss://ais.openwaters.io/v1/stream';
const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const FACHA_URL = 'https://api.facha.dev/v1/ship/radius/32.3078/-64.7505/100';
const NATIVE_BBOX = [[31.55, -65.75, 33.05, -63.75]];
const AIS_BOUNDS = [[[31.55, -65.75], [33.05, -63.75]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];

function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function isoOrNow(value) { const parsed = Date.parse(String(value ?? '')); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }

function normalizeFacha(row) {
  const mmsi = String(row?.mmsi ?? '').trim();
  const lat = finite(row?.latitude); const lon = finite(row?.longitude);
  if (!mmsi || lat === null || lon === null) return null;
  const bow = finite(row?.dimensionToBow); const stern = finite(row?.dimensionToStern);
  return { mmsi, lat, lon, name: String(row?.name ?? `MMSI ${mmsi}`).trim(), imo: row?.imoNumber ?? '', type: row?.vesselType ?? row?.vesselTypeSlug ?? row?.type ?? '', destination: String(row?.destination ?? '').trim(), callSign: String(row?.callSign ?? '').trim(), length: bow !== null && stern !== null ? bow + stern : null, speed: finite(row?.speedOverGround), course: finite(row?.courseOverGround), heading: finite(row?.heading), last_position_UTC: isoOrNow(row?.timestamp), source: 'facha.dev AIS', retained: true };
}

async function seedFacha(res, signal) {
  const response = await fetch(FACHA_URL, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`facha.dev HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.vessels) ? data.vessels : Array.isArray(data?.data) ? data.data : [];
  let count = 0;
  for (const raw of rows) { const row = normalizeFacha(raw); if (!row) continue; send(res, 'vessel', row); count++; }
  if (count) send(res, 'status', { status: 'live', source: 'facha.dev AIS', contactsReceived: count, retainedSnapshot: true });
  return count;
}

function normalizeOpenWaters(frame) {
  if (frame?.type !== 'event') return null;
  const mmsi = String(frame?.mmsi ?? frame?.MMSI ?? frame?.message?.UserID ?? '').trim();
  const lat = finite(frame?.lat ?? frame?.latitude ?? frame?.message?.Latitude);
  const lon = finite(frame?.lon ?? frame?.longitude ?? frame?.message?.Longitude);
  if (!mmsi || lat === null || lon === null) return null;
  const payload = frame?.message ?? frame?.decoded ?? {};
  return {
    mmsi, lat, lon,
    name: String(frame?.name ?? frame?.ship_name ?? payload?.Name ?? `MMSI ${mmsi}`).trim(),
    type: frame?.ship_type ?? frame?.vessel_type ?? payload?.ShipType ?? payload?.Type ?? '',
    destination: String(frame?.destination ?? payload?.Destination ?? '').trim(),
    imo: frame?.imo ?? payload?.ImoNumber ?? '',
    callSign: String(frame?.callsign ?? frame?.call_sign ?? payload?.CallSign ?? '').trim(),
    length: finite(frame?.length),
    speed: finite(frame?.sog ?? payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(frame?.cog ?? payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(frame?.heading ?? payload?.TrueHeading ?? payload?.Heading),
    last_position_UTC: isoOrNow(frame?.time ?? frame?.seen ?? frame?.timestamp),
    source: String(frame?.source ?? 'Open Waters AIS'),
    station: String(frame?.station ?? ''),
    retained: Boolean(frame?.snapshot ?? frame?.synthesized),
  };
}

async function streamOpenWaters(res, stop) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(OPEN_WATERS_WS, { perMessageDeflate: true });
    let settled = false;
    const finish = (error) => { if (settled) return; settled = true; try { socket.close(); } catch {} error ? reject(error) : resolve(); };
    stop.onStop(() => finish());
    socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe', bbox: NATIVE_BBOX, snapshot: true })));
    socket.on('message', raw => {
      try {
        const frame = JSON.parse(raw.toString());
        if (frame?.type === 'error') return finish(new Error(String(frame?.error ?? frame?.message ?? 'Open Waters stream error')));
        if (frame?.type === 'ack' || frame?.type === 'welcome') { send(res, 'status', { status: 'live', source: 'Open Waters AIS', retainedSnapshot: true }); return; }
        const row = normalizeOpenWaters(frame); if (row) send(res, 'vessel', row);
      } catch {}
    });
    socket.on('error', () => finish(new Error('Open Waters WebSocket failed')));
    socket.on('close', () => finish());
  });
}

async function streamAisStream(res, apiKey, stop) {
  await new Promise(resolve => {
    const statics = new Map();
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let finished = false;
    const finish = () => { if (finished) return; finished = true; try { socket.close(); } catch {} resolve(); };
    stop.onStop(finish);
    socket.on('open', () => { socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: AIS_BOUNDS, FilterMessageTypes: TYPES })); send(res, 'status', { status: 'live', source: 'AISStream fallback' }); });
    socket.on('message', raw => {
      try {
        const envelope = JSON.parse(raw.toString()); const type = envelope?.MessageType || ''; const payload = envelope?.Message?.[type] ?? {}; const meta = envelope?.MetaData ?? {};
        const mmsi = String(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI ?? '').trim(); if (!mmsi) return;
        if (type === 'ShipStaticData' || type === 'StaticDataReport') { const prev = statics.get(mmsi) ?? {}; statics.set(mmsi, { ...prev, name: String(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName ?? prev.name ?? '').trim(), type: payload?.Type ?? payload?.ShipType ?? payload?.ReportB?.ShipType ?? prev.type ?? '', destination: String(payload?.Destination ?? payload?.ReportB?.Destination ?? prev.destination ?? '').trim(), imo: payload?.ImoNumber ?? payload?.IMO ?? prev.imo ?? '', callSign: String(payload?.CallSign ?? payload?.ReportB?.CallSign ?? prev.callSign ?? '').trim() }); return; }
        if (!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'].includes(type)) return;
        const lat = finite(meta?.Latitude ?? meta?.latitude ?? payload?.Latitude); const lon = finite(meta?.Longitude ?? meta?.longitude ?? payload?.Longitude); if (lat === null || lon === null) return;
        const details = statics.get(mmsi) ?? {};
        send(res, 'vessel', { mmsi, lat, lon, name: String(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`).trim(), type: details.type ?? '', destination: details.destination || '', imo: details.imo || '', callSign: details.callSign || '', speed: finite(payload?.Sog ?? payload?.SpeedOverGround), course: finite(payload?.Cog ?? payload?.CourseOverGround), heading: finite(payload?.TrueHeading ?? payload?.Heading), last_position_UTC: isoOrNow(meta?.time_utc ?? meta?.TimeUTC), source: 'AISStream', retained: false });
      } catch {}
    });
    socket.on('error', finish); socket.on('close', finish);
  });
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.();

  let closed = false; const controller = new AbortController(); const callbacks = new Set();
  const stop = { onStop(callback) { callbacks.add(callback); }, run() { if (closed) return; closed = true; controller.abort(); for (const callback of callbacks) { try { callback(); } catch {} } try { res.end(); } catch {} } };
  const heartbeat = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, 12000);
  const stopTimer = setTimeout(() => stop.run(), 55000); req.on('close', () => stop.run());

  try { await seedFacha(res, controller.signal); } catch (error) { send(res, 'status', { status: 'degraded', source: 'facha.dev AIS', error: error instanceof Error ? error.message : 'snapshot unavailable' }); }
  if (!closed) {
    try { await streamOpenWaters(res, stop); }
    catch (error) { if (!closed) { send(res, 'status', { status: 'degraded', source: 'Open Waters AIS', error: error instanceof Error ? error.message : 'stream unavailable' }); if (apiKey) await streamAisStream(res, apiKey, stop); } }
  }

  clearInterval(heartbeat); clearTimeout(stopTimer); stop.run();
}
