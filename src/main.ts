import './styles.css';

type AnyObj = Record<string, any>;

const MARINE = [
  ['coral-reef-type', 'Coral reef'],
  ['seagrass', 'Seagrass'],
  ['shelf', 'Bermuda shelf'],
  ['slope', 'Slope'],
  ['territorial-seas', 'Territorial sea'],
  ['subsea-cables', 'Subsea cables'],
  ['eez', 'EEZ'],
] as const;

function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

function ageLabel(seconds: unknown) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

function fmt(value: unknown, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="proof-shell">
    <header>
      <div><p class="eyebrow">BERMUDA OCEAN BRAIN</p><h1>DATA PROOF MODE</h1></div>
      <button id="refresh">REFRESH NOW</button>
    </header>
    <section class="truth-banner">
      <strong>NO MAP. NO DECORATION. NO FAKE “LIVE”.</strong>
      <span>This build only proves what the data sources can actually see around Bermuda.</span>
    </section>
    <section class="status-grid" id="status-grid"></section>
    <section class="panel">
      <div class="panel-head"><h2>SEA — ACTUAL AIS ROWS</h2><span id="sea-meta">loading…</span></div>
      <div id="sea-warning" class="warning hidden"></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>MMSI</th><th>Age</th><th>Speed</th><th>Course</th><th>Lat</th><th>Lon</th><th>Source</th></tr></thead><tbody id="sea-body"></tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>AIS SOURCE DIAGNOSTICS</h2><span>each source tested independently</span></div>
      <div id="source-diag" class="diag-grid"></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>AIR — ACTUAL ADS-B ROWS</h2><span id="air-meta">loading…</span></div>
      <div class="table-wrap"><table><thead><tr><th>Callsign</th><th>ICAO</th><th>Type</th><th>Registration</th><th>Altitude</th><th>Ground speed</th><th>Lat</th><th>Lon</th></tr></thead><tbody id="air-body"></tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>OCEAN INTELLIGENCE SOURCES</h2><span>Bermuda MSP feature counts</span></div>
      <div id="marine-grid" class="marine-grid"></div>
    </section>
    <footer><span id="last-refresh">Not refreshed yet</span><span>Auto refresh: 30s</span></footer>
  </main>
`;

const statusGrid = document.querySelector<HTMLElement>('#status-grid')!;
const seaMeta = document.querySelector<HTMLElement>('#sea-meta')!;
const seaWarning = document.querySelector<HTMLElement>('#sea-warning')!;
const seaBody = document.querySelector<HTMLElement>('#sea-body')!;
const sourceDiag = document.querySelector<HTMLElement>('#source-diag')!;
const airMeta = document.querySelector<HTMLElement>('#air-meta')!;
const airBody = document.querySelector<HTMLElement>('#air-body')!;
const marineGrid = document.querySelector<HTMLElement>('#marine-grid')!;
const lastRefresh = document.querySelector<HTMLElement>('#last-refresh')!;
const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh')!;

function card(label: string, value: string, state: 'ok'|'warn'|'bad'|'idle', detail: string) {
  return `<article class="status-card ${state}"><small>${esc(label)}</small><strong>${esc(value)}</strong><p>${esc(detail)}</p></article>`;
}

async function loadSea() {
  try {
    const r = await fetch('/api/ais-live?maxRows=500&diagnostic=1', { cache: 'no-store' });
    const data = await r.json();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    seaMeta.textContent = `${rows.length} rows · ${data?.status || 'unknown'} · ${data?.sampledAt ? new Date(data.sampledAt).toLocaleTimeString() : ''}`;
    seaWarning.classList.toggle('hidden', rows.length > 0);
    seaWarning.textContent = rows.length ? '' : (data?.error || 'No AIS positions returned.');
    seaBody.innerHTML = rows.length ? rows.map((v: AnyObj) => `<tr><td>${esc(v.name || 'Unnamed')}</td><td>${esc(v.type || '—')}</td><td>${esc(v.mmsi)}</td><td>${esc(ageLabel(v.age_s))}</td><td>${esc(fmt(v.speed))} kt</td><td>${esc(fmt(v.course,0))}°</td><td>${esc(fmt(v.lat,5))}</td><td>${esc(fmt(v.lon,5))}</td><td>${esc(v.source || '—')}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">NO AIS DATA RECEIVED — THIS DOES NOT MEAN ZERO SHIPS.</td></tr>';
    const diagnostics = Array.isArray(data?.diagnostics) ? data.diagnostics : [];
    sourceDiag.innerHTML = diagnostics.map((d: AnyObj) => `<article class="diag ${d.ok ? 'ok' : 'bad'}"><div><b>${esc(d.source)}</b><span>${d.ok ? 'CONNECTED/RESPONDED' : 'FAILED'}</span></div><strong>${d.count == null ? '—' : esc(d.count)} positions</strong><p>${esc(d.error || d.streamError || d.note || `Response ${d.ms ?? '—'} ms`)}</p>${d.source === 'AISStream' ? `<code>connected=${esc(d.connected)} frames=${esc(d.frames)} positionFrames=${esc(d.positionFrames)} sample=${esc(d.sampleMs)}ms</code>` : ''}</article>`).join('');
    return { count: rows.length, status: data?.status, source: data?.source, ok: rows.length > 0 };
  } catch (error) {
    seaMeta.textContent = 'request failed';
    seaWarning.classList.remove('hidden');
    seaWarning.textContent = String(error);
    return { count: 0, status: 'failed', source: '', ok: false };
  }
}

