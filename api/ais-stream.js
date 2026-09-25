import WebSocket from 'ws';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
const BERMUDA = [[[31.55, -65.75], [33.05, -63.75]]];
const REFERENCE = [[[38.3, -9.7], [39.1, -8.6]]];

function text(value) {
  return String(value ?? '').trim();
}

async function fetchJson(url, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json, application/geo+json' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    let body = null;
    try { body = await response.json(); } catch {}
    const rawCount = Array.isArray(body)
      ? body.length
      : Array.isArray(body?.vessels)
        ? body.vessels.length
        : Array.isArray(body?.data)
          ? body.data.length
          : Array.isArray(body?.features)
            ? body.features.length
            : null;
    return {
      ok: response.ok,
      httpStatus: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      rawCount,
      ms: Date.now() - started,
      error: response.ok ? null : text(body?.error ?? body?.message ?? response.statusText).slice(0, 240),
    };
  } catch (error) {
    return { ok: false, httpStatus: null, finalUrl: null, contentType: null, rawCount: null, ms: Date.now() - started, error: text(error?.message || error).slice(0, 240) };
  }
}

async function fetchPage(url, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'User-Agent': 'Bermuda-Ocean-Brain-Diagnostic/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    const body = await response.text();
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].slice(0, 20).map(m => m[1]);
    const links = [...body.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].slice(0, 20).map(m => m[1]);
    return {
      ok: response.ok,
      httpStatus: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type'),
      title,
      bytes: body.length,
      scripts,
      links,
      preview: body.replace(/\s+/g, ' ').slice(0, 700),
      ms: Date.now() - started,
      error: response.ok ? null : text(response.statusText).slice(0, 240),
    };
  } catch (error) {
    return { ok: false, httpStatus: null, finalUrl: null, contentType: null, title: null, bytes: null, scripts: [], links: [], preview: null, ms: Date.now() - started, error: text(error?.message || error).slice(0, 240) };
  }
}

async function sampleAis(apiKey, boundingBoxes, durationMs = 12000) {
  const started = Date.now();
  const diag = {
    connected: false,
    subscriptionConfirmed: false,
    frames: 0,
    positionFrames: 0,
    firstPosition: null,
    closeCode: null,
    error: null,
  };

  if (!apiKey) return { ...diag, error: 'AISSTREAM_API_KEY missing', ms: 0 };

  await new Promise((resolve) => {
    const socket = new WebSocket(AIS_URL, { perMessageDeflate: true, handshakeTimeout: 5000 });
    let finished = false;
    const timer = setTimeout(finish, durationMs);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.terminate(); } catch {}
      resolve();
    }

    socket.on('open', () => {
      diag.connected = true;
      try {
        socket.send(JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: TYPES,
        }));
      } catch (error) {
        diag.error = text(error?.message || error);
        finish();
      }
    });

    socket.on('message', (raw) => {
      diag.frames += 1;
      try {
        const envelope = JSON.parse(raw.toString());
        if (envelope?.MessageType === 'SubscriptionConfirmation') {
          diag.subscriptionConfirmed = true;
          return;
        }
        if (TYPES.includes(envelope?.MessageType)) {
          diag.positionFrames += 1;
          if (!diag.firstPosition) {
            const m = envelope?.MetaData ?? {};
            diag.firstPosition = {
              mmsi: m.MMSI ?? null,
              lat: m.Latitude ?? m.latitude ?? null,
              lon: m.Longitude ?? m.longitude ?? null,
              name: text(m.ShipName).slice(0, 80) || null,
            };
          }
        }
      } catch {}
    });

    socket.on('error', (error) => {
      diag.error = text(error?.message || error).slice(0, 240);
      finish();
    });

    socket.on('close', (code, reason) => {
      diag.closeCode = Number(code);
      if (!finished) {
        const r = text(reason?.toString?.());
        if (r && !diag.error) diag.error = r.slice(0, 240);
        finish();
      }
    });
  });

  return { ...diag, ms: Date.now() - started };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const apiKey = process.env.AISSTREAM_API_KEY;

  const [aisBermuda, aisReference, fachaBermuda, openWatersBermuda, bmocAis] = await Promise.all([
    sampleAis(apiKey, BERMUDA),
    sampleAis(apiKey, REFERENCE),
    fetchJson('https://api.facha.dev/v1/ship/radius/32.3078/-64.7505/30'),
    fetchJson('https://ais.openwaters.io/v1/vessels?bbox=31.55,-65.75,33.05,-63.75'),
    fetchPage('https://ais.marops.bm'),
  ]);

  const upstreamSilent = Boolean(
    aisBermuda.connected && aisBermuda.subscriptionConfirmed && aisBermuda.positionFrames === 0 &&
    aisReference.connected && aisReference.subscriptionConfirmed && aisReference.positionFrames === 0
  );

  return res.status(200).json({
    diagnosticVersion: 'ais-proof-v2',
    checkedAt: new Date().toISOString(),
    apiKeyConfigured: Boolean(apiKey),
    aisstream: {
      bermuda: aisBermuda,
      referenceLisbon: aisReference,
      upstreamSilent,
      interpretation: upstreamSilent
        ? 'AISStream accepted both subscriptions but produced no position frames in Bermuda or the reference area.'
        : aisReference.positionFrames > 0 && aisBermuda.positionFrames === 0
          ? 'AISStream is healthy, but its current receiver coverage produced no Bermuda positions during the sample.'
          : aisReference.positionFrames > 0
            ? 'AISStream is producing positions in the reference area.'
            : 'AISStream result is inconclusive; inspect diagnostics.',
    },
    fallbacks: {
      fachaBermuda,
      openWatersBermuda,
    },
    bermudaOfficial: {
      source: 'BMOC AIS Webserver linked by Bermuda Marine & Ports',
      ...bmocAis,
    },
  });
}
