import http from 'node:http';

const BMOC_HOST = 'ais.marops.bm';
const BMOC_IP = '64.147.91.118';
const BMOC_PORT = 82;
const BMOC_PATH = '/ais/auth/requestServlet?request=MapTargets';

const LAT_KEYS = ['lat', 'latitude', 'y'];
const LON_KEYS = ['lon', 'lng', 'longitude', 'x'];
const MMSI_KEYS = ['mmsi', 'MMSI', 'userid', 'userId', 'UserID'];

function text(value) {
  return String(value ?? '').replace(/\0/g, '').trim();
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function first(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function normalizeCandidate(obj, now = Date.now()) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const lat = finite(first(obj, LAT_KEYS));
  const lon = finite(first(obj, LON_KEYS));
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const rawMmsi = first(obj, MMSI_KEYS) ?? obj.id ?? obj.vesselId ?? obj.targetId;
  const mmsi = text(rawMmsi);
  if (!mmsi) return null;

  const observed = text(obj.time_utc ?? obj.timestamp ?? obj.time ?? obj.lastSeen ?? obj.last_position_UTC);
  const parsedObserved = observed ? Date.parse(observed) : NaN;

  return {
    mmsi,
    lat,
    lon,
    name: text(obj.name ?? obj.shipName ?? obj.ShipName ?? obj.vesselName) || `MMSI ${mmsi}`,
    imo: text(obj.imo ?? obj.IMO ?? obj.imoNumber),
    type: obj.type ?? obj.shipType ?? obj.vesselType ?? '',
    destination: text(obj.destination ?? obj.dest),
    callSign: text(obj.callSign ?? obj.callsign),
    length: finite(obj.length ?? obj.shipLength),
    speed: finite(obj.speed ?? obj.sog ?? obj.speedOverGround),
    course: finite(obj.course ?? obj.cog ?? obj.courseOverGround),
    heading: finite(obj.heading ?? obj.trueHeading),
    last_position_UTC: Number.isFinite(parsedObserved) ? new Date(parsedObserved).toISOString() : new Date(now).toISOString(),
    lastSeenAt: now,
    source: 'BMOC',
  };
}

function walkJson(value, rows, now) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, rows, now);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const row = normalizeCandidate(value, now);
  if (row) rows.set(row.mmsi, { ...(rows.get(row.mmsi) ?? {}), ...row });
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') walkJson(child, rows, now);
  }
}

function parseDelimited(body, rows, now) {
  const lines = String(body ?? '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return;
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : null;
  if (!delimiter) return;
  const headers = lines[0].split(delimiter).map((v) => text(v).toLowerCase());
  const latIndex = headers.findIndex((h) => ['lat', 'latitude'].includes(h));
  const lonIndex = headers.findIndex((h) => ['lon', 'lng', 'longitude'].includes(h));
  const mmsiIndex = headers.findIndex((h) => h === 'mmsi');
  if (latIndex < 0 || lonIndex < 0 || mmsiIndex < 0) return;
  for (const line of lines.slice(1, 5000)) {
    const values = line.split(delimiter);
    const obj = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    const row = normalizeCandidate(obj, now);
    if (row) rows.set(row.mmsi, { ...(rows.get(row.mmsi) ?? {}), ...row });
  }
}

function inspectHtml(body) {
  const title = String(body ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const scripts = [...String(body ?? '').matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].slice(0, 30).map((m) => m[1]);
  const links = [...String(body ?? '').matchAll(/(?:href|src|url)\s*=\s*["']([^"']+)["']/gi)].slice(0, 50).map((m) => m[1]);
  return { title, scripts, links };
}

function parsePayload(body, contentType, now = Date.now()) {
  const rows = new Map();
  const type = String(contentType ?? '').toLowerCase();
  const trimmed = String(body ?? '').trim();
  let jsonParsed = false;

  if (type.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value = JSON.parse(trimmed);
      walkJson(value, rows, now);
      jsonParsed = true;
    } catch {}
  }

  if (!rows.size) parseDelimited(trimmed, rows, now);

  return {
    rows: [...rows.values()],
    diagnostics: {
      parser: rows.size ? (jsonParsed ? 'json' : 'delimited') : 'unrecognized',
      contentType: contentType ?? null,
      bytes: Buffer.byteLength(String(body ?? '')),
      html: type.includes('html') || /<html\b/i.test(trimmed) ? inspectHtml(trimmed) : null,
    },
  };
}

async function requestMapTargets(username, password, timeoutMs = 10_000) {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  return await new Promise((resolve) => {
    let settled = false;
    const started = Date.now();
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({ ms: Date.now() - started, ...value });
    };

    const req = http.request({
      host: BMOC_IP,
      port: BMOC_PORT,
      path: BMOC_PATH,
      method: 'GET',
      headers: {
        Host: BMOC_HOST,
        Authorization: authorization,
        Accept: 'application/json,text/plain,text/csv,application/xml,text/xml,text/html,*/*;q=0.8',
        'User-Agent': 'Bermuda-Ocean-Brain/1.0',
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 2_000_000) body += chunk; });
      response.on('end', () => finish({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode ?? null,
        contentType: response.headers['content-type'] ?? null,
        location: response.headers.location ?? null,
        body,
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('BMOC request timed out')));
    req.on('error', (error) => finish({ ok: false, status: null, contentType: null, location: null, body: '', error: text(error?.message || error) }));
    req.end();
  });
}

export async function collectBmoc({ username, password } = {}) {
  const configured = Boolean(username && password);
  const baseDiagnostics = {
    source: 'BMOC',
    host: BMOC_HOST,
    port: BMOC_PORT,
    path: BMOC_PATH,
    configured,
    authenticated: false,
    status: configured ? 'connecting' : 'not-configured',
  };

  if (!configured) {
    return {
      rows: [],
      diagnostics: {
        ...baseDiagnostics,
        note: 'Set BMOC_USERNAME and BMOC_PASSWORD in Vercel to enable the official Bermuda Vessel Server feed.',
      },
    };
  }

  const response = await requestMapTargets(username, password);
  if (response.status === 401 || response.status === 403) {
    return {
      rows: [],
      diagnostics: {
        ...baseDiagnostics,
        status: 'auth-rejected',
        httpStatus: response.status,
        ms: response.ms,
        error: 'BMOC rejected the configured credentials.',
      },
    };
  }

  if (!response.ok) {
    return {
      rows: [],
      diagnostics: {
        ...baseDiagnostics,
        status: 'request-failed',
        httpStatus: response.status,
        ms: response.ms,
        error: response.error || `BMOC returned HTTP ${response.status ?? 'error'}`,
      },
    };
  }

  const parsed = parsePayload(response.body, response.contentType);
  return {
    rows: parsed.rows,
    diagnostics: {
      ...baseDiagnostics,
      authenticated: true,
      status: parsed.rows.length ? 'positions-received' : 'authenticated-unparsed',
      httpStatus: response.status,
      ms: response.ms,
      count: parsed.rows.length,
      ...parsed.diagnostics,
      note: parsed.rows.length
        ? 'Official BMOC vessel targets were parsed successfully.'
        : 'BMOC authentication succeeded, but the MapTargets response format still needs a parser adjustment. No credentials or response body are exposed.',
    },
  };
}
