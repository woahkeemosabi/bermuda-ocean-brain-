import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const BMOC_HOST = 'ais.marops.bm';
const HISTORICAL_MAROPS_IP = '64.147.83.207';
const DNS_SERVERS = [
  { name: 'Transact Bermuda resolver', ip: '209.240.42.216' },
  { name: 'One Communications ns1', ip: '199.172.235.242' },
  { name: 'One Communications ns2', ip: '199.172.235.243' },
];
const WEB_PORTS = [80, 443, 8080, 8000, 8081, 8443, 8088, 8888];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function resolveWith(server) {
  const resolver = new dns.promises.Resolver();
  resolver.setServers([server.ip]);
  const out = { ...server, a: [], aaaa: [], cname: [], error: null };
  try { out.a = await resolver.resolve4(BMOC_HOST); } catch (error) { out.aError = error?.code || clean(error?.message); }
  try { out.aaaa = await resolver.resolve6(BMOC_HOST); } catch (error) { out.aaaaError = error?.code || clean(error?.message); }
  try { out.cname = await resolver.resolveCname(BMOC_HOST); } catch (error) { out.cnameError = error?.code || clean(error?.message); }
  if (!out.a.length && !out.aaaa.length && !out.cname.length) out.error = out.aError || out.aaaaError || out.cnameError || 'no-record';
  return out;
}

async function tcpProbe(host, port, timeoutMs = 2200) {
  const started = Date.now();
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open, error = null) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ port, open, ms: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error?.code || clean(error?.message)));
    socket.connect(port, host, () => finish(true));
  });
}

async function requestViaIp(ip, port, tls = false, timeoutMs = 5000) {
  const started = Date.now();
  return await new Promise((resolve) => {
    const client = tls ? https : http;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ip, port, tls, ms: Date.now() - started, ...result });
    };
    const req = client.request({
      host: ip,
      port,
      path: '/',
      method: 'GET',
      servername: BMOC_HOST,
      rejectUnauthorized: false,
      headers: {
        Host: BMOC_HOST,
        Accept: 'text/html,application/json,*/*;q=0.8',
        'User-Agent': 'Bermuda-Ocean-Brain-BMOC-Probe/1.0',
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 12000) body += chunk; });
      response.on('end', () => {
        const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].slice(0, 20).map((m) => m[1]);
        const links = [...body.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].slice(0, 30).map((m) => m[1]);
        finish({
          ok: true,
          status: response.statusCode ?? null,
          server: response.headers.server ?? null,
          location: response.headers.location ?? null,
          contentType: response.headers['content-type'] ?? null,
          title: title ? clean(title) : null,
          scripts,
          links,
          preview: clean(body).slice(0, 1000),
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (error) => finish({ ok: false, error: error?.code || clean(error?.message) }));
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const dnsResults = await Promise.all(DNS_SERVERS.map(resolveWith));
  const discoveredIps = [...new Set(dnsResults.flatMap((r) => r.a))];
  const candidateIps = [...new Set([...discoveredIps, HISTORICAL_MAROPS_IP])];

  const ports = await Promise.all(WEB_PORTS.map((port) => tcpProbe(HISTORICAL_MAROPS_IP, port)));
  const openPorts = ports.filter((p) => p.open).map((p) => p.port);

  const direct = [];
  for (const ip of candidateIps.slice(0, 4)) {
    if (openPorts.includes(80) || ip !== HISTORICAL_MAROPS_IP) direct.push(await requestViaIp(ip, 80, false));
    if (openPorts.includes(443) || ip !== HISTORICAL_MAROPS_IP) direct.push(await requestViaIp(ip, 443, true));
    for (const port of openPorts.filter((p) => ![80, 443].includes(p))) {
      direct.push(await requestViaIp(ip, port, port === 8443));
    }
  }

  return res.status(200).json({
    diagnosticVersion: 'bmoc-discovery-v1',
    checkedAt: new Date().toISOString(),
    target: BMOC_HOST,
    officialContext: 'Bermuda Marine & Ports currently publishes BMOC AIS Webserver as ais.marops.bm.',
    dns: dnsResults,
    discoveredIps,
    historicalHost: {
      ip: HISTORICAL_MAROPS_IP,
      note: 'Recent passive web data associated marops.bm/rccbermuda.bm with this Bermuda Transact address.',
      ports,
    },
    directVirtualHostProbes: direct,
    nextStep: direct.some((r) => r.ok && r.status && r.status < 500)
      ? 'A BMOC/Marops HTTP service responded. Inspect title/scripts/links and adapt the AIS provider to its data transport.'
      : discoveredIps.length
        ? 'Bermuda DNS produced an address but no web response yet; inspect the discovered address and protocol.'
        : 'No AIS host record was returned by the tested Bermuda resolvers. The published BMOC AIS hostname appears retired or restricted; obtain the replacement BMOC feed/host from Marine & Ports.',
  });
}
