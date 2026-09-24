import { sampleStream } from '../../lib/ais.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const mmsi = String(req.query?.mmsi ?? '').trim();
  if (!/^\d{9}$/.test(mmsi)) return res.status(400).json({ error: '9-digit mmsi query param required' });
  if (!process.env.AISSTREAM_API_KEY) return res.status(503).json({ mmsi, samples: [], error: 'AISSTREAM_API_KEY is not configured for this deployment.' });
  const controller = new AbortController();
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', close);
  const samples = [];
  try {
    const result = await sampleStream({ apiKey: process.env.AISSTREAM_API_KEY, mmsi, signal: controller.signal, durationMs: 15000,
      onRow(row, event) {
        if (!event.position) return;
        const sample = { lat: row.lat, lon: row.lon, t: row.last_position_UTC ? Date.parse(row.last_position_UTC) / 1000 : null, receivedAt: new Date().toISOString() };
        if (!samples.some(s => s.lat === sample.lat && s.lon === sample.lon && s.t === sample.t)) samples.push(sample);
      },
    });
    if (!controller.signal.aborted) return res.status(result.diag.error ? 502 : 200).json({ mmsi, samples, source: 'AISStream', status: samples.length ? 'data-present' : 'no-data-received', diagnostics: [result.diag], error: result.diag.error ?? (samples.length ? null : 'No positions received for this vessel during the sample.') });
  } finally { res.removeListener('close', close); }
}
