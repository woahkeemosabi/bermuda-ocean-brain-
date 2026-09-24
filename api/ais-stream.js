import WebSocket from 'ws';

const OPEN_WATERS_STREAM = 'https://ais.openwaters.io/v1/stream';
const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BBOX = '31.55,-65.75,33.05,-63.75';
const AIS_BOUNDS = [[[31.55, -65.75], [33.05, -63.75]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function normalizeOpenWatersEvent(frame, statics) {
  if (frame?.type !== 'event') return null;
  const mmsi = String(frame?.mmsi ?? frame?.message?.UserID ?? '').trim();
  if (!mmsi) return null;
  const payload = frame?.message ?? {};
  const msgType = String(frame?.msg_type ?? '');
  const previous = statics.get(mmsi) ?? {};
  if (msgType === 'ShipStaticData' || msgType === 'StaticDataReport') {
    const details = {
      ...previous,
      name: String(payload?.Name ?? payload?.ReportA?.Name ?? previous.name ?? '').trim(),
      type: payload?.Type ?? payload?.ShipType ?? payload?.ReportB?.ShipType ?? previous.type ?? '',
      destination: String(payload?.Destination ?? payload?.ReportB?.Destination ?? previous.destination ?? '').trim(),
      imo: payload?.ImoNumber ?? payload?.IMO ?? previous.imo ?? '',
      callSign: String(payload?.CallSign ?? payload?.ReportB?.CallSign ?? previous.callSign ?? '').trim(),
    };
    statics.set(mmsi, details);
  }
  const lat = finite(frame?.lat ?? payload?.Latitude);
  const lon = finite(frame?.lon ?? payload?.Longitude);
  if (lat === null || lon === null) return null;
  const details = statics.get(mmsi) ?? previous;
  return {
    mmsi,
    lat,
    lon,
    name: String(details.name || payload?.Name || `MMSI ${mmsi}`).trim(),
    type: details.type ?? payload?.Type ?? payload?.ShipType ?? '',
    destination: details.destination || '',
    imo: details.imo || '',
    callSign: details.callSign || '',
    speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(payload?.TrueHeading ?? payload?.Heading),
    last_position_UTC: String(frame?.time ?? new Date().toISOString()),
    source: String(frame?.source ?? 'Open Waters AIS'),
    station: String(frame?.station ?? ''),
    retained: Boolean(frame?.synthesized),
  };
}

async function streamOpenWaters(res, abortSignal) {
  const url = `${OPEN_WATERS_STREAM}?bbox=${encodeURIComponent(BBOX)}&snapshot=1`;
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'gzip' },
    signal: abortSignal,
  });
  if (!response.ok || !response.body) throw new Error(`Open Waters stream HTTP ${response.status}`);

  send(res, 'status', { status: 'live', source: 'Open Waters AIS', coverage: 'Bermuda waters', retainedSnapshot: true });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const statics = new Map();
  let buffer = '';
  let contactsReceived = 0;

  while (!abortSignal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      try {
        const frame = JSON.parse(line.slice(5).trim());
        if (frame?.type === 'error') throw new Error(String(frame.error || 'Open Waters stream error'));
        const row = normalizeOpenWatersEvent(frame, statics);
        if (!row) continue;
        contactsReceived += 1;
        send(res, 'vessel', row);
        if (contactsReceived % 10 === 0) send(res, 'status', { status: 'live', source: 'Open Waters AIS', contactsReceived });
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
}

async function streamAisStream(res, apiKey, stop) {
  await new Promise(resolve => {
    const statics = new Map();
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch {}
      resolve();
    };
    stop.onStop(finish);

    socket.on('open', () => {
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: AIS_BOUNDS, FilterMessageTypes: TYPES }));
      send(res, 'status', { status: 'live', source: 'AISStream fallback', coverage: 'Bermuda waters' });
    });

    socket.on('message', raw => {
      try {
        const envelope = JSON.parse(raw.toString());
        const type = envelope?.MessageType || '';
        const payload = envelope?.Message?.[type] ?? {};
        const meta = envelope?.MetaData ?? {};
        const mmsi = String(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI ?? '').trim();
        if (!mmsi) return;
        if (type === 'ShipStaticData' || type === 'StaticDataReport') {
          const previous = statics.get(mmsi) ?? {};
          statics.set(mmsi, {
            ...previous,
            name: String(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName ?? previous.name ?? '').trim(),
            type: payload?.Type ?? payload?.ShipType ?? payload?.ReportB?.ShipType ?? previous.type ?? '',
            destination: String(payload?.Destination ?? payload?.ReportB?.Destination ?? previous.destination ?? '').trim(),
            imo: payload?.ImoNumber ?? payload?.IMO ?? previous.imo ?? '',
            callSign: String(payload?.CallSign ?? payload?.ReportB?.CallSign ?? previous.callSign ?? '').trim(),
          });
          return;
        }
        if (!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport'].includes(type)) return;
        const lat = finite(meta?.Latitude ?? meta?.latitude ?? payload?.Latitude);
        const lon = finite(meta?.Longitude ?? meta?.longitude ?? payload?.Longitude);
        if (lat === null || lon === null) return;
        const details = statics.get(mmsi) ?? {};
        send(res, 'vessel', {
          mmsi,
          lat,
          lon,
          name: String(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`).trim(),
          type: details.type ?? '',
          destination: details.destination || '',
          imo: details.imo || '',
          callSign: details.callSign || '',
          speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
          course: finite(payload?.Cog ?? payload?.CourseOverGround),
          heading: finite(payload?.TrueHeading ?? payload?.Heading),
          last_position_UTC: String(meta?.time_utc ?? meta?.TimeUTC ?? new Date().toISOString()),
          source: 'AISStream',
          retained: false,
        });
      } catch {}
    });

    socket.on('error', finish);
    socket.on('close', finish);
  });
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const controller = new AbortController();
  const callbacks = new Set();
  const stop = {
    onStop(callback) { callbacks.add(callback); },
    run() {
      if (closed) return;
      closed = true;
      controller.abort();
      for (const callback of callbacks) { try { callback(); } catch {} }
      try { res.end(); } catch {}
    },
  };
  const heartbeat = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, 12000);
  const stopTimer = setTimeout(() => stop.run(), 55000);
  req.on('close', () => stop.run());

  try {
    await streamOpenWaters(res, controller.signal);
  } catch (error) {
    if (!closed) {
      send(res, 'status', { status: 'degraded', error: error instanceof Error ? error.message : 'Open Waters stream unavailable', source: 'Open Waters AIS' });
      if (apiKey) await streamAisStream(res, apiKey, stop);
    }
  } finally {
    clearInterval(heartbeat);
    clearTimeout(stopTimer);
    stop.run();
  }
}
