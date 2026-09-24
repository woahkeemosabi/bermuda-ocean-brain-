import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';
import * as Cesium from 'cesium';

const BERMUDA = { lat: 32.3078, lon: -64.7505 };
const CESIUM_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || import.meta.env.VITE_CESIU_ION_TOKEN || '';

if (CESIUM_TOKEN) Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

const AIR_MODELS: Record<string, string> = {
  A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A359: 'Airbus A350-900',
  B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B737: 'Boeing 737', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200', B763: 'Boeing 767-300',
  B772: 'Boeing 777-200', B77W: 'Boeing 777-300ER', B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  E170: 'Embraer E170', E75L: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195',
  C208: 'Cessna 208 Caravan', C172: 'Cessna 172', PC12: 'Pilatus PC-12', GLF6: 'Gulfstream G650', GL7T: 'Gulfstream G700',
};

type ContactIntel = {
  kind: 'aircraft' | 'vessel' | 'marine';
  title: string;
  subtitle: string;
  accent: string;
  rows: Array<[string, string]>;
};

type LiveContactStatus = { count: number; source?: string; error?: string };

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] || c));
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown) => value == null ? '' : String(value).trim();
const knotsFromMps = (value: unknown) => num(value) == null ? null : Number(value) * 1.943844;
const feetFromM = (value: unknown) => num(value) == null ? null : Number(value) * 3.28084;

function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function aircraftKind(typeCode: string, description: string, operator: string) {
  const code = typeCode.toUpperCase();
  const haystack = `${code} ${description} ${operator}`.toUpperCase();
  if (/HELI|ROTOR/.test(haystack)) return 'helicopter';
  if (/CARGO|FREIGHT/.test(haystack) || /^(B74[48]|B77F|A33F)/.test(code)) return 'cargo';
  if (/^(GLF|GLEX|CL3|CL6|LJ|FA7|FA8|PC24)/.test(code) || /BUSINESS|CORPORATE/.test(haystack)) return 'bizjet';
  if (/^(C1[578]|C172|C182|C208|PA|DA|SR|PC12|BE|P28)/.test(code) || /TURBOPROP|PISTON/.test(haystack)) return 'prop';
  return 'airliner';
}

