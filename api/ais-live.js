import { fetchSnapshot, sampleStream, mergeRows, freshness } from '../lib/ais.js';

export default async function handler(req, res) {
  const control = String(req.query?.control ?? '') === '1';
  const diagnostic = String(req.query?.diagnostic ?? '') === '1';
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows) || 1200));
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', onClose);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-AIS-Pipeline', 'v24');
  try {
    const options = { control, signal: controller.signal };
    const streamOptions = { ...options, apiKey: process.env.AISSTREAM_API_KEY, durationMs: diagnostic || control ? 12000 : 7000 };
    const results = await Promise.all([
      fetchSnapshot('Open Waters', options), fetchSnapshot('facha.dev', options),
      ...(diagnostic || control ? [sampleStream(streamOptions)] : []),
    ]);
    if (!diagnostic && !control && !mergeRows(results.map(r => r.rows)).length) results.push(await sampleStream(streamOptions));
    const diagnostics = results.map(r => r.diag);
    // Reference areas are for proving providers and adapters only. Never return them as Bermuda contacts.
    const rows = control ? [] : mergeRows(results.map(r => r.rows), maxRows);
    const counts = freshness(rows);
    const status = control ? 'reference-only' : !rows.length ? 'no-data-received' : counts.fresh ? 'data-present' : counts.stale ? 'stale-data' : 'age-unknown';
    const error = control ? null : !rows.length ? 'No Bermuda AIS positions received. Snapshot coverage and the live sample do not establish that there are zero vessels.' : counts.fresh ? null : 'Only stale or undated positions received; current vessel activity is not proven.';
    const response = { rows, status, error, source: rows.length ? [...new Set(rows.map(r => r.source))].join(' + ') : control ? 'Reference checks only; no Bermuda rows' : 'No vessel source returned positions', coverage: control ? 'Reference checks: Oslo / Lisbon / global AISStream (not Bermuda)' : 'Bermuda region; facha.dev covers a 30 km radius', sampledAt: new Date().toISOString(), freshness: counts, diagnostics, pipelineVersion: 'v24', revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null };
    console.info('[ais-live]', JSON.stringify({ revision: response.revision, scope: control ? 'reference-only' : 'bermuda', status, rows: rows.length, diagnostics }));
    if (!controller.signal.aborted) return res.status(200).json(response);
  } finally { res.removeListener('close', onClose); }
}
