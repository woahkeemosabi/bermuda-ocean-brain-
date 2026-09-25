import dns from 'node:dns';

const ZONE = 'marops.bm';
const TARGET = 'ais.marops.bm';

function cleanError(error) {
  return { code: error?.code ?? null, message: String(error?.message ?? error ?? '').slice(0, 300) };
}

async function safe(label, fn) {
  try { return { label, ok: true, value: await fn() }; }
  catch (error) { return { label, ok: false, error: cleanError(error) }; }
}

async function resolveHostAddresses(host) {
  const out = [];
  try { out.push(...await dns.promises.resolve4(host)); } catch {}
  try { out.push(...await dns.promises.resolve6(host)); } catch {}
  return [...new Set(out)];
}

async function queryAuthority(nsHost) {
  const addresses = await resolveHostAddresses(nsHost);
  const queries = [];
  for (const address of addresses) {
    const resolver = new dns.promises.Resolver();
    resolver.setServers([address]);
    const [a, aaaa, cname, any, soa] = await Promise.all([
      safe('A', () => resolver.resolve4(TARGET)),
      safe('AAAA', () => resolver.resolve6(TARGET)),
      safe('CNAME', () => resolver.resolveCname(TARGET)),
      safe('ANY', () => resolver.resolveAny(TARGET)),
      safe('SOA', () => resolver.resolveSoa(ZONE)),
    ]);
    queries.push({ nameserver: nsHost, address, records: { a, aaaa, cname, any, soa } });
  }
  return { nameserver: nsHost, addresses, queries };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const system = {
    zoneNs: await safe('NS marops.bm', () => dns.promises.resolveNs(ZONE)),
    zoneSoa: await safe('SOA marops.bm', () => dns.promises.resolveSoa(ZONE)),
    zoneA: await safe('A marops.bm', () => dns.promises.resolve4(ZONE)),
    targetA: await safe('A ais.marops.bm', () => dns.promises.resolve4(TARGET)),
    targetCname: await safe('CNAME ais.marops.bm', () => dns.promises.resolveCname(TARGET)),
    targetAny: await safe('ANY ais.marops.bm', () => dns.promises.resolveAny(TARGET)),
  };

  const nsHosts = system.zoneNs.ok && Array.isArray(system.zoneNs.value) ? system.zoneNs.value : [];
  const authoritative = [];
  for (const ns of nsHosts) authoritative.push(await queryAuthority(ns));

  const recovered = [];
  for (const server of authoritative) {
    for (const q of server.queries) {
      const a = q.records.a;
      if (a.ok && Array.isArray(a.value)) recovered.push(...a.value);
      const cname = q.records.cname;
      if (cname.ok && Array.isArray(cname.value)) recovered.push(...cname.value.map((v) => `CNAME:${v}`));
    }
  }

  return res.status(200).json({
    diagnosticVersion: 'bmoc-authoritative-dns-v1',
    checkedAt: new Date().toISOString(),
    zone: ZONE,
    target: TARGET,
    publishedEndpoint: 'http://ais.marops.bm:82/ais/',
    system,
    authoritative,
    recovered: [...new Set(recovered)],
    interpretation: recovered.length
      ? 'The marops.bm authoritative DNS still exposes a BMOC AIS target. Use the recovered host/IP to test port 82 directly.'
      : nsHosts.length
        ? 'The authoritative marops.bm zone was reached but no current AIS A/CNAME record was recovered. The published BMOC link is likely stale, restricted, or was removed from public DNS.'
        : 'Could not discover the marops.bm authoritative nameservers from this runtime.',
  });
}
