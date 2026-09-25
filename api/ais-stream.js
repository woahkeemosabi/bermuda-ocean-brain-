import http from 'node:http';

const HOST = 'ais.marops.bm';
const IP = '64.147.91.118';
const PORT = 82;
const ROOT = '/ais/';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function request(path = ROOT, timeoutMs = 8000) {
  const started = Date.now();
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (body) => {
      if (settled) return;
      settled = true;
      resolve({ ms: Date.now() - started, ...body });
    };
    const req = http.request({
      host: IP,
      port: PORT,
      path,
      method: 'GET',
      headers: {
        Host: HOST,
        Accept: '*/*',
        'User-Agent': 'Bermuda-Ocean-Brain-BMOC/1.0',
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 400000) body += chunk; });
      response.on('end', () => finish({
        ok: true,
        status: response.statusCode ?? null,
        headers: {
          server: response.headers.server ?? null,
          location: response.headers.location ?? null,
          contentType: response.headers['content-type'] ?? null,
          contentLength: response.headers['content-length'] ?? null,
          cacheControl: response.headers['cache-control'] ?? null,
        },
        body,
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (error) => finish({ ok: false, status: null, headers: {}, body: '', error: error?.code || clean(error?.message) }));
    req.end();
  });
}

function resolvePath(base, src) {
  if (!src) return null;
  if (/^(?:https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;
  const prefix = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
  return prefix + src.replace(/^\.\//, '');
}

function extractCandidates(text) {
  const found = new Set();
  const patterns = [
    /(?:https?:|wss?:)\/\/[^\s"'<>`]+/gi,
    /["'`]([^"'`]*(?:\.ashx|\.asmx|\.aspx|\.php|\.json|\.xml|\.cgi|\.svc|\.do|\.jsp|\.txt|\.csv|\/api\/|\/ajax\/|\/data\/|\/ais\/)[^"'`]*)["'`]/gi,
    /(?:url|endpoint|source|dataUrl|feed|ajax|href|src)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = clean(match[1] ?? match[0]);
      if (value && value.length < 500) found.add(value);
    }
  }
  return [...found].slice(0, 250);
}

function summarizeBody(body) {
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const styles = [...body.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const links = [...body.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const iframes = [...body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const forms = [...body.matchAll(/<form[^>]+action=["']([^"']*)["']/gi)].map((m) => m[1]);
  return { title: title ? clean(title) : null, scripts, styles, links, iframes, forms, candidates: extractCandidates(body) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const page = await request(ROOT);
  if (!page.ok) {
    return res.status(502).json({ diagnosticVersion: 'bmoc-live-inspect-v1', checkedAt: new Date().toISOString(), host: HOST, ip: IP, port: PORT, page });
  }

  const summary = summarizeBody(page.body);
  const assets = [];
  const queue = [...new Set([...summary.scripts, ...summary.iframes])].slice(0, 25);

  for (const src of queue) {
    const path = resolvePath(ROOT, src);
    if (!path || /^(?:https?:)?\/\//i.test(path)) {
      assets.push({ src, path, skipped: 'external' });
      continue;
    }
    const result = await request(path);
    assets.push({
      src,
      path,
      ok: result.ok,
      status: result.status,
      contentType: result.headers?.contentType ?? null,
      bytes: result.body?.length ?? 0,
      candidates: extractCandidates(result.body || ''),
      preview: clean(result.body || '').slice(0, 12000),
      error: result.error ?? null,
    });
  }

  const combined = [page.body, ...assets.map((a) => a.preview || '')].join('\n');

  return res.status(200).json({
    diagnosticVersion: 'bmoc-live-inspect-v1',
    checkedAt: new Date().toISOString(),
    endpoint: `http://${HOST}:${PORT}${ROOT}`,
    directTarget: `${IP}:${PORT}`,
    page: {
      ok: page.ok,
      status: page.status,
      headers: page.headers,
      bytes: page.body.length,
      ...summary,
      preview: clean(page.body).slice(0, 12000),
    },
    assets,
    allCandidates: extractCandidates(combined),
  });
}