function aircraftIcon(kind: string, color: string) {
  let body = '';
  if (kind === 'helicopter') {
    body = `<g fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="28" cy="29" rx="9" ry="5.5"/><path d="M37 29h11M47 25v8M19 29H8M28 23V11M12 11h32"/></g>`;
  } else if (kind === 'prop') {
    body = `<g fill="${color}"><path d="M27 5h4l2 18 17 6v4l-17-2-3 16 8 5v2l-9-2-10 2v-2l8-5-3-16-18 2v-4l18-6z"/><circle cx="29" cy="7" r="4" fill="none" stroke="${color}" stroke-width="1.8"/></g>`;
  } else if (kind === 'bizjet') {
    body = `<path fill="${color}" d="M27 4h4l3 18 15 5v4l-15-2-3 17 8 4v3l-10-2-10 2v-3l8-4-3-17-15 2v-4l15-5z"/>`;
  } else if (kind === 'cargo') {
    body = `<path fill="${color}" d="M26 4h6l4 18 18 6v5l-18-2-4 15 10 6v3l-13-3-13 3v-3l10-6-4-15-19 2v-5l19-6z"/>`;
  } else {
    body = `<path fill="${color}" d="M27 4h5l4 18 17 6v4l-17-2-4 16 10 6v3l-13-3-13 3v-3l10-6-4-16-18 2v-4l18-6z"/>`;
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 58 58"><defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#g)">${body}</g></svg>`);
}

function vesselKind(row: any) {
  const typeRaw = text(row?.shipType ?? row?.ship_type ?? row?.type ?? row?.vesselType ?? row?.vessel_type ?? row?.aisType ?? row?.ais_type);
  const typeNum = Number(typeRaw);
  const name = text(row?.name ?? row?.input_name);
  const length = num(row?.length ?? row?.length_m ?? row?.loa ?? row?.LOA) ?? (() => {
    const a = num(row?.dimA ?? row?.dimensionA ?? row?.to_bow);
    const b = num(row?.dimB ?? row?.dimensionB ?? row?.to_stern);
    return a !== null && b !== null ? a + b : null;
  })();
  const haystack = `${typeRaw} ${name}`.toUpperCase();
  if (/SAIL/.test(haystack) || typeNum === 36) return { key: 'sail', label: 'SAILBOAT', length };
  if (/YACHT|PLEASURE/.test(haystack) || typeNum === 37) {
    if (length !== null && length >= 60) return { key: 'megayacht', label: 'MEGAYACHT', length };
    if (length !== null && length >= 24) return { key: 'yacht', label: 'SUPERYACHT', length };
    return { key: 'yacht', label: 'YACHT', length };
  }
  if (/CARGO|CONTAINER|BULK/.test(haystack) || (typeNum >= 70 && typeNum <= 79)) return { key: 'cargo', label: 'CARGO SHIP', length };
  if (/TANKER/.test(haystack) || (typeNum >= 80 && typeNum <= 89)) return { key: 'tanker', label: 'TANKER', length };
  if (/FISH/.test(haystack) || typeNum === 30) return { key: 'fishing', label: 'FISHING', length };
  if (/TUG|TOW/.test(haystack) || [31,32,52].includes(typeNum)) return { key: 'tug', label: 'TUG', length };
  if (/PATROL|LAW|SAR|RESCUE/.test(haystack) || typeNum === 55) return { key: 'patrol', label: 'PATROL', length };
  if (/FERRY|CRUISE|PASSENGER/.test(haystack) || (typeNum >= 60 && typeNum <= 69)) return { key: 'passenger', label: 'PASSENGER', length };
  return { key: 'vessel', label: typeRaw ? typeRaw.toUpperCase() : 'VESSEL', length };
}

function vesselIcon(kind: string, color: string) {
  let shape = '';
  if (kind === 'sail') shape = `<path d="M29 5v34M28 9 11 36h17zM31 13l15 23H31zM9 40h40l-7 10H16z" fill="${color}"/>`;
  else if (kind === 'yacht' || kind === 'megayacht') shape = `<path d="M6 35h46l-8 13H16zM16 27h25l6 8H10zM22 19h15l4 8H19z" fill="${color}"/>`;
  else if (kind === 'cargo' || kind === 'tanker') shape = `<path d="M5 33h48l-8 15H14zM12 24h34v9H12zM16 15h9v9h-9zM27 15h9v9h-9zM38 15h7v9h-7z" fill="${color}"/>`;
  else if (kind === 'patrol') shape = `<path d="M7 34h44l-8 14H15zM20 24h18l7 10H13zM26 15h9v9h-9z" fill="${color}"/><path d="M10 31h39" stroke="#fff" stroke-width="2"/>`;
  else shape = `<path d="M7 34h44l-8 14H15zM18 24h22l6 10H12z" fill="${color}"/>`;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 58 58"><defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#g)">${shape}</g></svg>`);
}

function contactLabel(title: string, subtitle: string, color: Cesium.Color) {
  return {
    text: `${title}${subtitle ? `  ·  ${subtitle}` : ''}`,
    font: '800 10px ui-monospace, SFMono-Regular, Menlo, monospace',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK.withAlpha(0.92),
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString('#03131f').withAlpha(0.88),
    backgroundPadding: new Cesium.Cartesian2(7, 5),
    pixelOffset: new Cesium.Cartesian2(32, -6),
    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 190_000),
    scaleByDistance: new Cesium.NearFarScalar(8_000, 1.0, 190_000, 0.72),
    translucencyByDistance: new Cesium.NearFarScalar(135_000, 1.0, 260_000, 0.0),
    eyeOffset: new Cesium.Cartesian3(0, 0, -12),
  } as any;
}