function stateToAircraft(s: any[]) {
  return {
    icao: s?.[0] || '', callsign: s?.[1] || '', lon: s?.[5], lat: s?.[6], altM: s?.[7] ?? s?.[13], speedMps: s?.[9], type: s?.[18] || '', reg: s?.[19] || '',
  };
}

async function loadAir() {
  try {
    const r = await fetch('/api/opensky', { cache: 'no-store' });
    const data = await r.json();
    const rows = (Array.isArray(data?.states) ? data.states : []).map(stateToAircraft);
    const source = r.headers.get('x-flight-source') || (r.ok ? 'air feed' : 'failed');
    airMeta.textContent = `${rows.length} rows · ${source}`;
    airBody.innerHTML = rows.length ? rows.slice(0,100).map((a: AnyObj) => `<tr><td>${esc(a.callsign || '—')}</td><td>${esc(a.icao)}</td><td>${esc(a.type || '—')}</td><td>${esc(a.reg || '—')}</td><td>${a.altM == null ? 'GROUND/—' : `${Math.round(Number(a.altM) * 3.28084).toLocaleString()} ft`}</td><td>${a.speedMps == null ? '—' : `${Math.round(Number(a.speedMps) * 1.94384)} kt`}</td><td>${esc(fmt(a.lat,5))}</td><td>${esc(fmt(a.lon,5))}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">NO AIRCRAFT ROWS RECEIVED.</td></tr>';
    return { count: rows.length, source, ok: r.ok };
  } catch (error) {
    airMeta.textContent = 'request failed';
    return { count: 0, source: String(error), ok: false };
  }
}

async function loadMarine() {
  const results = await Promise.all(MARINE.map(async ([key,label]) => {
    const started = performance.now();
    try {
      const r = await fetch(`/api/marine/layers/${key}`, { cache: 'no-store' });
      const data = await r.json();
      const count = Array.isArray(data?.features) ? data.features.length : 0;
      return { key, label, ok:r.ok, count, ms:Math.round(performance.now()-started), error:r.ok?'':(data?.error || `HTTP ${r.status}`) };
    } catch (error) {
      return { key, label, ok:false, count:0, ms:Math.round(performance.now()-started), error:String(error) };
    }
  }));
  marineGrid.innerHTML = results.map(r => `<article class="marine ${r.ok ? 'ok' : 'bad'}"><small>${esc(r.label)}</small><strong>${esc(r.count)}</strong><span>${r.ok ? `${r.ms} ms` : esc(r.error)}</span></article>`).join('');
  return { good: results.filter(r=>r.ok && r.count>0).length, total: results.length };
}

async function loadOcean() {
  try {
    const r = await fetch('/api/live/ocean', { cache:'no-store' });
    const data = await r.json();
    return { ok:r.ok, data };
  } catch { return { ok:false, data:null }; }
}

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'TESTING SOURCES…';
  statusGrid.innerHTML = card('SEA','TESTING','idle','Open Waters + facha.dev + AISStream') + card('AIR','TESTING','idle','Multiple ADS-B sources') + card('MARINE GIS','TESTING','idle','Bermuda MSP') + card('OCEAN','TESTING','idle','Open-Meteo Marine');
  const [sea, air, marine, ocean] = await Promise.all([loadSea(), loadAir(), loadMarine(), loadOcean()]);
  statusGrid.innerHTML = [
    card('SEA', sea.count ? `${sea.count} VESSELS` : 'NO DATA', sea.count ? 'ok':'bad', sea.count ? sea.source : 'Feed/coverage failure — not “zero ships”'),
    card('AIR', `${air.count} AIRCRAFT`, air.ok ? 'ok':'bad', air.source),
    card('MARINE GIS', `${marine.good}/${marine.total} LIVE`, marine.good === marine.total ? 'ok' : marine.good ? 'warn':'bad', 'Real Bermuda MSP feature endpoints'),
    card('OCEAN', ocean.ok ? 'LIVE' : 'FAILED', ocean.ok ? 'ok':'bad', ocean.ok ? 'Marine model endpoint responded' : 'Marine model endpoint failed'),
  ].join('');
  lastRefresh.textContent = `Last test: ${new Date().toLocaleTimeString()}`;
  refreshBtn.disabled = false;
  refreshBtn.textContent = 'REFRESH NOW';
}

refreshBtn.addEventListener('click', refresh);
refresh();
setInterval(refresh, 30_000);
