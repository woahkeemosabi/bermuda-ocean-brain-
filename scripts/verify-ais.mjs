// Read-only deployment gate. Exit 2 means requests worked but fresh Bermuda vessels are not proven.
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) throw new Error('Usage: node scripts/verify-ais.mjs https://deployment-url');
const path = process.argv.includes('--control') ? '/api/ais-live?diagnostic=1&control=1' : '/api/ais-live?diagnostic=1&maxRows=500';
const started = Date.now();
const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(29000) });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
if (data.pipelineVersion !== 'v24' || !Array.isArray(data.rows) || data.diagnostics?.length !== 3) throw new Error('Unexpected deployment/version or response contract');
for (const row of data.rows) {
  if (!/^\d{9}$/.test(row.mmsi) || !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || row.lat < 31.55 || row.lat > 33.05 || row.lon < -65.75 || row.lon > -63.75) throw new Error('Invalid or non-Bermuda position in response');
}
if (path.includes('control=1') && data.rows.length) throw new Error('Reference vessels leaked into Bermuda response');
console.log(JSON.stringify({ url: new URL(path, base).href, httpStatus: response.status, elapsedMs: Date.now() - started, ...data }, null, 2));
if (data.status === 'no-data-received' || data.status === 'age-unknown' || data.status === 'stale-data') process.exitCode = 2;
else if (data.status === 'reference-only' && data.diagnostics.some(d => !d.ok || !d.count)) process.exitCode = 2;
