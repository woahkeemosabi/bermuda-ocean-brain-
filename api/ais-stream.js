import http from 'node:http';

const HOST = 'ais.marops.bm';
const IP = '64.147.91.118';
const PORT = 82;
const START = '/ais/auth/requestServlet?request=MapTargets';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cookiePairs(setCookie = []) {
  return setCookie.map((v) => String(v).split(';')[0]).filter(Boolean);
}

async function request(path, cookies = [], timeoutMs = 8000) {
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
        Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
        'User-Agent': 'Bermuda-Ocean-Brain-BMOC/1.0',
        ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 500000) body += chunk; });
      response.on('end', () => finish({
        ok: true,
        status: response.statusCode ?? null,
        headers: {
          server: response.headers.server ?? null,
          location: response.headers.location ?? null,
          contentType: response.headers['content-type'] ?? null,
          cacheControl: response.headers['cache-control'] ?? null,
          setCookie: cookiePairs(response.headers['set-cookie'] ?? []),
          wwwAuthenticate: response.headers['www-authenticate'] ?? null,
        },
        body,
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (error) => finish({ ok: false, status: null, headers: {}, body: '', error: error?.code || clean(error?.message) }));
    req.end();
  });
}

function absolutePath(current, location) {
  if (!location) return null;
  try {
    const base = new URL(`http://${HOST}:${PORT}${current}`);
    const next = new URL(location, base);
    if (next.hostname !== HOST || Number(next.port || 80) !== PORT) return next.toString();
    return next.pathname + next.search;
  } catch { return location; }
}

function summarize(body) {
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const forms = [...body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0, 10).map((m) => {
    const attrs = m[1];
    const inner = m[2];
    const action = attrs.match(/action=["']([^"']*)["']/i)?.[1] ?? null;
    const method = attrs.match(/method=["']([^"']*)["']/i)?.[1] ?? 'get';
    const inputs = [...inner.matchAll(/<input\b([^>]*)>/gi)].slice(0, 30).map((im) => {
      const a = im[1];
      return {
        type: a.match(/type=["']([^"']*)["']/i)?.[1] ?? 'text',
        name: a.match(/name=["']([^"']*)["']/i)?.[1] ?? null,
        value: a.match(/value=["']([^"']*)["']/i)?.[1] ?? null,
      };
    });
    return { action, method, inputs };
  });
  const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const links = [...body.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 50);
  const visible = clean(body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).slice(0, 5000);
  return { title: title ? clean(title) : null, forms, scripts, links, visible };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const hops = [];
  let path = START;
  let cookies = [];

  for (let i = 0; i < 8; i++) {
    if (/^https?:\/\//i.test(path)) {
      hops.push({ step: i + 1, external: path, note: 'Redirect left the BMOC host; not followed by this diagnostic.' });
      break;
    }
    const response = await request(path, cookies);
    const newCookies = response.headers?.setCookie ?? [];
    if (newCookies.length) {
      const map = new Map(cookies.map((c) => [c.split('=')[0], c]));
      for (const c of newCookies) map.set(c.split('=')[0], c);
      cookies = [...map.values()];
    }
    hops.push({
      step: i + 1,
      path,
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      summary: summarize(response.body || ''),
      bytes: response.body?.length ?? 0,
      error: response.error ?? null,
    });
    if (!response.ok) break;
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = absolutePath(path, response.headers.location);
    if (!next || next === path) break;
    path = next;
  }

  return res.status(200).json({
    diagnosticVersion: 'bmoc-auth-flow-v1',
    checkedAt: new Date().toISOString(),
    endpoint: `http://${HOST}:${PORT}${START}`,
    directTarget: `${IP}:${PORT}`,
    cookieNames: cookies.map((c) => c.split('=')[0]),
    hops,
    interpretation: hops.some((h) => h.summary?.forms?.some((f) => f.inputs?.some((i) => /password/i.test(i.type))))
      ? 'BMOC Vessel Server requires an authenticated user session before MapTargets is exposed.'
      : hops.some((h) => h.external)
        ? 'BMOC delegates authentication to an external service; inspect the redirect target for the supported access path.'
        : 'The public login flow did not expose a password form in the inspected responses; inspect the final response and links for guest/map access.',
  });
}
