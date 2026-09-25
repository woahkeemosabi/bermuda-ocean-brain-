import http from 'node:http';

const HOST = 'ais.marops.bm';
const IP = '64.147.83.207';
const PORT = 82;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function request(path = '/', timeoutMs = 7000) {
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
      response.on('data', (chunk) => { if (body.length < 250000) body += chunk; });
      response.on('end', () => finish({
        ok: true,
        status: response.statusCode ?? null,
        headers: {
          server: response.headers.server ?? null,
          location: response.headers.location ?? null,
          contentType: response.headers['content-type'] ?? null,
          contentLength: response.headers['content-length'] ?? null,
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
  if (!src || /^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;
  const prefix = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
  return prefix + src.replace(/^\.\//, '');
}

function extractUrls(text) {
  const found = new Set();
  const patterns = [
    /(?:https?:|wss?:)\/\/[^\s"'<>]+/gi,
    /["']([^"']*(?:\.ashx|\.asmx|\.aspx|\.php|\.json|\.xml|\.cgi|\/api\/|\/ajax\/|\/data\/|\/ais\/)[^"']*)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(clean(match[1] ?? match[0]));
  }
  return [...found].filter(Boolean).slice(0, 120);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const page = await request('/ais/');
  if (!page.ok) {
    return res.status(502).json({
      diagnosticVersion: 'bmoc-port82-v1',
      checkedAt: new Date().toISOString(),
      endpoint: `http://${HOST}:${PORT}/ais/`,
      ip: IP,
      page,
    });
  }

  const html = page.body;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const iframes = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const forms = [...html.matchAll(/<form[^>]+action=["']([^"']*)["']/gi)].map((m) => m[1]);
  const inlineScripts = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter(Boolean);

  const scriptBodies = [];
  for (const src of scripts.slice(0, 15)) {
    const path = resolvePath('/ais/', src);
    if (!path || /^(https?:)?\/\//i.test(path)) {
      scriptBodies.push({ src, skipped: 'external' });
      continue;
    }
    const result = await request(path);
    scriptBodies.push({
      src,
      path,
      ok: result.ok,
      status: result.status,
      contentType: result.headers?.contentType ?? null,
      bytes: result.body?.length ?? 0,
      discoveredUrls: extractUrls(result.body || ''),
      preview: clean(result.body || '').slice(0, 5000),
      error: result.error ?? null,
    });
  }

  const allCode = [html, ...inlineScripts, ...scriptBodies.map((s) => s.preview || '')].join('\n');

  return res.status(200).json({
    diagnosticVersion: 'bmoc-port82-v1',
    checkedAt: new Date().toISOString(),
    endpoint: `http://${HOST}:${PORT}/ais/`,
    directTarget: `${IP}:${PORT}`,
    page: {
      status: page.status,
      contentType: page.headers.contentType,
      server: page.headers.server,
      title: title ? clean(title) : null,
      bytes: html.length,
      scripts,
      links: links.slice(0, 100),
      iframes,
      forms,
      discoveredUrls: extractUrls(allCode),
      preview: clean(html).slice(0, 6000),
    },
    scriptBodies,
  });
}