function hudShell() {
  const root = document.createElement('div');
  root.id = 'ocean-ui';
  root.innerHTML = `
    <header class="brand-panel glass">
      <img src="/logo.svg" alt="" class="brand-logo" />
      <div><h1>BERMUDA OCEAN BRAIN</h1><p>PLANETARY ISLAND INTELLIGENCE</p></div>
    </header>
    <div class="auto-pill glass"><i></i><span>AUTO</span></div>
    <section class="scan-bar glass">
      <div class="scan-primary"><span class="radar-mini"><i></i></span><div><small>LIVE SCAN</small><strong id="scan-copy">SCANNING BERMUDA…</strong></div></div>
      <div class="scan-metric"><small>AIR</small><strong id="air-count">—</strong></div>
      <div class="scan-metric"><small>SEA</small><strong id="sea-count">—</strong></div>
      <div class="scan-metric"><small>WIND</small><strong id="wind-value">—</strong></div>
      <div class="scan-metric"><small>ALT</small><strong id="alt-value">—</strong></div>
    </section>
    <div class="center-reticle" aria-hidden="true"><i></i><b></b></div>
    <div class="world-scan" aria-hidden="true"></div>
    <div class="acquisition-toast" id="acquisition-toast">CONTACT ACQUIRED</div>
    <section class="intel-sheet glass" id="intel-sheet" aria-live="polite">
      <div class="sheet-head"><div class="sheet-icon" id="sheet-icon">◎</div><div><small id="sheet-kicker">WORLD INTELLIGENCE</small><h2 id="sheet-title">BERMUDA LIVE</h2><p id="sheet-subtitle">AUTO-CURATED SPATIAL CONTEXT</p></div><button id="sheet-close" aria-label="Close intelligence">×</button></div>
      <div class="sheet-grid" id="sheet-grid"></div>
    </section>
    <nav class="dock glass" aria-label="Ocean Brain controls">
      <button id="focus-btn"><span class="dock-icon target-icon"></span><b>FOCUS</b></button>
      <div class="world-live"><i></i><b>WORLD LIVE</b></div>
      <button id="intel-btn"><span class="dock-icon layers-icon"></span><b>INTEL</b></button>
    </nav>
  `;
  document.body.appendChild(root);
  return root;
}

function showIntel(root: HTMLElement, intel: ContactIntel) {
  root.classList.add('sheet-open');
  (root.querySelector('#sheet-kicker') as HTMLElement).textContent = intel.kind === 'marine' ? 'OCEAN INTELLIGENCE' : intel.kind === 'aircraft' ? 'AIR CONTACT' : 'SEA CONTACT';
  (root.querySelector('#sheet-title') as HTMLElement).textContent = intel.title;
  (root.querySelector('#sheet-subtitle') as HTMLElement).textContent = intel.subtitle;
  const icon = root.querySelector('#sheet-icon') as HTMLElement;
  icon.style.setProperty('--accent', intel.accent);
  icon.textContent = intel.kind === 'aircraft' ? '✈' : intel.kind === 'vessel' ? '◆' : '◎';
  const grid = root.querySelector('#sheet-grid') as HTMLElement;
  grid.innerHTML = intel.rows.map(([k,v]) => `<div class="intel-cell"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`).join('');
}

function defaultIntel(weather: any, air: LiveContactStatus, sea: LiveContactStatus): ContactIntel {
  const rows: Array<[string,string]> = [
    ['AIR CONTACTS', String(air.count)],
    ['SEA CONTACTS', String(sea.count)],
    ['WIND', Number.isFinite(weather?.windKn) ? `${Math.round(weather.windKn)} KT` : 'LIVE'],
    ['WEATHER', text(weather?.condition || 'Live')],
    ['REEF SYSTEM', 'BERMUDA PLATFORM'],
    ['MODE', 'AUTO WORLD'],
  ];
  return { kind: 'marine', title: 'BERMUDA LIVE', subtitle: 'AUTO-CURATED SPATIAL CONTEXT', accent: '#39e7ff', rows };
}

function focusBermuda(viewer: Cesium.Viewer, duration = 1.1) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(BERMUDA.lon, BERMUDA.lat, 72_000),
    orientation: { heading: Cesium.Math.toRadians(18), pitch: Cesium.Math.toRadians(-72), roll: 0 },
    duration,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
  });
}

function destinationOffset(lon: number, lat: number, bearingDeg: number, distanceDeg: number) {
  const a = Cesium.Math.toRadians(bearingDeg);
  return { lon: lon + Math.sin(a) * distanceDeg / Math.max(0.3, Math.cos(Cesium.Math.toRadians(lat))), lat: lat + Math.cos(a) * distanceDeg };
}

async function addGoogle3D(viewer: Cesium.Viewer) {
  if (!CESIUM_TOKEN) return null;
  try {
    const resource = await Cesium.IonResource.fromAssetId(2275207, { accessToken: CESIUM_TOKEN });
    const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
      maximumScreenSpaceError: 3.2,
      cacheBytes: 768 * 1024 * 1024,
      maximumCacheOverflowBytes: 512 * 1024 * 1024,
      preloadFlightDestinations: true,
      dynamicScreenSpaceError: true,
    });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false;
    return tileset;
  } catch (error) {
    console.warn('[Ocean Brain] 3D tiles unavailable', error);
    return null;
  }
}

