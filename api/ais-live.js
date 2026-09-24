import { pruneRows } from '../lib/ais.js';
import { readAisSnapshot } from '../lib/ais-snapshot.js';

const PIPELINE_VERSION = 'v26';

function storageError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    rows: [],
    count: 0,
    pipelineVersion: PIPELINE_VERSION,
    status: 'storage-not-configured',
    unavailable: true,
    error: message || 'Vercel Blob is not connected to this project.',
    action: 'Connect a private Vercel Blob store to the bermuda-ocean-brain project, then redeploy.',
  };
}

export default async function handler(req, res) {
  const maxRows = Math.max(1, Math.min(12000, Number(req.query?.maxRows ?? 1200) || 1200));
  res.setHeader('Cache-Control', 'no-store');

  let snapshot;
  try {
    snapshot = await readAisSnapshot();
  } catch (error) {
    return res.status(503).json(storageError(error));
  }

  if (!snapshot) {
    return res.status(200).json({
      rows: [],
      count: 0,
      source: 'AISStream persistent snapshot',
      pipelineVersion: PIPELINE_VERSION,
      status: 'warming',
      collecting: false,
      needsCollection: true,
      unavailable: false,
      error: null,
      coverage: 'Bermuda',
    });
  }

  const now = Date.now();
  const rows = pruneRows(snapshot.rows ?? [], now).slice(0, maxRows);
  const collectedAtMs = Number(snapshot.collectedAtMs ?? Date.parse(snapshot.collectedAt ?? ''));
  const ageSec = Number.isFinite(collectedAtMs) ? Math.max(0, Math.round((now - collectedAtMs) / 1000)) : null;

  const body = {
    ...snapshot,
    pipelineVersion: PIPELINE_VERSION,
    rows,
    count: rows.length,
    source: 'AISStream persistent snapshot',
    ageSec,
    unavailable: false,
    error: null,
    needsCollection: !snapshot.collecting && (!Number.isFinite(Number(snapshot.lastAttemptAt)) || now - Number(snapshot.lastAttemptAt) > 60_000),
  };

  console.log('[ais-live]', JSON.stringify({
    pipelineVersion: PIPELINE_VERSION,
    status: body.status,
    rows: body.count,
    collecting: Boolean(body.collecting),
    ageSec,
    diagnostics: body.diagnostics ?? null,
  }));

  return res.status(200).json(body);
}
