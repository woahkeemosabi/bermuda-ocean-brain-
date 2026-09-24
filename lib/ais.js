import WebSocket from 'ws';

export const BOUNDS = [31.55, -65.75, 33.05, -63.75];
export const FACHA_URL = 'https://api.facha.dev/v1/ship/radius/32.3078/-64.7505/30';
export const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'];
const POSITIONS = new Set(TYPES.slice(0, 3));
const MAX_AGE_S = 1800;

export function finite(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function timestamp(value) {
  if (value == null || value === '') return null;
  // AISStream also emits Go UTC strings, with nanoseconds and a numeric offset.
  const text = String(value).trim().replace(/ UTC$/, '').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(/^(\d{4}-\d\d-\d\d) /, '$1T');
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function ageSeconds(value, now = Date.now()) {
  const t = timestamp(value);
  return t ? Math.max(0, Math.round((now - Date.parse(t)) / 1000)) : null;
}
export function inBounds(lat, lon, bounds = BOUNDS) {
  return lat >= bounds[0] && lat <= bounds[2] && lon >= bounds[1] && lon <= bounds[3];
}
const text = value => String(value ?? '').trim();
const metric = (value, upper) => { const n = finite(value); return n !== null && n >= 0 && n < upper ? n : null; };
const dimension = (a, b) => { a = finite(a); b = finite(b); return a !== null && b !== null && a >= 0 && b >= 0 ? a + b : null; };
function position(row, bounds = BOUNDS) {
  const mmsi = text(row.mmsi), lat = finite(row.lat), lon = finite(row.lon);
  if (!/^\d{9}$/.test(mmsi) || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (bounds && !inBounds(lat, lon, bounds))) return null;
  const seen = timestamp(row.last_position_UTC);
  return { ...row, mmsi, lat, lon, name: text(row.name) || `MMSI ${mmsi}`, last_position_UTC: seen, age_s: ageSeconds(seen) };
}
export function normalizeFacha(row, bounds = BOUNDS) {
  return position({
    mmsi: row?.mmsi, lat: row?.latitude, lon: row?.longitude, name: row?.name,
    imo: row?.imoNumber ?? row?.imo ?? '', type: row?.vesselType ?? row?.vesselTypeSlug ?? row?.type ?? '',
    destination: text(row?.destination), callSign: text(row?.callSign),
    length: dimension(row?.dimensionToBow, row?.dimensionToStern) ?? finite(row?.length),
    beam: dimension(row?.dimensionToPort, row?.dimensionToStarboard) ?? finite(row?.beam),
    speed: metric(row?.speedOverGround, 102.3), course: metric(row?.courseOverGround, 360), heading: metric(row?.heading, 360),
    navStatus: row?.navigationalStatus ?? '', last_position_UTC: row?.timestamp, source: 'facha.dev AIS', station: '',
  }, bounds);
}
export function normalizeOpenWaters(feature, bounds = BOUNDS) {
  const p = feature?.properties ?? {}, c = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(c) || (p.kind && p.kind !== 'vessel')) return null;
  return position({
    mmsi: p.mmsi ?? feature.id, lat: c[1], lon: c[0], name: p.name,
    imo: p.imo ?? '', type: p.type_name ?? p.type ?? '', destination: text(p.destination), callSign: text(p.callsign ?? p.callSign),
    length: finite(p.length), beam: finite(p.beam), speed: metric(p.sog, 102.3), course: metric(p.cog, 360), heading: metric(p.heading, 360),
    navStatus: p.nav_status_name ?? p.nav_status ?? '', last_position_UTC: p.seen,
    source: text(p.source) || 'Open Waters AIS', station: text(p.station),
  }, bounds);
}
export function mergeRows(groups, maxRows = 1200) {
  const rows = new Map();
  for (const group of groups) for (const row of group) {
    const prev = rows.get(row.mmsi);
    if (!prev) { rows.set(row.mmsi, row); continue; }
    const time = r => r.last_position_UTC ? Date.parse(r.last_position_UTC) : -Infinity;
    const [newer, older] = time(row) >= time(prev) ? [row, prev] : [prev, row];
    const merged = { ...newer };
    for (const key of ['name', 'type', 'imo', 'callSign', 'destination', 'length', 'beam']) {
      if (merged[key] == null || merged[key] === '' || (key === 'name' && merged[key] === `MMSI ${row.mmsi}`)) merged[key] = older[key];
    }
    rows.set(row.mmsi, merged);
  }
  return [...rows.values()].map(row => ({ ...row, age_s: ageSeconds(row.last_position_UTC) }))
    .sort((a, b) => (Date.parse(b.last_position_UTC) || 0) - (Date.parse(a.last_position_UTC) || 0)).slice(0, maxRows);
}
export function freshness(rows) {
  const fresh = rows.filter(r => r.age_s !== null && r.age_s <= MAX_AGE_S).length;
  return { fresh, stale: rows.filter(r => r.age_s !== null && r.age_s > MAX_AGE_S).length, unknown: rows.filter(r => r.age_s === null).length };
}
export async function fetchSnapshot(source, { control = false, signal, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const isFacha = source === 'facha.dev';
  const bounds = control ? (isFacha ? [38.3, -9.7, 39.1, -8.6] : [59, 10, 60, 11]) : BOUNDS;
  const url = isFacha ? (control ? 'https://api.facha.dev/v1/ship/radius/38.70/-9.15/30' : FACHA_URL)
    : `https://ais.openwaters.io/v1/vessels?bbox=${bounds.join(',')}`;
  const started = Date.now();
  const diag = { source, scope: control ? 'reference-only' : 'bermuda', coverage: isFacha ? (control ? 'Lisbon, 30 km radius' : 'Bermuda, 30 km radius') : bounds.join(','), ok: false, count: 0 };
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, { headers: { Accept: 'application/json, application/geo+json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    diag.httpStatus = response.status;
    if (!response.ok) {
      let reason = '';
      try { const body = await response.json(); reason = text(body.error ?? body.message).slice(0, 240); } catch {}
      throw new Error(`HTTP ${response.status}${reason ? `: ${reason}` : ''}`);
    }
    const data = await response.json();
    const raw = isFacha ? (Array.isArray(data) ? data : data?.vessels ?? data?.data) : data?.features;
    if (!Array.isArray(raw)) throw new Error('Unexpected response schema: expected a vessel array');
    const normalize = isFacha ? normalizeFacha : normalizeOpenWaters;
    const rows = raw.map(row => normalize(row, bounds)).filter(Boolean);
    Object.assign(diag, { ok: true, status: rows.length ? 'positions-received' : 'empty-snapshot', rawCount: raw.length, rejected: raw.length - rows.length, count: rows.length });
    return { rows, diag: { ...diag, ms: Date.now() - started, note: rows.length ? 'Source timestamps preserved; coverage is receiver-dependent.' : 'Source responded, but supplied no positions for this area. This does not establish that the area is empty.' } };
  } catch (error) {
    return { rows: [], diag: { ...diag, status: 'failed', ms: Date.now() - started, error: text(error?.message || error) } };
  }
}

function staticDetails(payload, meta) {
  return {
    name: text(payload?.Name ?? payload?.ReportA?.Name ?? meta?.ShipName),
    type: payload?.Type ?? payload?.ShipType ?? payload?.ReportB?.ShipType ?? '',
    destination: text(payload?.Destination), imo: payload?.ImoNumber ?? payload?.IMO ?? '',
    callSign: text(payload?.CallSign ?? payload?.ReportB?.CallSign),
  };
}
function addDetails(previous = {}, next = {}) {
  return { ...previous, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== '' && value != null)) };
}

// Each invocation owns its sockets, timers and records. Nothing is presented as a durable cache.
export async function sampleStream({ source = 'AISStream', apiKey, control = false, durationMs = 12000, mmsi, signal, onRow = () => {}, onStatus = () => {}, WebSocketImpl = WebSocket } = {}) {
  const started = Date.now(), rows = new Map(), statics = new Map();
  const native = source === 'Open Waters';
  const bounds = control ? (native ? [59, 10, 60, 11] : [-90, -180, 90, 180]) : BOUNDS;
  const diag = { source, scope: control ? 'reference-only' : 'bermuda', ok: false, status: 'connecting', count: 0, connected: false, subscriptionConfirmed: false, frames: 0, positionFrames: 0, rejected: 0, parseErrors: 0, sampleMs: durationMs };
  if (!native && !apiKey) return { rows: [], diag: { ...diag, status: 'not-configured', error: 'AISSTREAM_API_KEY is not configured for this deployment.', ms: 0 } };
  await new Promise(resolve => {
    let socket, finished = false, timer;
    function finish(status, error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) diag.error = text(error).split(apiKey || '\0').join('[redacted]').slice(0, 240);
      diag.status = status;
      // terminate also cancels an unfinished handshake and does not leave a closing socket behind.
      try { socket?.terminate(); } catch {}
      resolve();
    }
    const abort = () => finish('cancelled', 'Request closed');
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(rows.size ? 'positions-received' : diag.subscriptionConfirmed ? 'no-positions-in-window' : 'subscription-unconfirmed'), durationMs);
    try { socket = new WebSocketImpl(native ? 'wss://ais.openwaters.io/v1/stream' : 'wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true, handshakeTimeout: Math.min(5000, durationMs) }); }
    catch (error) { return finish('connection-failed', error.message); }
    socket.on('open', () => {
      if (finished) return;
      diag.connected = true;
      const subscription = native ? { type: 'subscribe', bbox: [bounds], snapshot: true }
        : { APIKey: apiKey, BoundingBoxes: [[[bounds[0], bounds[1]], [bounds[2], bounds[3]]]], FilterMessageTypes: TYPES, ...(mmsi ? { FiltersShipMMSI: [mmsi] } : {}) };
      try { socket.send(JSON.stringify(subscription)); onStatus({ ...diag, status: 'awaiting-subscription' }); }
      catch (error) { finish('subscription-failed', error.message); }
    });
    socket.on('message', raw => {
      if (finished) return;
      diag.frames++;
      let envelope;
      try { envelope = JSON.parse(raw.toString()); } catch { diag.parseErrors++; return; }
      const upstreamError = envelope?.error ?? envelope?.Error;
      if (upstreamError || envelope?.type === 'error' || envelope?.MessageType === 'Error') return finish('subscription-rejected', typeof upstreamError === 'string' ? upstreamError : 'Provider rejected the subscription');
      if (envelope?.MessageType === 'SubscriptionConfirmation') {
        diag.subscriptionConfirmed = true;
        diag.compressionEnabled = envelope?.Message?.CompressionEnabled ?? null;
        onStatus({ ...diag, status: 'subscribed' });
        return;
      }
      // Open Waters welcome is transport information, not proof of positions/subscription.
      if (native && envelope?.type !== 'event') return;
      const type = native ? envelope.msg_type : envelope?.MessageType;
      const payload = native ? envelope.message ?? {} : envelope?.Message?.[type] ?? {};
      const meta = native ? { MMSI: envelope.mmsi, ShipName: envelope.name, Latitude: envelope.lat, Longitude: envelope.lon, time_utc: envelope.time } : envelope?.MetaData ?? {};
      const id = text(meta.MMSI ?? payload.UserID ?? payload.MMSI);
      if (!/^\d{9}$/.test(id) || (mmsi && id !== mmsi)) { diag.rejected++; return; }
      if (type === 'ShipStaticData' || type === 'StaticDataReport') {
        const details = addDetails(statics.get(id), staticDetails(payload, meta));
        statics.set(id, details);
        if (rows.has(id)) { const row = { ...rows.get(id), ...details }; rows.set(id, row); onRow(row, { position: false }); }
        return;
      }
      if (!POSITIONS.has(type)) return;
      if (payload.Valid === false) { diag.rejected++; return; }
      const details = statics.get(id) ?? {};
      const row = position({
        mmsi: id, lat: payload.Latitude ?? meta.Latitude ?? meta.latitude, lon: payload.Longitude ?? meta.Longitude ?? meta.longitude,
        ...details, name: details.name || meta.ShipName || payload.Name,
        speed: metric(payload.Sog ?? payload.SpeedOverGround, 102.3), course: metric(payload.Cog ?? payload.CourseOverGround, 360), heading: metric(payload.TrueHeading ?? payload.Heading, 360),
        navStatus: payload.NavigationalStatus ?? payload.NavigationStatus ?? '', last_position_UTC: meta.time_utc ?? meta.TimeUTC,
        source: native ? text(envelope.source) || source : source, station: text(envelope.station), retained: native && Boolean(envelope.snapshot ?? envelope.synthesized),
      }, bounds);
      if (!row) { diag.rejected++; return; }
      diag.positionFrames++;
      // Data also proves acceptance when talking to an older server without confirmation frames.
      diag.subscriptionConfirmed = true;
      const merged = mergeRows([[...(rows.has(id) ? [rows.get(id)] : []), row]], 1)[0];
      rows.set(id, merged);
      onRow(merged, { position: true });
      if (control && rows.size >= 3) finish('positions-received');
    });
    socket.on('error', error => finish('connection-failed', error?.message || 'WebSocket connection failed'));
    socket.on('close', (code, reason) => {
      diag.closeCode = code;
      if (!finished) finish('closed-early', `Provider closed the connection (${code})${reason?.length ? `: ${reason.toString()}` : ''}`);
    });
  });
  diag.count = rows.size;
  diag.ok = !diag.error && diag.subscriptionConfirmed;
  if (diag.status === 'subscription-unconfirmed') diag.error = 'Socket opened but no subscription confirmation or valid position arrived. Authentication and coverage are not proven.';
  if (diag.status === 'no-positions-in-window') diag.note = 'Subscription accepted; no positions arrived during this sample. This is not proof of zero vessels.';
  diag.ms = Date.now() - started;
  return { rows: mergeRows([[...rows.values()]]), diag };
}
