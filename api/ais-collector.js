import { collectAis, pruneRows } from '../lib/ais.js';
import { readAisSnapshot, writeAisSnapshot } from '../lib/ais-snapshot.js';

const PIPELINE_VERSION = 'v26';
const SAMPLE_MS = 48_000;
const MIN_ATTEMPT_GAP_MS = 42_000;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function storageError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 'storage-not-configured',
    error: message || 'Vercel Blob is not connected to this project.',
    action: 'Connect a private Vercel Blob store to the bermuda-ocean-brain project, then redeploy.',
  };
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    return json(res, 503, {
      pipelineVersion: PIPELINE_VERSION,
      rows: [],
      status: 'missing-key',
      error: 'AISSTREAM_API_KEY is not configured on Vercel.',
    });
  }

  let previous = null;
  try {
    previous = await readAisSnapshot();
  } catch (error) {
    return json(res, 503, { pipelineVersion: PIPELINE_VERSION, rows: [], ...storageError(error) });
  }

  const now = Date.now();
  const previousRows = pruneRows(previous?.rows ?? [], now);
  const lastAttemptAt = Number(previous?.lastAttemptAt ?? 0);
  const force = String(req.query?.force ?? '') === '1';

  if (!force && lastAttemptAt && now - lastAttemptAt < MIN_ATTEMPT_GAP_MS) {
    return json(res, 200, {
      pipelineVersion: PIPELINE_VERSION,
      status: previous?.collecting ? 'collector-already-running' : 'recent-attempt',
      rows: previousRows,
      count: previousRows.length,
      lastAttemptAt,
      collectedAt: previous?.collectedAt ?? null,
    });
  }

  const attemptStartedAt = Date.now();
  try {
    await writeAisSnapshot({
      ...(previous ?? {}),
      pipelineVersion: PIPELINE_VERSION,
      rows: previousRows,
      count: previousRows.length,
      collecting: true,
      lastAttemptAt: attemptStartedAt,
      collectorStartedAt: new Date(attemptStartedAt).toISOString(),
    });
  } catch (error) {
    return json(res, 503, { pipelineVersion: PIPELINE_VERSION, rows: previousRows, ...storageError(error) });
  }

  const { rows, diagnostics } = await collectAis(apiKey, { sampleMs: SAMPLE_MS, seedRows: previousRows });
  const collectedAtMs = Date.now();
  const freshRows = pruneRows(rows, collectedAtMs);
  const status = freshRows.length
    ? 'live-snapshot'
    : diagnostics.subscriptionConfirmed
      ? 'no-positions-in-window'
      : diagnostics.error
        ? 'stream-error'
        : 'no-data-received';

  const snapshot = {
    pipelineVersion: PIPELINE_VERSION,
    source: 'AISStream',
    scope: 'bermuda',
    coverage: '31.55,-65.75,33.05,-63.75',
    status,
    rows: freshRows,
    count: freshRows.length,
    collecting: false,
    lastAttemptAt: attemptStartedAt,
    collectedAt: new Date(collectedAtMs).toISOString(),
    collectedAtMs,
    diagnostics: {
      ...diagnostics,
      retainedContacts: freshRows.length,
      sampleMs: SAMPLE_MS,
      note: diagnostics.positionFrames > 0
        ? 'Real AIS positions were received and retained in the persistent Bermuda snapshot.'
        : 'Subscription was sampled for 48 seconds. Existing real contacts remain until their 30-minute TTL expires.',
    },
  };

  try {
    await writeAisSnapshot(snapshot);
  } catch (error) {
    return json(res, 503, {
      pipelineVersion: PIPELINE_VERSION,
      rows: freshRows,
      count: freshRows.length,
      ...storageError(error),
      diagnostics: snapshot.diagnostics,
    });
  }

  console.log('[ais-collector]', JSON.stringify({
    pipelineVersion: PIPELINE_VERSION,
    status,
    rows: freshRows.length,
    diagnostics: snapshot.diagnostics,
  }));

  return json(res, 200, snapshot);
}
