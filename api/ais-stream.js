import { fetchSnapshot, sampleStream } from '../lib/ais.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const controller = new AbortController();
  const send = (event, data) => { if (!controller.signal.aborted && !res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const stop = () => controller.abort();
  // IncomingMessage 'close' can mean the GET request completed, not that the SSE reader left.
  res.once('close', stop);
  const timer = setTimeout(stop, 54000);
  const heartbeat = setInterval(() => { if (!controller.signal.aborted) res.write(': keepalive\n\n'); }, 12000);
  try {
    send('status', { status: 'connecting', source: 'Bermuda AIS', pipelineVersion: 'v25' });
    const options = { signal: controller.signal };
    const seed = async source => {
      const result = await fetchSnapshot(source, options);
      for (const row of result.rows) send('vessel', { ...row, retained: true });
      send('status', result.diag);
    };
    const stream = async source => {
      const result = await sampleStream({ ...options, source, apiKey: process.env.AISSTREAM_API_KEY, durationMs: 50000, onRow: row => send('vessel', row), onStatus: diag => send('status', diag) });
      send('status', result.diag);
    };
    // A silent Open Waters connection must not prevent AISStream from being tried.
    await Promise.all([seed('facha.dev'), seed('Open Waters'), stream('Open Waters'), stream('AISStream')]);
    send('end', { status: 'sample-complete', reconnectAfterMs: 5000 });
  } finally {
    clearInterval(heartbeat); clearTimeout(timer); stop(); res.removeListener('close', stop);
    if (!res.writableEnded) res.end();
  }
}
