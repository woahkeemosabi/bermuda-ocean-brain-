type AnyObj = Record<string, any>;

export function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c));
}

export function ageLabel(seconds: unknown) {
  if (seconds == null || seconds === '') return '—';
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

export function fmt(value: unknown, digits = 1) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function renderVesselRows(rows: AnyObj[]) {
  return rows.length ? rows.map((v: AnyObj) => `<tr><td>${esc(v.name || 'Unnamed')}</td><td>${esc(v.type || '—')}</td><td>${esc(v.mmsi)}</td><td>${esc(ageLabel(v.age_s))}</td><td>${esc(fmt(v.speed))} kt</td><td>${esc(fmt(v.course,0))}°</td><td>${esc(fmt(v.lat,5))}</td><td>${esc(fmt(v.lon,5))}</td><td>${esc(v.source || '—')}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">NO AIS DATA RECEIVED — THIS DOES NOT MEAN ZERO SHIPS.</td></tr>';
}
