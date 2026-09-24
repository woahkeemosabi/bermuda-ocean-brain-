import WebSocket from 'ws';

export const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
export const BOUNDS = [[[31.55, -65.75], [33.05, -63.75]]];
export const MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];

export const VESSEL_TTL_MS = 30 * 60_000;

export function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return String(value ?? '').replace(/\0/g, '').trim();
}

function normalizeStatic(type, payload, meta) {
  if (type === 'ShipStaticData') {
    const a = finite(payload?.Dimension?.A ?? payload?.DimensionA ?? payload?.ToBow);
    const b = finite(payload?.Dimension?.B ?? payload?.DimensionB ?? payload?.ToStern);
    return {
      name: cleanText(payload?.Name ?? meta?.ShipName),
      type: payload?.Type ?? payload?.ShipType ?? '',
      destination: cleanText(payload?.Destination),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: cleanText(payload?.CallSign),
      length: a !== null && b !== null ? a + b : null,
    };
  }

  if (type === 'StaticDataReport') {
    return {
      name: cleanText(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName),
      type: payload?.ShipType ?? payload?.ReportB?.ShipType ?? '',
      destination: cleanText(payload?.Destination ?? payload?.ReportB?.Destination),
      imo: payload?.ImoNumber ?? payload?.IMO ?? '',
      callSign: cleanText(payload?.CallSign ?? payload?.ReportB?.CallSign),
      length: null,
    };
  }

  return null;
}

function normalizePosition(type, payload, meta, details = {}) {
  if (!['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'].includes(type)) return null;

  const mmsi = cleanText(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI);
  const lat = finite(meta?.Latitude ?? meta?.latitude ?? payload?.Latitude);
  const lon = finite(meta?.Longitude ?? meta?.longitude ?? payload?.Longitude);
  if (!mmsi || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    mmsi,
    lat,
    lon,
    name: cleanText(details.name || meta?.ShipName || payload?.Name || `MMSI ${mmsi}`),
    imo: details.imo || '',
    type: details.type ?? '',
    destination: details.destination || '',
    callSign: details.callSign || '',
    length: details.length ?? null,
    speed: finite(payload?.Sog ?? payload?.SpeedOverGround),
    course: finite(payload?.Cog ?? payload?.CourseOverGround),
    heading: finite(payload?.TrueHeading ?? payload?.Heading),
    last_position_UTC: cleanText(meta?.time_utc ?? meta?.TimeUTC) || new Date().toISOString(),
    lastSeenAt: Date.now(),
  };
}

export function pruneRows(rows, now = Date.now(), ttlMs = VESSEL_TTL_MS) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const seen = Number(row?.lastSeenAt ?? Date.parse(row?.last_position_UTC ?? ''));
    return Number.isFinite(seen) && now - seen <= ttlMs;
  });
}

export async function collectAis(apiKey, { sampleMs = 48_000, seedRows = [] } = {}) {
  const rows = new Map();
  const statics = new Map();
  const now = Date.now();

  for (const row of pruneRows(seedRows, now)) {
    const mmsi = cleanText(row?.mmsi);
    if (!mmsi) continue;
    rows.set(mmsi, { ...row });
    statics.set(mmsi, {
      name: cleanText(row?.name),
      type: row?.type ?? '',
      destination: cleanText(row?.destination),
      imo: row?.imo ?? '',
      callSign: cleanText(row?.callSign),
      length: finite(row?.length),
    });
  }

  const diagnostics = {
    source: 'AISStream',
    scope: 'bermuda',
    coverage: '31.55,-65.75,33.05,-63.75',
    connected: false,
    subscriptionConfirmed: false,
    frames: 0,
    positionFrames: 0,
    staticFrames: 0,
    parseErrors: 0,
    sampleMs,
    compressionEnabled: true,
    closeCode: null,
    closeReason: '',
    error: null,
  };

  await new Promise((resolve) => {
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true });
    let settled = false;
    const hardTimer = setTimeout(finish, sampleMs);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { socket.close(1000, 'sample-complete'); } catch {}
      resolve();
    }

    socket.on('open', () => {
      diagnostics.connected = true;
      try {
        socket.send(JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: BOUNDS,
          FilterMessageTypes: MESSAGE_TYPES,
        }));
      } catch (error) {
        diagnostics.error = error instanceof Error ? error.message : String(error);
        finish();
      }
    });

    socket.on('message', (raw) => {
      diagnostics.frames += 1;
      try {
        const envelope = JSON.parse(raw.toString());
        const type = envelope?.MessageType || '';
        const payload = envelope?.Message?.[type] ?? {};
        const meta = envelope?.MetaData ?? {};

        if (type === 'SubscriptionConfirmation') {
          diagnostics.subscriptionConfirmed = true;
          return;
        }

        const mmsi = cleanText(meta?.MMSI ?? payload?.UserID ?? payload?.MMSI);

        if (type === 'ShipStaticData' || type === 'StaticDataReport') {
          diagnostics.staticFrames += 1;
          const details = normalizeStatic(type, payload, meta);
          if (mmsi && details) {
            const merged = { ...(statics.get(mmsi) ?? {}), ...details };
            statics.set(mmsi, merged);
            if (rows.has(mmsi)) rows.set(mmsi, { ...rows.get(mmsi), ...merged });
          }
          return;
        }

        const row = normalizePosition(type, payload, meta, statics.get(mmsi) ?? {});
        if (!row) return;
        diagnostics.positionFrames += 1;
        rows.set(row.mmsi, { ...(rows.get(row.mmsi) ?? {}), ...row });
      } catch {
        diagnostics.parseErrors += 1;
      }
    });

    socket.on('error', (error) => {
      diagnostics.error = error instanceof Error ? error.message : 'AISStream connection failed';
      if (!diagnostics.subscriptionConfirmed) finish();
    });

    socket.on('close', (code, reason) => {
      diagnostics.closeCode = Number(code);
      diagnostics.closeReason = cleanText(reason?.toString?.());
      if (!settled) finish();
    });
  });

  const freshRows = pruneRows(Array.from(rows.values()));
  return { rows: freshRows, diagnostics };
}
