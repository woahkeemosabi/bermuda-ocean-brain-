import { collectAis, pruneRows } from '../lib/ais.js';
import { collectBmoc } from '../lib/bmoc.js';
import { readAisSnapshot, writeAisSnapshot } from '../lib/ais-snapshot.js';

const PIPELINE_VERSION = 'v27-bmoc';
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

function mergeByMmsi(previousRows = [], nextRows = []) {
  const map = new Map();
  for (const row of previousRows) {
    const key = String(row?.mmsi ?? '').trim();
    if (key) map.set(key, { ...row });
  }
  for (const row of nextRows) {
    const key = String(row?.mmsi ?? '').trim();
    if (key) map.set(key, { ...(map.get(key) ?? {}), ...row });
  }
  return [...map.values()];
}

export default async function handler(req, res) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const bmocUsername = process.env.BMOC_USERNAME;
  const bmocPassword = process.env.BMOC_PASSWORD;

  if (!apiKey && !(bmocUsername && bmocPassword)) {
    return json(res, 503, {
      pipelineVersion: PIPELINE_VERSION,
      rows: [],
      status: 'missing-provider-credentials',
      error: 'Neither BMOC credentials nor AISSTREAM_API_KEY are configured on Vercel.',
      action: 'Set BMOC_USERNAME and BMOC_PASSWORD for the official Bermuda feed, or configure AISSTREAM_API_KEY as fallback.',
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
      source: previous?.source ?? null,
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

  // Primary provider: Bermuda Maritime Operations Centre (official local AIS/VTS source).
  const bmoc = await collectBmoc({ username: bmocUsername, password: bmocPassword });

  let source = 'BMOC';
  let providerRows = bmoc.rows;
  let fallbackDiagnostics = null;

  // Fallback: AISStream. This remains useful when BMOC credentials are not yet configured
  // or if the official service is temporarily unavailable.
  if (!providerRows.length && apiKey) {
    const fallback = await collectAis(apiKey, { sampleMs: SAMPLE_MS, seedRows: previousRows });
    providerRows = fallback.rows;
    fallbackDiagnostics = fallback.diagnostics;
    source = providerRows.length ? 'AISStream fallback' : 'BMOC + AISStream fallback';
  }

  const collectedAtMs = Date.now();
  const mergedRows = source === 'BMOC'
    ? mergeByMmsi(previousRows, providerRows)
    : providerRows;
  const freshRows = pruneRows(mergedRows, collectedAtMs);

  let status = 'no-data-received';
  if (freshRows.length) status = 'live-snapshot';
  else if (bmoc.diagnostics.status === 'auth-rejected') status = 'bmoc-auth-rejected';
  else if (bmoc.diagnostics.status === 'authenticated-unparsed') status = 'bmoc-parser-needed';
  else if (fallbackDiagnostics?.subscriptionConfirmed) status = 'no-positions-in-window';
  else if (fallbackDiagnostics?.error) status = 'stream-error';
  else if (!bmoc.diagnostics.configured) status = 'bmoc-not-configured';

  const snapshot = {
    pipelineVersion: PIPELINE_VERSION,
    source,
    scope: 'bermuda',
    coverage: 'Bermuda territorial and approach waters',
    status,
    rows: freshRows,
    count: freshRows.length,
    collecting: false,
    lastAttemptAt: attemptStartedAt,
    collectedAt: new Date(collectedAtMs).toISOString(),
    collectedAtMs,
    diagnostics: {
      primary: bmoc.diagnostics,
      fallback: fallbackDiagnostics,
      retainedContacts: freshRows.length,
      note: source === 'BMOC' && freshRows.length
        ? 'Official BMOC vessel positions are feeding the persistent Bermuda snapshot.'
        : bmoc.diagnostics.status === 'not-configured'
          ? 'BMOC is wired as the primary provider but requires BMOC_USERNAME and BMOC_PASSWORD. AISStream remains the fallback.'
          : bmoc.diagnostics.status === 'authenticated-unparsed'
            ? 'BMOC authentication succeeded. Adjust the response parser using the safe diagnostics; credentials and raw protected data are not logged.'
            : 'BMOC did not yield positions, so AISStream was sampled as fallback.',
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
    source,
    status,
    rows: freshRows.length,
    bmocStatus: bmoc.diagnostics.status,
    fallbackStatus: fallbackDiagnostics?.subscriptionConfirmed ? 'subscribed' : fallbackDiagnostics?.error ? 'error' : fallbackDiagnostics ? 'no-data' : 'not-used',
  }));

  return json(res, 200, snapshot);
}