const marineDefs = [
  { key: 'shelf', id: 'shelf', color: '#23a8e8', fill: 0.05, line: 0.48, minKm: 0, maxKm: 165, inspect: false },
  { key: 'territorial-seas', id: 'territorial', color: '#35e6ff', fill: 0.015, line: 0.48, minKm: 30, maxKm: 230, inspect: false },
  { key: 'coral-reef-type', id: 'coral', color: '#22f2d2', fill: 0.08, line: 0.28, minKm: 0, maxKm: 75, inspect: false },
  { key: 'seagrass', id: 'seagrass', color: '#58ee9a', fill: 0.07, line: 0.20, minKm: 0, maxKm: 18, inspect: false },
  { key: 'subsea-cables', id: 'cables', color: '#4dd7ff', fill: 0, line: 0.72, minKm: 0, maxKm: 120, inspect: true },
  { key: 'slope', id: 'slope', color: '#5168ff', fill: 0.025, line: 0.20, minKm: 85, maxKm: 340, inspect: false },
] as const;

async function loadMarine(viewer: Cesium.Viewer) {
  const loaded: Array<{ def: typeof marineDefs[number]; source: Cesium.GeoJsonDataSource }> = [];
  await Promise.all(marineDefs.map(async (def) => {
    try {
      const r = await fetch(`/api/marine/layers/${def.key}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const geo = await r.json();
      const ds = await Cesium.GeoJsonDataSource.load(geo, { clampToGround: true });
      const color = Cesium.Color.fromCssColorString(def.color);
      let featureIndex = 0;
      for (const e of ds.entities.values) {
        e.name = `OB:${def.id}:${featureIndex++}`;
        e.properties = new Cesium.PropertyBag({ obMarine: def.id, obInspectable: def.inspect });
        if (e.polygon) {
          e.polygon.material = color.withAlpha(def.fill);
          e.polygon.outline = true;
          e.polygon.outlineColor = color.withAlpha(def.line);
          e.polygon.height = 4;
        }
        if (e.polyline) {
          e.polyline.width = def.id === 'cables' ? 2.1 : 1.2;
          e.polyline.material = def.id === 'cables'
            ? new Cesium.PolylineGlowMaterialProperty({ color: color.withAlpha(0.82), glowPower: 0.13, taperPower: 0.8 })
            : color.withAlpha(def.line);
          e.polyline.clampToGround = true;
        }
        if (e.position && !e.polyline && !e.polygon) {
          e.billboard = undefined;
          e.point = new Cesium.PointGraphics({
            pixelSize: def.id === 'seagrass' ? 2.2 : 2.6,
            color: color.withAlpha(def.id === 'seagrass' ? 0.42 : 0.56),
            outlineWidth: 0,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, def.id === 'seagrass' ? 18_000 : 55_000),
          });
          e.label = undefined;
        }
      }
      ds.show = false;
      await viewer.dataSources.add(ds);
      loaded.push({ def, source: ds });
    } catch (error) {
      console.warn(`[Ocean Brain] marine ${def.id} unavailable`, error);
    }
  }));
  const update = () => {
    const km = Math.max(0, viewer.camera.positionCartographic.height / 1000);
    for (const item of loaded) item.source.show = km >= item.def.minKm && km <= item.def.maxKm;
  };
  update();
  viewer.camera.changed.addEventListener(update);
  return loaded;
}

async function loadRadar(viewer: Cesium.Viewer) {
  try {
    const r = await fetch('/api/radar-manifest', { cache: 'no-store' });
    if (!r.ok) return null;
    const manifest = await r.json();
    if (!manifest?.host || !manifest?.path) return null;
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `${manifest.host}${manifest.path}/256/{z}/{x}/{y}/2/1_1.png`,
      minimumLevel: 2,
      maximumLevel: 9,
      rectangle: Cesium.Rectangle.fromDegrees(-70.5, 27.5, -58.5, 38.5),
      credit: 'RainViewer',
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 0.22;
    layer.brightness = 1.05;
    layer.contrast = 1.12;
    layer.saturation = 1.15;
    return layer;
  } catch { return null; }
}

function installPicker(viewer: Cesium.Viewer, root: HTMLElement) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: any) => {
    const picked = viewer.scene.pick(movement.position);
    const entity = picked?.id;
    if (!entity?.properties) return;
    const p = entity.properties.getValue(Cesium.JulianDate.now()) || {};
    if (p.obKind === 'aircraft') {
      showIntel(root, {
        kind: 'aircraft', title: p.callsign || p.registration || 'AIRCRAFT', subtitle: `${p.className || 'AIRCRAFT'} · ${p.model || p.typeCode || 'LIVE ADS-B'}`, accent: '#ffbd66',
        rows: [
          ['MODEL', p.model || p.typeCode || 'Unknown'], ['REG', p.registration || '—'], ['ALTITUDE', p.altitudeFt ? `${Math.round(p.altitudeFt).toLocaleString()} FT` : '—'],
          ['SPEED', p.speedKt ? `${Math.round(p.speedKt)} KT` : '—'], ['HEADING', Number.isFinite(Number(p.heading)) ? `${Math.round(p.heading)}°` : '—'], ['OPERATOR', p.operator || '—'],
        ],
      });
    } else if (p.obKind === 'vessel') {
      showIntel(root, {
        kind: 'vessel', title: p.name || p.mmsi || 'VESSEL', subtitle: `${p.className || 'VESSEL'} · LIVE AIS`, accent: '#4fffc0',
        rows: [
          ['TYPE', p.className || 'Vessel'], ['MMSI', p.mmsi || '—'], ['LENGTH', p.lengthM ? `${Math.round(p.lengthM)} M` : '—'],
          ['SPEED', p.speedKt ? `${Number(p.speedKt).toFixed(1)} KT` : '—'], ['HEADING', Number.isFinite(Number(p.heading)) ? `${Math.round(p.heading)}°` : '—'], ['DESTINATION', p.destination || '—'],
        ],
      });
    } else if (p.obMarine === 'cables' && p.obInspectable) {
      showIntel(root, { kind: 'marine', title: 'SUBSEA CABLE', subtitle: 'BERMUDA INFRASTRUCTURE', accent: '#4dd7ff', rows: [['LAYER','SUBMARINE CABLE ROUTE'],['STATUS','MAPPED'],['SOURCE','BERMUDA MSP']] });
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return handler;
}

function createAircraftLayer(viewer: Cesium.Viewer, root: HTMLElement) {
  let source = new Cesium.CustomDataSource('air-contacts');
  let status: LiveContactStatus = { count: 0 };
  const trails = new Map<string, Array<[number,number,number]>>();
  const seen = new Set<string>();
  let initial = true;
  viewer.dataSources.add(source);

  async function refresh() {
    try {
      const r = await fetch('/api/opensky', { cache: 'no-store' });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload?.error || `HTTP ${r.status}`);
      const next = new Cesium.CustomDataSource('air-contacts-next');
      const states = Array.isArray(payload?.states) ? payload.states : [];
      let count = 0;
      for (const s of states.slice(0, 120)) {
        if (!Array.isArray(s)) continue;
        const lon = num(s[5]), lat = num(s[6]);
        if (lon === null || lat === null) continue;
        const icao = text(s[0]);
        const callsign = text(s[1]) || icao.toUpperCase();
        const altM = num(s[7] ?? s[13]) ?? 0;
        const speedKt = knotsFromMps(s[9]);
        const heading = num(s[10]) ?? 0;
        const typeCode = text(s[18]).toUpperCase();
        const registration = text(s[19]).toUpperCase();
        const operator = text(s[20]);
        const description = text(s[22]);
        const kind = aircraftKind(typeCode, description, operator);
        const model = AIR_MODELS[typeCode] || description || typeCode || 'Aircraft';
        const colorHex = kind === 'cargo' ? '#ff9a59' : kind === 'helicopter' ? '#ffdf70' : kind === 'bizjet' ? '#ffd5a2' : '#ffbd66';
        const color = Cesium.Color.fromCssColorString(colorHex);
        const id = `air:${icao || callsign}`;
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(800, altM));
        const labelSub = [typeCode || kind.toUpperCase(), speedKt ? `${Math.round(speedKt)} KT` : ''].filter(Boolean).join(' · ');
        next.entities.add({
          id, position,
          billboard: { image: aircraftIcon(kind, colorHex), width: 44, height: 44, rotation: Cesium.Math.toRadians(-heading), alignedAxis: Cesium.Cartesian3.ZERO, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(10_000, 1.25, 500_000, 0.68), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 480_000) },
          label: contactLabel(callsign, labelSub, color),
          properties: { obKind:'aircraft', callsign, registration, typeCode, model, className: kind === 'bizjet' ? 'BUSINESS JET' : kind === 'cargo' ? 'CARGO AIRCRAFT' : kind === 'prop' ? 'PROP / TURBOPROP' : kind === 'helicopter' ? 'HELICOPTER' : 'AIRCRAFT', altitudeFt: feetFromM(altM) ?? '', speedKt: speedKt ?? '', heading, operator },
        });
        const tr = trails.get(id) || [];
        tr.push([lon, lat, Math.max(800, altM)]);
        while (tr.length > 10) tr.shift();
        trails.set(id, tr);
        if (tr.length > 1) next.entities.add({ id:`${id}:trail`, polyline:{ positions: tr.map(([x,y,z]) => Cesium.Cartesian3.fromDegrees(x,y,z)), width:0.9, material:new Cesium.PolylineGlowMaterialProperty({color:color.withAlpha(0.22), glowPower:0.12}), arcType:Cesium.ArcType.NONE, distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,260_000) }});
        const end = destinationOffset(lon, lat, heading, 0.06);
        next.entities.add({ id:`${id}:vector`, polyline:{ positions:[position,Cesium.Cartesian3.fromDegrees(end.lon,end.lat,Math.max(800,altM))], width:0.8, material:color.withAlpha(0.14), arcType:Cesium.ArcType.NONE, distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,180_000) }});
        if (!initial && !seen.has(id)) acquisition(root, 'AIR CONTACT ACQUIRED');
        seen.add(id); count++;
      }
      initial = false;
      await viewer.dataSources.add(next);
      viewer.dataSources.remove(source, true);
      source = next;
      status = { count, source: r.headers.get('x-flight-source') || 'Live ADS-B' };
      updateContactHud(root, status, null);
    } catch (error) {
      status = { count: 0, error: String(error) };
      updateContactHud(root, status, null);
    }
  }
  void refresh();
  window.setInterval(() => void refresh(), 18_000);
  return { getStatus: () => status };
}

function createVesselLayer(viewer: Cesium.Viewer, root: HTMLElement) {
  let source = new Cesium.CustomDataSource('sea-contacts');
  let status: LiveContactStatus = { count: 0 };
  const contacts = new Map<string, any>();
  const trails = new Map<string, Array<[number,number]>>();
  const seen = new Set<string>();
  let initial = true;
  let renderTimer: number | null = null;
  let fallbackTimer: number | null = null;
  let eventSource: EventSource | null = null;
  viewer.dataSources.add(source);

  function scheduleRender() {
    if (renderTimer !== null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      void renderContacts();
    }, 180);
  }

  async function renderContacts() {
    const now = Date.now();
    for (const [key, value] of contacts) {
      if (now - Number(value.__seenAt || 0) > 8 * 60_000) contacts.delete(key);
    }
    const next = new Cesium.CustomDataSource('sea-contacts-next');
    let count = 0;
    for (const row of Array.from(contacts.values()).slice(0, 1200)) {
      const lon = num(row?.lon ?? row?.longitude), lat = num(row?.lat ?? row?.latitude);
      if (lon === null || lat === null) continue;
      const name = text(row?.name ?? row?.input_name ?? row?.mmsi) || 'VESSEL';
      const mmsi = text(row?.mmsi);
      const speedKt = num(row?.speed ?? row?.sog ?? row?.speedKn ?? row?.speed_kn ?? row?.speedOverGround);
      const heading = num(row?.heading ?? row?.course ?? row?.cog) ?? 0;
      const destination = text(row?.destination ?? row?.dest);
      const classification = vesselKind(row);
      const colorHex = classification.key === 'cargo' ? '#59cfff' : classification.key === 'tanker' ? '#ff8b7d' : classification.key === 'patrol' ? '#5be7ff' : classification.key === 'yacht' || classification.key === 'megayacht' ? '#f5ddff' : '#4fffc0';
      const color = Cesium.Color.fromCssColorString(colorHex);
      const id = `sea:${mmsi || name}`;
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 100);
      next.entities.add({
        id, position,
        billboard:{ image:vesselIcon(classification.key,colorHex), width:classification.key==='sail'?46:50, height:44, rotation:Cesium.Math.toRadians(-heading), disableDepthTestDistance:Number.POSITIVE_INFINITY, scaleByDistance:new Cesium.NearFarScalar(4_000,1.45,350_000,0.70), distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,360_000)},
        label: contactLabel(name.slice(0,20), `${classification.label}${speedKt !== null ? ` · ${speedKt.toFixed(1)} KT` : ''}`, color),
        properties:{ obKind:'vessel', name, mmsi, className:classification.label, lengthM:classification.length ?? '', speedKt:speedKt ?? '', heading, destination },
      });
      const tr = trails.get(id) || [];
      const last = tr[tr.length - 1];
      if (!last || Math.abs(last[0]-lon) > 0.00001 || Math.abs(last[1]-lat) > 0.00001) tr.push([lon,lat]);
      while (tr.length>12) tr.shift(); trails.set(id,tr);
      if (tr.length>1) next.entities.add({ id:`${id}:trail`, polyline:{positions:tr.map(([x,y])=>Cesium.Cartesian3.fromDegrees(x,y,100)), width:1.15, material:new Cesium.PolylineGlowMaterialProperty({color:color.withAlpha(0.28),glowPower:0.14}), arcType:Cesium.ArcType.NONE, distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,180_000)}});
      if (!initial && !seen.has(id)) acquisition(root,'SEA CONTACT ACQUIRED');
      seen.add(id); count++;
    }
    initial = false;
    await viewer.dataSources.add(next);
    viewer.dataSources.remove(source,true);
    source = next;
    status = { count, source: 'AISStream · Vercel' };
    updateContactHud(root,null,status);
  }

  function absorb(row: any) {
    const mmsi = text(row?.mmsi);
    const lon = num(row?.lon ?? row?.longitude), lat = num(row?.lat ?? row?.latitude);
    if (!mmsi || lon === null || lat === null) return;
    const previous = contacts.get(mmsi) || {};
    contacts.set(mmsi, { ...previous, ...row, __seenAt: Date.now() });
    scheduleRender();
  }

  async function pollSnapshot() {
    try {
      const r = await fetch('/api/ais-live?maxRows=1200&sampleMs=18000', { cache: 'no-store' });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload?.error || `HTTP ${r.status}`);
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      rows.forEach(absorb);
      if (!rows.length && contacts.size === 0) {
        status = { count: 0, source: payload?.source || 'AISStream', error: payload?.error || 'No AIS sample yet' };
        updateContactHud(root,null,status);
      }
    } catch (error) {
      if (contacts.size === 0) {
        status = { count: 0, error: String(error) };
        updateContactHud(root,null,status);
      }
    } finally {
      fallbackTimer = window.setTimeout(()=>void pollSnapshot(), 30_000);
    }
  }

  function startLiveStream() {
    if (!('EventSource' in window)) {
      void pollSnapshot();
      return;
    }
    eventSource = new EventSource('/api/ais-stream');
    let opened = false;
    eventSource.addEventListener('status', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload?.status === 'live') {
          opened = true;
          status = { count: contacts.size, source: 'AISStream · Vercel' };
          updateContactHud(root,null,status);
        } else if (payload?.error && contacts.size === 0) {
          status = { count: 0, error: String(payload.error) };
          updateContactHud(root,null,status);
        }
      } catch {}
    });
    eventSource.addEventListener('vessel', (event: MessageEvent) => {
      try { absorb(JSON.parse(event.data)); } catch {}
    });
    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      if (!opened || contacts.size === 0) void pollSnapshot();
      else fallbackTimer = window.setTimeout(()=>void pollSnapshot(), 4_000);
    };
  }

  startLiveStream();
  window.addEventListener('beforeunload',()=>{
    eventSource?.close();
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    if (renderTimer !== null) window.clearTimeout(renderTimer);
  }, { once:true });
  return { getStatus:()=>status };
}

let lastAir: LiveContactStatus = { count: 0 };
let lastSea: LiveContactStatus = { count: 0 };
function updateContactHud(root: HTMLElement, air: LiveContactStatus | null, sea: LiveContactStatus | null) {
  if (air) lastAir = air;
  if (sea) lastSea = sea;
  (root.querySelector('#air-count') as HTMLElement).textContent = lastAir.error ? '—' : String(lastAir.count);
  (root.querySelector('#sea-count') as HTMLElement).textContent = lastSea.error ? '—' : String(lastSea.count);
  const total = (lastAir.error ? 0 : lastAir.count) + (lastSea.error ? 0 : lastSea.count);
  const scanCopy = root.querySelector('#scan-copy') as HTMLElement;
  scanCopy.textContent = total > 0 ? `${total} TARGET${total===1?'':'S'} IN VIEW` : lastSea.error ? 'AIS UNAVAILABLE · AIR SCAN ACTIVE' : 'SCANNING BERMUDA…';
}

function acquisition(root: HTMLElement, message: string) {
  const toast = root.querySelector('#acquisition-toast') as HTMLElement;
  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  window.setTimeout(()=>toast.classList.remove('show'),1800);
}

async function refreshTelemetry(root: HTMLElement) {
  try {
    const r = await fetch('/api/telemetry', { cache:'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    const w = data?.weather || {};
    (root.querySelector('#wind-value') as HTMLElement).textContent = Number.isFinite(w.windKn) ? `${Math.round(w.windKn)}KT` : '—';
    return w;
  } catch { return null; }
}

async function start() {
  const root = hudShell();
  const viewer = new Cesium.Viewer('cesium-root', {
    animation:false, timeline:false, baseLayerPicker:false, geocoder:false, homeButton:false, sceneModePicker:false,
    navigationHelpButton:false, fullscreenButton:false, infoBox:false, selectionIndicator:false, shouldAnimate:true,
    terrainProvider: undefined,
  });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020811');
  viewer.scene.skyBox.show = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  viewer.scene.fog.enabled = false;
  viewer.scene.highDynamicRange = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  try {
    const bloom: any = viewer.scene.postProcessStages.bloom;
    if (bloom) { bloom.enabled = true; bloom.uniforms.glowOnly = false; bloom.uniforms.contrast = 96; bloom.uniforms.brightness = -0.12; bloom.uniforms.delta = 1; bloom.uniforms.sigma = 1.7; bloom.uniforms.stepSize = 1.0; }
  } catch {}
  viewer.resolutionScale = Math.min(Math.max(window.devicePixelRatio * 0.78, 1.25), 2.0);
  viewer.scene.globe.maximumScreenSpaceError = 1.35;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1500;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 1_200_000;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

  const tileset = await addGoogle3D(viewer);
  if (!tileset) viewer.scene.globe.show = true;
  focusBermuda(viewer, 0);

  await Promise.allSettled([loadMarine(viewer), loadRadar(viewer)]);
  const air = createAircraftLayer(viewer, root);
  const sea = createVesselLayer(viewer, root);
  installPicker(viewer, root);

  let weather: any = await refreshTelemetry(root);
  window.setInterval(async()=>{ weather = await refreshTelemetry(root) || weather; },60_000);

  const setAlt = () => {
    const km = viewer.camera.positionCartographic.height / 1000;
    (root.querySelector('#alt-value') as HTMLElement).textContent = km >= 100 ? `${Math.round(km)}K` : `${Math.round(km)}K`;
  };
  setAlt(); viewer.camera.changed.addEventListener(setAlt);

  root.querySelector('#focus-btn')?.addEventListener('click',()=>focusBermuda(viewer,0.85));
  root.querySelector('#intel-btn')?.addEventListener('click',()=>showIntel(root,defaultIntel(weather,air.getStatus(),sea.getStatus())));
  root.querySelector('#sheet-close')?.addEventListener('click',()=>root.classList.remove('sheet-open'));

  const loading = document.getElementById('loading');
  window.setTimeout(()=>loading?.classList.add('done'),350);
  window.setTimeout(()=>loading?.remove(),1000);

  Object.assign(window,{__oceanBrain:{version:'v19',viewer,focusBermuda:()=>focusBermuda(viewer,1),getAir:air.getStatus,getSea:sea.getStatus}});
}

start().catch((error)=>{
  console.error(error);
  const loading=document.getElementById('loading');
  if (loading) loading.innerHTML='<div class="load-error"><strong>WORLD INITIALIZATION FAILED</strong><span>Refresh to retry.</span></div>';
});
