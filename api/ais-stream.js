import WebSocket from 'ws';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const BOUNDS = [[[31.7, -65.6], [32.9, -63.9]]];
const TYPES = ['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  if (!apiKey) {
    send(res, 'status', { status: 'missing-key', error: 'AISSTREAM_API_KEY is not configured on Vercel' });
    return res.end();
  }

  const statics = new Map();
  const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
  let closed = false;
  let vesselCount = 0;
  const heartbeat = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, 12000);
  const stopTimer = setTimeout(() => stop(), 55000);

  function stop() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(stopTimer);
    try { socket.close(); } catch {}
    try { res.end(); } catch {}
  }

  req.on('close', stop);

  socket.on('open', () => {
    socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: BOUNDS, FilterMessageTypes: TYPES }));
  });

  socket.on('message', raw => {
    try {
      const envelope = JSON.parse(raw.toString());
      const type = envelope?.MessageType || '';
      const payload = envelope?.Message?.[type] ?? {};
      const meta = envelope?.MetaData ?? {};
      if (type === 'SubscriptionConfirmation') {
        send(res, 'status', { status: 'live', source: 'AISStream', coverage: 'Bermuda' });
        return;
      }
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
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      const details = statics.get(mmsi) ?? {};
      vesselCount += 1;
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
      });
      if (vesselCount % 10 === 0) send(res, 'status', { status: 'live', source: 'AISStream', contactsReceived: vesselCount });
    } catch {}
  });

  socket.on('error', () => {
    if (!closed) send(res, 'status', { status: 'degraded', error: 'AISStream connection failed' });
    stop();
  });
  socket.on('close', () => stop());
}
