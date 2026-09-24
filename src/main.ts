import 'gods-eye-view/ui/styles';
import './styles.css';
import * as Cesium from 'cesium';
import { createApplication } from 'gods-eye-view/application';
import { createApplicationScene } from 'gods-eye-view/application/scene';
import { createApplicationControls } from 'gods-eye-view/application/controls';
import { createApplicationData } from 'gods-eye-view/application/data';
import { createApplicationTools } from 'gods-eye-view/application/tools';
import { startApplicationChrome } from 'gods-eye-view/application/chrome';
import { createApplicationRequestServices } from 'gods-eye-view/application/requests';
import { createStandaloneCatalog } from 'gods-eye-view/standalone/catalog';
import { unavailablePlaceSearch } from 'gods-eye-view/search';
import {
  BERMUDA_MARINE_LAYER_METADATA,
  createBermudaMarineLayers,
} from './oceanBrainMarineLayers';
import { GeoLibreLayerStack, type GeoLibreStackEntry } from './geolibreStack';

const BERMUDA = { latitude: 32.3078, longitude: -64.7505 };
const DEFAULT_VISIBLE_GODS_EYE_LAYERS = new Set<string>();
const DEFAULT_OCEAN_BRAIN_LAYERS: string[] = [];
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || import.meta.env.VITE_CESIU_ION_TOKEN || '';
const HAS_3D_CREDENTIALS = Boolean(GOOGLE_MAPS_API_KEY || CESIUM_ION_TOKEN);

type ThreeDRecovery = { tileset: any | null; errorCode: string | null };
type LayerCategory = 'live' | 'ocean';
type CameraPreset = { latitude: number; longitude: number; height: number; heading?: number };
type MobileLayerDefinition = {
  id: string;
  label: string;
  glyph: string;
  category: LayerCategory;
  group: 'traffic' | 'weather' | 'habitat' | 'bathymetry' | 'jurisdiction' | 'infrastructure';
  color: string;
  subtitle: string;
  camera?: CameraPreset;
};

type TelemetryPayload = {
  generatedAt?: string;
  power?: { estimatedMW?: number; annualReferenceGWh?: number; live?: boolean; source?: string };
  weather?: { temperatureC?: number; windKn?: number; humidityPct?: number; precipitationMm?: number; condition?: string };
};

const LIVE_LAYER_DEFINITIONS: readonly MobileLayerDefinition[] = Object.freeze([
  { id: 'vessels', label: 'Ships', glyph: '◆', category: 'live', group: 'traffic', color: '#4fffc0', subtitle: 'AIS vessel traffic' },
  { id: 'flights', label: 'Aircraft', glyph: '✈', category: 'live', group: 'traffic', color: '#ffbd66', subtitle: 'Regional live air traffic' },
  { id: 'wind', label: 'Wind', glyph: '≈', category: 'live', group: 'weather', color: '#66b9ff', subtitle: 'Atmospheric flow' },
  { id: 'weather-radar', label: 'Radar', glyph: '◌', category: 'live', group: 'weather', color: '#4fe0ff', subtitle: 'Precipitation radar' },
  { id: 'weather-satellite', label: 'Clouds', glyph: '☁', category: 'live', group: 'weather', color: '#c1d4ff', subtitle: 'Satellite cloud field' },
  { id: 'weather-lightning', label: 'Lightning', glyph: 'ϟ', category: 'live', group: 'weather', color: '#ffe66a', subtitle: 'Lightning activity' },
  { id: 'weather-cyclones', label: 'Cyclones', glyph: '⊙', category: 'live', group: 'weather', color: '#ff7f9d', subtitle: 'Atlantic tropical systems' },
]);

const OCEAN_LAYER_DEFINITIONS: readonly MobileLayerDefinition[] = Object.freeze([
  { id: 'bermuda-coral-reef-type', label: 'Coral Reef', glyph: '✦', category: 'ocean', group: 'habitat', color: '#22f2d2', subtitle: 'Reef habitat classification' },
  { id: 'bermuda-seagrass', label: 'Seagrass', glyph: '≋', category: 'ocean', group: 'habitat', color: '#5cff9a', subtitle: 'Seagrass observations' },
  { id: 'bermuda-shelf', label: 'Bermuda Shelf', glyph: '▱', category: 'ocean', group: 'bathymetry', color: '#37b8ff', subtitle: 'Shallow platform', camera: { ...BERMUDA, height: 130_000 } },
  { id: 'bermuda-slope', label: 'Slope', glyph: '◢', category: 'ocean', group: 'bathymetry', color: '#586cff', subtitle: 'Shelf break + slope', camera: { ...BERMUDA, height: 185_000 } },
  { id: 'bermuda-seamounts', label: 'Seamounts', glyph: '▲', category: 'ocean', group: 'bathymetry', color: '#cf70ff', subtitle: 'Regional seamount field', camera: { ...BERMUDA, height: 650_000 } },
  { id: 'bermuda-territorial-seas', label: 'Territorial Sea', glyph: '◎', category: 'ocean', group: 'jurisdiction', color: '#35e6ff', subtitle: '12 NM sovereign boundary', camera: { ...BERMUDA, height: 145_000 } },
  { id: 'bermuda-eez', label: 'EEZ', glyph: '◉', category: 'ocean', group: 'jurisdiction', color: '#786dff', subtitle: 'Exclusive Economic Zone', camera: { ...BERMUDA, height: 640_000 } },
  { id: 'bermuda-subsea-cables', label: 'Subsea Cables', glyph: '⌁', category: 'ocean', group: 'infrastructure', color: '#ffca5c', subtitle: 'Submarine cable routes', camera: { ...BERMUDA, height: 230_000 } },
]);

const MOBILE_LAYER_DEFINITIONS: readonly MobileLayerDefinition[] = Object.freeze([
  ...LIVE_LAYER_DEFINITIONS,
  ...OCEAN_LAYER_DEFINITIONS,
]);

function classify3DError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (!CESIUM_ION_TOKEN) return 'TOKEN MISSING';
  if (message.includes('401') || message.includes('403') || message.includes('unauthor') || message.includes('forbidden') || message.includes('token')) return 'AUTH';
  if (message.includes('404') || message.includes('not found') || message.includes('asset')) return 'ASSET';
  if (message.includes('fetch') || message.includes('network') || message.includes('cors')) return 'NETWORK';
  return 'LOAD';
}

async function recoverPhotorealistic3D(viewer: any): Promise<ThreeDRecovery> {
  if (!CESIUM_ION_TOKEN) return { tileset: null, errorCode: 'TOKEN MISSING' };
  try {
    const resource = await Cesium.IonResource.fromAssetId(2275207, {
      accessToken: CESIUM_ION_TOKEN,
    });
    const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
      cacheBytes: 768 * 1024 * 1024,
      maximumCacheOverflowBytes: 512 * 1024 * 1024,
      enableCollision: true,
      asynchronouslyLoadImagery: true,
    });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false;
    viewer.scene.requestRender();
    console.info('[Ocean Brain] Google 3D recovery path loaded Cesium ion asset 2275207.');
    return { tileset, errorCode: null };
  } catch (error) {
    console.warn('[Ocean Brain] Google 3D recovery path failed:', error);
    return { tileset: null, errorCode: classify3DError(error) };
  }
}

function applyOceanBrainBrand() {
  document.title = 'Bermuda Ocean Brain';
  const title = document.querySelector<HTMLElement>('#title-bar h1');
  if (title) title.innerHTML = '<span class="title-logo brand-logo" aria-hidden="true"><img src="./logo.svg" alt="" /></span> <span>BERMUDA OCEAN <span class="title-accent">BRAIN</span></span>';
  const subtitle = document.querySelector<HTMLElement>('#title-bar .subtitle');
  if (subtitle) subtitle.textContent = 'ISLAND-SCALE SPATIAL INTELLIGENCE';
  const styleLabel = document.querySelector<HTMLElement>('#style-indicator .indicator-label');
  if (styleLabel) styleLabel.textContent = 'OCEAN BRAIN // ACTIVE STYLE';
  const dataTitle = document.querySelector<HTMLElement>('#data-panel .panel-title');
  if (dataTitle) dataTitle.textContent = 'MISSION LAYERS';
}

function relabelMarineGroup() {
  document.querySelectorAll<HTMLElement>('.data-layer-group-heading').forEach((heading) => {
    if (heading.textContent?.trim() === 'Other layers') heading.textContent = 'Bermuda Marine';
  });
}

function installMarinePanelBranding() {
  const container = document.getElementById('data-toggles');
  if (!container) return null;
  const observer = new MutationObserver(relabelMarineGroup);
  observer.observe(container, { childList: true, subtree: true });
  relabelMarineGroup();
  return observer;
}

function createOceanBrainCatalog(context: any, scene: any) {
  const base = createStandaloneCatalog({
    signal: context.signal,
    surface: scene.operations.surface,
  });
  for (const layer of base.layers) {
    layer.showInTogglePanel = DEFAULT_VISIBLE_GODS_EYE_LAYERS.has(layer.id);
  }
  const marineLayers = createBermudaMarineLayers();
  const layers = Object.freeze([...base.layers, ...marineLayers]);
  const metadata = Object.freeze([
    ...base.metadata,
    ...BERMUDA_MARINE_LAYER_METADATA,
  ]);
  const byId = new Map(layers.map((layer: any) => [layer.id, layer]));
  return Object.freeze({
    ...base,
    layers,
    metadata,
    get: (id: string) => byId.get(id),
  });
}

function configureRenderQuality(viewer: any, tileset: any) {
  const deviceScale = Number(window.devicePixelRatio || 1);
  viewer.resolutionScale = Math.min(Math.max(deviceScale * 0.68, 1.3), 1.9);
  if (viewer.scene?.globe) viewer.scene.globe.maximumScreenSpaceError = 1.2;
  if (viewer.scene?.fog) viewer.scene.fog.enabled = false;
  if (tileset) {
    tileset.maximumScreenSpaceError = 6.5;
    tileset.preloadWhenHidden = false;
    tileset.preloadFlightDestinations = true;
    tileset.dynamicScreenSpaceError = true;
  }
  viewer.scene?.requestRender?.();
}

function flyToPreset(viewer: any, preset: CameraPreset, duration = 1.05) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(preset.longitude, preset.latitude, preset.height),
    orientation: {
      heading: Cesium.Math.toRadians(preset.heading ?? 43),
      pitch: Cesium.Math.toRadians(-89.2),
      roll: 0,
    },
    duration,
  });
}

function focusBermuda(viewer: any, duration = 1.15, photoreal3D = HAS_3D_CREDENTIALS) {
  const cameraOptions = {
    destination: Cesium.Cartesian3.fromDegrees(
      BERMUDA.longitude,
      BERMUDA.latitude,
      photoreal3D ? 56_000 : 61_000,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(43),
      pitch: Cesium.Math.toRadians(-89.2),
      roll: 0,
    },
  };
  if (duration <= 0) {
    viewer.camera.setView(cameraOptions);
    return;
  }
  viewer.camera.flyTo({ ...cameraOptions, duration });
}

function renderLayerButtons(definitions: readonly MobileLayerDefinition[]) {
  return definitions.map((layer) => `
    <button class="ob-layer-toggle" type="button" data-layer-id="${layer.id}" data-active="${DEFAULT_OCEAN_BRAIN_LAYERS.includes(layer.id) ? 'true' : 'false'}" data-feed-state="off" style="--layer-color:${layer.color}">
      <span class="ob-layer-glyph">${layer.glyph}</span>
      <span class="ob-layer-copy"><strong>${layer.label}</strong><small data-default-copy="${layer.subtitle}">${layer.subtitle}</small></span>
    </button>
  `).join('');
}

function renderLayerGroup(title: string, subtitle: string, definitions: readonly MobileLayerDefinition[]) {
  return `<div class="ob-mini-layer-group"><div class="ob-mini-group-title"><span>${title}</span><em>${subtitle}</em></div><div class="ob-layer-grid">${renderLayerButtons(definitions)}</div></div>`;
}

function renderGroupedMissionLayers() {
  const group = (id: MobileLayerDefinition['group']) => MOBILE_LAYER_DEFINITIONS.filter((layer) => layer.group === id);
  return [
    renderLayerGroup('TRAFFIC', 'LIVE', group('traffic')),
    renderLayerGroup('WEATHER', 'LIVE', group('weather')),
    renderLayerGroup('HABITATS', 'BDA MSP', group('habitat')),
    renderLayerGroup('BATHYMETRY', 'BDA MSP', group('bathymetry')),
    renderLayerGroup('JURISDICTION', 'BDA MSP', group('jurisdiction')),
    renderLayerGroup('INFRASTRUCTURE', 'BDA MSP', group('infrastructure')),
  ].join('');
}



type LiveFeedState = 'off' | 'loading' | 'live' | 'empty' | 'error';
type LiveFeedStatus = { state: LiveFeedState; text: string; count?: number; error?: string };
type CustomLayerController = {
  enable: () => Promise<LiveFeedStatus>;
  disable: () => Promise<void>;
  getStatus: () => LiveFeedStatus;
  setVisible?: (visible: boolean) => void | Promise<void>;
  setOpacity?: (opacity: number) => void | Promise<void>;
  raiseToTop?: () => void | Promise<void>;
  setFilter?: (filter: string) => void | Promise<void>;
  setTimeOffset?: (offset: number) => void | Promise<void>;
};

function layerImageryCollection(viewer: any, tileset: any) {
  return tileset?.imageryLayers || viewer.imageryLayers;
}

function shortFeedError(value: unknown) {
  const raw = String((value as any)?.message || value || 'SOURCE OFFLINE')
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/404|not found/i.test(raw)) return 'SOURCE NOT CONNECTED';
  if (/401|403|auth|credential|token/i.test(raw)) return 'AUTH REQUIRED';
  if (/429|rate/i.test(raw)) return 'RATE LIMITED';
  if (/network|fetch|timeout|timed out/i.test(raw)) return 'SOURCE OFFLINE';
  return raw.length > 30 ? `${raw.slice(0, 27)}…` : raw.toUpperCase();
}

function setLayerButtonStatus(button: HTMLButtonElement, status: LiveFeedStatus) {
  button.dataset.feedState = status.state;
  const copy = button.querySelector<HTMLElement>('small');
  if (!copy) return;
  if (status.state === 'off') {
    copy.textContent = copy.dataset.defaultCopy || '';
    button.removeAttribute('data-error');
    return;
  }
  copy.textContent = status.text;
  if (status.state === 'error') button.dataset.error = 'true';
  else button.removeAttribute('data-error');
}




type EntityIntel = {
  kind: 'aircraft' | 'vessel' | 'ocean';
  title: string;
  className: string;
  accent: string;
  rows: Array<[string, string]>;
};

const AIRCRAFT_MODELS: Record<string, string> = {
  A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900neo', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
  B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B737: 'Boeing 737', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200', B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', E170: 'Embraer E170', E175: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', DH8D: 'Dash 8 Q400', AT72: 'ATR 72',
  C172: 'Cessna 172', C182: 'Cessna 182', C208: 'Cessna Caravan', PC12: 'Pilatus PC-12', PC24: 'Pilatus PC-24', C56X: 'Cessna Citation Excel',
  GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', GLEX: 'Bombardier Global Express', CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600',
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char));
}

function svgDataUrl(kind: string, color = '#ffffff') {
  const c = escapeXml(color);
  const shapes: Record<string, string> = {
    airliner: '<path d="M32 3l5 19 20 8v5l-20-3-3 24 7 5v4l-9-3-9 3v-4l7-5-3-24-20 3v-5l20-8 5-19z"/>',
    cargo: '<path d="M32 4l5 17 21 9v6l-21-3-3 21 10 6v4l-12-3-12 3v-4l10-6-3-21-21 3v-6l21-9 5-17z"/><rect x="24" y="28" width="16" height="5" rx="2" fill="#06141b"/>',
    bizjet: '<path d="M32 7l4 18 17 7v5l-17-2-2 17 7 5v4l-9-3-9 3v-4l7-5-2-17-17 2v-5l17-7 4-18z"/>',
    prop: '<path d="M32 10l4 16 14 7v4l-14-2-2 15 6 5v3l-8-3-8 3v-3l6-5-2-15-14 2v-4l14-7 4-16z"/><path d="M20 18h24v3H20zM30 8h4v23h-4z" opacity=".7"/>',
    helicopter: '<path d="M20 27h25c7 0 11 5 11 10 0 7-7 11-15 11H24c-7 0-12-4-12-10 0-6 4-11 8-11z"/><rect x="29" y="14" width="5" height="15"/><rect x="7" y="11" width="50" height="3" rx="1.5"/><path d="M45 30l13-8 2 3-10 10z"/>',
    sailboat: '<path d="M31 8v35H12l19-35zm3 5l16 30H34V13z"/><path d="M9 46h47l-7 10H17z"/>',
    yacht: '<path d="M6 38h38l9-9h5l-5 17c-2 7-9 11-17 11H18C11 57 7 50 6 38z"/><path d="M21 25h22l8 10H17z"/>',
    megayacht: '<path d="M4 36h46l9-10h3l-5 20c-2 8-10 13-20 13H18C10 59 5 51 4 36z"/><path d="M15 31h35l-6-9H24z"/><rect x="26" y="14" width="18" height="6" rx="2"/>',
    cargoShip: '<path d="M4 35h54l-5 15c-2 6-9 10-17 10H18C11 60 6 52 4 35z"/><rect x="12" y="22" width="12" height="11"/><rect x="25" y="18" width="12" height="15"/><rect x="38" y="24" width="12" height="9"/>',
    tanker: '<path d="M4 37h56l-6 13c-3 7-10 10-18 10H19C11 60 6 52 4 37z"/><rect x="13" y="27" width="34" height="7" rx="3"/><circle cx="20" cy="30" r="2" fill="#06141b"/><circle cx="31" cy="30" r="2" fill="#06141b"/><circle cx="42" cy="30" r="2" fill="#06141b"/>',
    tug: '<path d="M9 38h46l-5 13c-2 5-8 8-15 8H21c-7 0-11-6-12-21z"/><path d="M22 23h20l7 13H17z"/><rect x="27" y="14" width="11" height="8"/>',
    ferry: '<path d="M5 38h54l-6 13c-3 6-10 9-18 9H19C11 60 6 52 5 38z"/><rect x="14" y="17" width="34" height="18" rx="3"/><path d="M18 22h26M18 28h26" stroke="#06141b" stroke-width="3"/>',
    fishing: '<path d="M7 39h49l-5 12c-3 6-9 9-17 9H20C12 60 8 53 7 39z"/><path d="M17 35l12-17h4l-4 17zm15 0l12-10h4l-8 10z"/>',
    vessel: '<path d="M7 37h50l-6 14c-3 6-9 9-17 9H20C12 60 8 52 7 37z"/><path d="M21 25h22l7 10H15z"/>',
    seagrass: '<path d="M31 59c-1-15 2-25 8-42 2 13 0 27-6 42h-2zm-6 0c-8-14-12-25-10-39 8 10 13 23 12 39h-2zm12 0c3-14 9-25 17-34-1 15-6 26-15 34h-2z"/>',
    coral: '<path d="M29 60V39l-12-8 4-6 8 6V18h7v12l8-7 5 5-13 12v20h-7zm-12-18L8 35l4-5 9 7-4 5zm29 1l9-8 5 5-10 8-4-5z"/>',
    seamount: '<path d="M4 55L21 30l8 11L40 16l20 39H4z"/><path d="M34 29l6-13 7 14-6-3z" fill="#06141b" opacity=".55"/>',
    cable: '<path d="M6 35c10-15 18-15 28 0s18 15 24 0" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="7" cy="35" r="5"/><circle cx="58" cy="35" r="5"/>',
    boundary: '<circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="32" cy="32" r="8"/>',
    shelf: '<path d="M7 18h50L47 50H17L7 18z" fill="none" stroke="currentColor" stroke-width="6"/><path d="M18 29h28" stroke="currentColor" stroke-width="4"/>',
    slope: '<path d="M10 12h44L38 52H22L10 12z"/><path d="M17 18h28L34 45H26z" fill="#06141b" opacity=".55"/>',
    ocean: '<path d="M7 37c7-9 14-9 21 0s14 9 21 0 10-6 12-3v10c-6-4-11-2-17 5-7 9-14 9-21 0S9 40 3 45V35c1 0 2 1 4 2z"/>',
  };
  const shape = shapes[kind] || shapes.ocean;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${c}" color="${c}" stroke-linejoin="round">${shape}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function aircraftClass(typeCode: string, description: string, operator: string) {
  const type = typeCode.toUpperCase();
  const text = `${type} ${description} ${operator}`.toUpperCase();
  if (/HELI|ROTOR|HELICOPTER/.test(text)) return { key: 'helicopter', label: 'HELICOPTER' };
  if (/CARGO|FREIGHT|FREIGHTER/.test(text) || /^(B74[48]|B77[FL]|A33F)/.test(type)) return { key: 'cargo', label: 'CARGO AIRCRAFT' };
  if (/^(GLF|GLEX|CL3|CL6|C5|C6|C7|LJ|E5|FA7|FA8|PC24)/.test(type) || /BUSINESS|CORPORATE/.test(text)) return { key: 'bizjet', label: 'BUSINESS JET' };
  if (/^(C1[578]|C172|C182|C208|PA|DA|SR|PC12|BE|P28)/.test(type) || /TURBOPROP|PISTON/.test(text)) return { key: 'prop', label: 'PROP / TURBOPROP' };
  return { key: 'airliner', label: type ? 'AIRCRAFT' : 'AIRCRAFT' };
}

function aircraftModel(typeCode: string, description: string) {
  const type = typeCode.toUpperCase();
  return AIRCRAFT_MODELS[type] || description || type || 'Aircraft';
}

function numberFrom(row: any, keys: string[]) {
  for (const key of keys) {
    const raw = row?.[key];
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function textFrom(row: any, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function vesselClass(row: any) {
  const rawType = textFrom(row, ['shipType', 'ship_type', 'type', 'vesselType', 'vessel_type', 'aisType', 'ais_type']);
  const numericType = Number(rawType);
  const length = numberFrom(row, ['length', 'length_m', 'loa', 'LOA']) ?? (() => {
    const a = numberFrom(row, ['dimA', 'dimensionA', 'to_bow']);
    const b = numberFrom(row, ['dimB', 'dimensionB', 'to_stern']);
    return a !== null && b !== null ? a + b : null;
  })();
  const name = textFrom(row, ['name', 'input_name']);
  const text = `${rawType} ${name}`.toUpperCase();
  const isPleasure = /YACHT|PLEASURE/.test(text) || numericType === 37;
  if (/SAIL/.test(text) || numericType === 36) return { key: 'sailboat', label: 'SAILBOAT', length };
  if (isPleasure && length !== null && length >= 60) return { key: 'megayacht', label: 'MEGAYACHT', length };
  if (isPleasure && length !== null && length >= 24) return { key: 'yacht', label: 'SUPERYACHT', length };
  if (isPleasure) return { key: 'yacht', label: 'YACHT / PLEASURE', length };
  if (/CARGO|CONTAINER|BULK/.test(text) || (numericType >= 70 && numericType <= 79)) return { key: 'cargoShip', label: 'CARGO SHIP', length };
  if (/TANKER/.test(text) || (numericType >= 80 && numericType <= 89)) return { key: 'tanker', label: 'TANKER', length };
  if (/FISH/.test(text) || numericType === 30) return { key: 'fishing', label: 'FISHING VESSEL', length };
  if (/TUG|TOW/.test(text) || numericType === 31 || numericType === 32 || numericType === 52) return { key: 'tug', label: 'TUG / TOW', length };
  if (/FERRY|CRUISE|PASSENGER/.test(text) || (numericType >= 60 && numericType <= 69)) return { key: 'ferry', label: /CRUISE/.test(text) ? 'CRUISE SHIP' : 'PASSENGER / FERRY', length };
  return { key: 'vessel', label: rawType ? rawType.toUpperCase() : 'VESSEL', length };
}

function propertyValue(value: any) {
  if (value && typeof value.getValue === 'function') return value.getValue(Cesium.JulianDate.now());
  return value;
}

function entityProperties(entity: any) {
  const bag = entity?.properties;
  if (!bag) return {} as Record<string, any>;
  if (typeof bag.getValue === 'function') {
    try { return bag.getValue(Cesium.JulianDate.now()) || {}; } catch { return {}; }
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(bag)) result[key] = propertyValue(bag[key]);
  return result;
}

function compactValue(value: any) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 39)}…` : text;
}

function oceanIntelFromEntity(entity: any): EntityIntel | null {
  const props = entityProperties(entity);
  const layerId = String(props.oceanBrainLayerId || '');
  const layerName = String(props.oceanBrainLayerName || 'OCEAN INTELLIGENCE');
  if (!layerId.startsWith('bermuda-')) return null;
  const preferred = ['Name','NAME','name','Type','TYPE','type','Category','CATEGORY','Class','CLASS','Habitat','HABITAT','Cable','CABLE','Status','STATUS','Depth','DEPTH','Area','AREA'];
  const title = preferred.map((key) => props[key]).find((value) => value !== undefined && value !== null && String(value).trim()) || layerName;
  const rows: Array<[string,string]> = [];
  const seen = new Set<string>();
  for (const key of preferred) {
    const text = compactValue(props[key]);
    if (!text || seen.has(text.toLowerCase()) || String(title) === text) continue;
    rows.push([key.replace(/_/g, ' ').toUpperCase(), text]);
    seen.add(text.toLowerCase());
    if (rows.length >= 5) break;
  }
  if (rows.length < 4) {
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('oceanBrain') || preferred.includes(key)) continue;
      const text = compactValue(value);
      if (!text || /^objectid$/i.test(key) || seen.has(text.toLowerCase())) continue;
      rows.push([key.replace(/_/g, ' ').toUpperCase().slice(0, 18), text]);
      seen.add(text.toLowerCase());
      if (rows.length >= 6) break;
    }
  }
  const definition = OCEAN_LAYER_DEFINITIONS.find((layer) => layer.id === layerId);
  return { kind: 'ocean', title: String(title), className: layerName.toUpperCase(), accent: definition?.color || '#35e6ff', rows };
}

function entityIntelFromEntity(entity: any): EntityIntel | null {
  const props = entityProperties(entity);
  const kind = String(props.oceanBrainKind || '');
  if (kind === 'aircraft') {
    const rows: Array<[string,string]> = [
      ['TYPE', compactValue(props.model || props.typeCode || props.className)],
      ['REG', compactValue(props.registration)],
      ['ALT', compactValue(props.altitudeFt ? `${Math.round(Number(props.altitudeFt)).toLocaleString()} FT` : '')],
      ['SPEED', compactValue(props.speedKt ? `${Math.round(Number(props.speedKt))} KT` : '')],
      ['HEADING', compactValue(props.headingDeg !== '' ? `${Math.round(Number(props.headingDeg))}°` : '')],
      ['OPERATOR', compactValue(props.operator)],
    ].filter((row) => row[1]) as Array<[string,string]>;
    return { kind: 'aircraft', title: String(props.callsign || props.registration || 'AIRCRAFT'), className: String(props.className || 'AIRCRAFT'), accent: '#ffbd66', rows };
  }
  if (kind === 'vessel') {
    const rows: Array<[string,string]> = [
      ['TYPE', compactValue(props.className)],
      ['MMSI', compactValue(props.mmsi)],
      ['LENGTH', compactValue(props.lengthM ? `${Number(props.lengthM).toFixed(0)} M` : '')],
      ['SPEED', compactValue(props.speedKt ? `${Number(props.speedKt).toFixed(1)} KT` : '')],
      ['HEADING', compactValue(props.headingDeg !== '' ? `${Math.round(Number(props.headingDeg))}°` : '')],
      ['DESTINATION', compactValue(props.destination)],
    ].filter((row) => row[1]) as Array<[string,string]>;
    return { kind: 'vessel', title: String(props.name || props.mmsi || 'VESSEL'), className: String(props.className || 'VESSEL'), accent: '#4fffc0', rows };
  }
  return oceanIntelFromEntity(entity);
}

function installEntityInspector(viewer: any, shell: HTMLElement) {
  const panel = shell.querySelector<HTMLElement>('.ob-entity-inspector');
  if (!panel) return null;
  const close = () => shell.classList.remove('entity-open');
  shell.querySelector<HTMLButtonElement>('.ob-entity-close')?.addEventListener('click', close);
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  const renderIntel = (intel: EntityIntel, entity?: any, index = 0, total = 1) => {
    const props = entity ? entityProperties(entity) : {};
    panel.style.setProperty('--entity-accent', intel.accent);
    const title = panel.querySelector<HTMLElement>('.ob-entity-title');
    const cls = panel.querySelector<HTMLElement>('.ob-entity-class');
    const grid = panel.querySelector<HTMLElement>('.ob-entity-grid');
    const icon = panel.querySelector<HTMLImageElement>('.ob-entity-icon img');
    const counter = panel.querySelector<HTMLElement>('.ob-identify-counter');
    if (title) title.textContent = intel.title.toUpperCase();
    if (cls) cls.textContent = intel.className;
    if (counter) counter.textContent = total > 1 ? `${index + 1} / ${total} FEATURES` : 'IDENTIFIED FEATURE';
    if (grid) grid.innerHTML = intel.rows.length
      ? intel.rows.map(([key, value]) => `<span><small>${key}</small><b>${String(value).replace(/[<>]/g, '')}</b></span>`).join('')
      : '<span><small>INTELLIGENCE</small><b>FEATURE IDENTIFIED</b></span>';
    if (icon) {
      const kind = String(props.oceanBrainKind || '');
      const iconKind = kind === 'aircraft' ? String(props.iconKind || 'airliner') : kind === 'vessel' ? String(props.iconKind || 'vessel') : String(props.oceanBrainIconKind || 'ocean');
      icon.src = svgDataUrl(iconKind, intel.accent);
    }
  };

  handler.setInputAction((movement: any) => {
    if (shell.dataset.mapTool && shell.dataset.mapTool !== 'identify') return;
    const picks = viewer.scene.drillPick(movement.position, 24) || [];
    const found: Array<{entity:any; intel:EntityIntel}> = [];
    const seen = new Set<any>();
    for (const pick of picks) {
      const entity = pick?.id;
      if (!entity || seen.has(entity)) continue;
      const intel = entityIntelFromEntity(entity);
      if (!intel) continue;
      seen.add(entity);
      found.push({ entity, intel });
      if (found.length >= 12) break;
    }
    if (!found.length) return;

    let selected = 0;
    const switcher = panel.querySelector<HTMLElement>('.ob-identify-switcher');
    const refreshSwitcher = () => {
      if (!switcher) return;
      switcher.innerHTML = found.map(({ intel }, index) => `<button type="button" data-i="${index}" class="${index === selected ? 'active' : ''}" style="--pick-color:${intel.accent}">${intel.className.slice(0, 18)}</button>`).join('');
      switcher.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.addEventListener('click', () => {
          selected = Number(button.dataset.i || 0);
          const item = found[selected];
          renderIntel(item.intel, item.entity, selected, found.length);
          refreshSwitcher();
        });
      });
    };

    renderIntel(found[0].intel, found[0].entity, 0, found.length);
    refreshSwitcher();
    shell.classList.remove('layers-open', 'intel-open', 'entity-open');
    shell.classList.add('entity-open');
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return handler;
}

function createAircraftController(viewer: any): CustomLayerController {
  let dataSource: any = null;
  let timer: number | null = null;
  let enabled = false;
  let filter = 'all';
  let status: LiveFeedStatus = { state: 'off', text: 'Regional live air traffic' };

  const clearTimer = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
  const remove = () => { if (dataSource) viewer.dataSources.remove(dataSource, true); dataSource = null; };
  const schedule = () => { clearTimer(); if (enabled) timer = window.setTimeout(() => { void refresh(); }, 20_000); };
  const applyFilter = () => {
    if (!dataSource) return;
    const visibleTargets = new Set<string>();
    for (const entity of dataSource.entities.values) {
      const props = entityProperties(entity);
      if (String(props.oceanBrainKind || '') !== 'aircraft') continue;
      const key = String(props.iconKind || 'airliner');
      const show = filter === 'all' || key === filter;
      entity.show = show;
      if (show) visibleTargets.add(String(entity.id));
    }
    for (const entity of dataSource.entities.values) {
      if (!String(entity.id).endsWith(':vector')) continue;
      entity.show = visibleTargets.has(String(entity.id).replace(/:vector$/, ''));
    }
    viewer.scene.requestRender?.();
  };
  const refresh = async (): Promise<LiveFeedStatus> => {
    if (!enabled) return status;
    try {
      const response = await fetch('/api/opensky', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Aircraft HTTP ${response.status}`);
      const payload = await response.json();
      const states = Array.isArray(payload?.states) ? payload.states : [];
      const sourceName = (response.headers.get('x-flight-source') || 'LIVE ADS-B').split('·')[0].trim();
      const source = new Cesium.CustomDataSource('ocean-brain-aircraft');
      const showLabels = states.length <= 80;
      let count = 0;

      for (const state of states.slice(0, 700)) {
        if (!Array.isArray(state)) continue;
        const longitude = Number(state[5]);
        const latitude = Number(state[6]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        const altitude = Math.max(500, Number(state[13] ?? state[7] ?? 9500) || 9500);
        const altitudeFt = altitude / 0.3048;
        const course = Number(state[10]);
        const speedKt = Number.isFinite(Number(state[9])) ? Number(state[9]) / 0.514444 : null;
        const callsign = String(state[1] || state[0] || 'AIR').trim();
        const typeCode = String(state[18] || '').trim().toUpperCase();
        const registration = String(state[19] || '').trim().toUpperCase();
        const operator = String(state[20] || '').trim();
        const description = String(state[22] || '').trim();
        const classification = aircraftClass(typeCode, description, operator);
        const model = aircraftModel(typeCode, description);
        const colorHex = classification.key === 'cargo' ? '#ff9866' : classification.key === 'helicopter' ? '#ffdf7a' : classification.key === 'bizjet' ? '#d4a7ff' : '#ffbd66';
        const color = Cesium.Color.fromCssColorString(colorHex);
        const pointPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
        const entity = source.entities.add({
          id: `aircraft:${String(state[0] || callsign)}:${count}`,
          position: pointPosition,
          billboard: {
            image: svgDataUrl(classification.key, colorHex),
            width: classification.key === 'helicopter' ? 26 : 28,
            height: classification.key === 'helicopter' ? 26 : 28,
            rotation: Number.isFinite(course) ? Cesium.Math.toRadians(-course) : 0,
            alignedAxis: Cesium.Cartesian3.ZERO,
            color: Cesium.Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(15_000, 1.25, 800_000, 0.55),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 700_000),
          },
          label: showLabels ? {
            text: `${callsign}${typeCode ? ` · ${typeCode}` : ''}`,
            font: '700 10px ui-monospace, SFMono-Regular, Menlo, monospace',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#14120d').withAlpha(0.78),
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 190_000),
            scaleByDistance: new Cesium.NearFarScalar(15_000, 1, 190_000, 0.55),
          } : undefined,
          properties: {
            oceanBrainKind: 'aircraft', iconKind: classification.key, className: classification.label,
            callsign, model, typeCode, registration, operator,
            altitudeFt, speedKt: speedKt ?? '', headingDeg: Number.isFinite(course) ? course : '',
          },
        });
        if (Number.isFinite(course)) {
          const end = destinationOffset(longitude, latitude, course, 0.055);
          source.entities.add({
            id: `${entity.id}:vector`,
            polyline: {
              positions: [pointPosition, Cesium.Cartesian3.fromDegrees(end.longitude, end.latitude, altitude)],
              width: 1.25,
              material: color.withAlpha(0.36),
              arcType: Cesium.ArcType.NONE,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 220_000),
            },
          });
        }
        count++;
      }

      remove(); dataSource = source; await viewer.dataSources.add(source); applyFilter();
      status = count > 0 ? { state: 'live', text: `${count} AIRCRAFT · ${sourceName}`, count } : { state: 'empty', text: '0 AIRCRAFT · REGIONAL', count: 0 };
      viewer.scene.requestRender?.();
    } catch (error) {
      status = { state: 'error', text: shortFeedError(error), error: String(error) };
    } finally { schedule(); }
    return status;
  };

  return {
    async enable() { enabled = true; status = { state: 'loading', text: 'SCANNING AIRSPACE…' }; return refresh(); },
    async disable() { enabled = false; clearTimer(); remove(); status = { state: 'off', text: 'Regional live air traffic' }; viewer.scene.requestRender?.(); },
    setVisible(visible: boolean) { if (dataSource) dataSource.show = visible; viewer.scene.requestRender?.(); },
    raiseToTop() { if (dataSource) viewer.dataSources.raiseToTop?.(dataSource); viewer.scene.requestRender?.(); },
    setFilter(next: string) { filter = next || 'all'; applyFilter(); },
    getStatus: () => status,
  };
}

function createVesselController(viewer: any): CustomLayerController {
  let dataSource: any = null;
  let timer: number | null = null;
  let enabled = false;
  let filter = 'all';
  let status: LiveFeedStatus = { state: 'off', text: 'AIS vessel traffic' };
  const clearTimer = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
  const remove = () => { if (dataSource) viewer.dataSources.remove(dataSource, true); dataSource = null; };
  const schedule = () => { clearTimer(); if (enabled) timer = window.setTimeout(() => { void refresh(); }, 18_000); };
  const applyFilter = () => {
    if (!dataSource) return;
    const visibleTargets = new Set<string>();
    for (const entity of dataSource.entities.values) {
      const props = entityProperties(entity);
      if (String(props.oceanBrainKind || '') !== 'vessel') continue;
      const key = String(props.iconKind || 'vessel');
      const yachtGroup = ['yacht','megayacht','sailboat'].includes(key);
      const show = filter === 'all' || key === filter || (filter === 'yachts' && yachtGroup);
      entity.show = show;
      if (show) visibleTargets.add(String(entity.id));
    }
    for (const entity of dataSource.entities.values) {
      if (!String(entity.id).endsWith(':vector')) continue;
      entity.show = visibleTargets.has(String(entity.id).replace(/:vector$/, ''));
    }
    viewer.scene.requestRender?.();
  };
  const refresh = async (): Promise<LiveFeedStatus> => {
    if (!enabled) return status;
    try {
      const response = await fetch('/api/ais-live?maxRows=1500', { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = payload?.status === 'missing-key' ? 'AIS KEY REQUIRED' : payload?.status === 'auth-failed' ? 'AIS AUTH FAILED' : `AIS HTTP ${response.status}`;
        throw new Error(reason);
      }
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const transport = String(payload?.status || '').toLowerCase();
      if (!rows.length && ['error', 'closed', 'degraded', 'auth-failed', 'missing-key'].includes(transport)) throw new Error(transport === 'missing-key' ? 'AIS KEY REQUIRED' : 'AIS FEED OFFLINE');

      const source = new Cesium.CustomDataSource('ocean-brain-vessels');
      const showLabels = rows.length <= 85;
      let count = 0;
      for (const row of rows.slice(0, 1500)) {
        const longitude = Number(row?.lon ?? row?.longitude);
        const latitude = Number(row?.lat ?? row?.latitude);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        const heading = Number.isFinite(Number(row?.heading)) ? Number(row.heading) : Number(row?.course ?? row?.cog);
        const name = String(row?.name || row?.input_name || row?.mmsi || 'VESSEL').trim();
        const mmsi = String(row?.mmsi || '').trim();
        const speedKt = numberFrom(row, ['speed','sog','speedKn','speed_kn','speedOverGround']);
        const destination = textFrom(row, ['destination','dest']);
        const classification = vesselClass(row);
        const colorHex = classification.key === 'cargoShip' ? '#71d6ff' : classification.key === 'tanker' ? '#ff8f80' : classification.key === 'fishing' ? '#90ffcf' : classification.key === 'megayacht' || classification.key === 'yacht' ? '#f0dcff' : '#4fffc0';
        const color = Cesium.Color.fromCssColorString(colorHex);
        const pointPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, 80);
        const entity = source.entities.add({
          id: `vessel:${mmsi || name}:${count}`,
          position: pointPosition,
          billboard: {
            image: svgDataUrl(classification.key, colorHex),
            width: classification.key === 'sailboat' ? 25 : 30,
            height: classification.key === 'sailboat' ? 30 : 24,
            rotation: Number.isFinite(heading) ? Cesium.Math.toRadians(-heading) : 0,
            color: Cesium.Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(5_000, 1.3, 450_000, 0.58),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 420_000),
          },
          label: showLabels ? {
            text: `${name.slice(0, 18)} · ${classification.label}`,
            font: '700 10px ui-monospace, SFMono-Regular, Menlo, monospace',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#071713').withAlpha(0.76),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 120_000),
            scaleByDistance: new Cesium.NearFarScalar(5_000, 1, 120_000, 0.5),
          } : undefined,
          properties: {
            oceanBrainKind: 'vessel', iconKind: classification.key, className: classification.label,
            name, mmsi, lengthM: classification.length ?? '', speedKt: speedKt ?? '',
            headingDeg: Number.isFinite(heading) ? heading : '', destination,
          },
        });
        if (Number.isFinite(heading)) {
          const end = destinationOffset(longitude, latitude, heading, 0.025);
          source.entities.add({ id: `${entity.id}:vector`, polyline: { positions: [pointPosition, Cesium.Cartesian3.fromDegrees(end.longitude, end.latitude, 80)], width: 1.45, material: color.withAlpha(0.4), arcType: Cesium.ArcType.NONE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150_000) } });
        }
        count++;
      }
      remove(); dataSource = source; await viewer.dataSources.add(source); applyFilter();
      status = count > 0 ? { state: 'live', text: `${count} VESSEL${count === 1 ? '' : 'S'} · AIS`, count } : transport === 'connecting' || payload?.refreshing ? { state: 'loading', text: 'AIS CONNECTING…', count: 0 } : { state: 'empty', text: '0 VESSELS · AIS', count: 0 };
      viewer.scene.requestRender?.();
    } catch (error) { status = { state: 'error', text: shortFeedError(error), error: String(error) }; }
    finally { schedule(); }
    return status;
  };
  return {
    async enable() { enabled = true; status = { state: 'loading', text: 'CONNECTING AIS…' }; return refresh(); },
    async disable() { enabled = false; clearTimer(); remove(); status = { state: 'off', text: 'AIS vessel traffic' }; viewer.scene.requestRender?.(); },
    setVisible(visible: boolean) { if (dataSource) dataSource.show = visible; viewer.scene.requestRender?.(); },
    raiseToTop() { if (dataSource) viewer.dataSources.raiseToTop?.(dataSource); viewer.scene.requestRender?.(); },
    setFilter(next: string) { filter = next || 'all'; applyFilter(); },
    getStatus: () => status,
  };
}

function createCycloneController(viewer: any): CustomLayerController {
  let dataSource: any = null;
  let status: LiveFeedStatus = { state: 'off', text: 'Atlantic tropical systems' };
  const remove = () => {
    if (dataSource) viewer.dataSources.remove(dataSource, true);
    dataSource = null;
  };
  return {
    async enable() {
      status = { state: 'loading', text: 'CHECKING NHC…' };
      remove();
      try {
        const response = await fetch('/api/cyclones', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Cyclone HTTP ${response.status}`);
        const payload = await response.json();
        const storms = Array.isArray(payload?.storms) ? payload.storms : [];
        const source = new Cesium.CustomDataSource('ocean-brain-cyclones');
        const color = Cesium.Color.fromCssColorString('#ff7f9d');
        for (const storm of storms) {
          const longitude = Number(storm?.longitude);
          const latitude = Number(storm?.latitude);
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
          const label = `${String(storm.name || 'STORM').toUpperCase()} · ${String(storm.classification || '')} ${Number(storm.windKt || 0)} KT`;
          source.entities.add({
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 1500),
            point: {
              pixelSize: 13,
              color,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.75),
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: label,
              font: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#241018').withAlpha(0.8),
              pixelOffset: new Cesium.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
        dataSource = source;
        await viewer.dataSources.add(source);
        status = storms.length
          ? { state: 'live', text: storms.length === 1
              ? `${String(storms[0].name).toUpperCase()} · ${storms[0].classification} · ${storms[0].windKt} KT`
              : `${storms.length} ATLANTIC STORMS`, count: storms.length }
          : { state: 'empty', text: 'NO ACTIVE ATLANTIC STORMS', count: 0 };
        viewer.scene.requestRender?.();
        return status;
      } catch (error) {
        status = { state: 'error', text: shortFeedError(error), error: String(error) };
        return status;
      }
    },
    async disable() {
      remove();
      status = { state: 'off', text: 'Atlantic tropical systems' };
      viewer.scene.requestRender?.();
    },
    setVisible(visible: boolean) { if (dataSource) dataSource.show = visible; viewer.scene.requestRender?.(); },
    raiseToTop() { if (dataSource) viewer.dataSources.raiseToTop?.(dataSource); viewer.scene.requestRender?.(); },
    getStatus: () => status,
  };
}

function createRadarController(viewer: any, tileset: any): CustomLayerController {
  let layer: any = null;
  let manifest: any = null;
  let timeOffset = 0;
  let status: LiveFeedStatus = { state: 'off', text: 'Precipitation radar' };
  const collection = layerImageryCollection(viewer, tileset);
  const remove = () => {
    if (layer && collection?.contains?.(layer)) collection.remove(layer, true);
    else if (layer && !layer.isDestroyed?.()) layer.destroy?.();
    layer = null;
  };
  const renderFrame = () => {
    if (!manifest?.host) return;
    const frames = Array.isArray(manifest.frames) && manifest.frames.length ? manifest.frames : [{ path: manifest.path, time: manifest.time }];
    const index = Math.max(0, Math.min(frames.length - 1, frames.length - 1 - Math.max(0, timeOffset)));
    const frame = frames[index];
    if (!frame?.path || !frame?.time) return;
    const oldAlpha = layer?.alpha ?? 0.62;
    const oldShow = layer?.show ?? true;
    remove();
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `${manifest.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      rectangle: Cesium.Rectangle.fromDegrees(-72, 24, -56, 42),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 7,
      enablePickFeatures: false,
      credit: new Cesium.Credit('Weather radar · RainViewer', false),
    });
    provider.errorEvent?.addEventListener?.((event: any) => {
      status = { state: 'error', text: shortFeedError(event?.error || event) };
    });
    layer = new Cesium.ImageryLayer(provider, { alpha: oldAlpha, show: oldShow });
    layer.brightness = 1.08;
    layer.contrast = 1.18;
    layer.saturation = 1.12;
    collection.add(layer);
    const stamp = new Date(frame.time).toISOString().slice(11, 16) + 'Z';
    status = { state: 'live', text: `${timeOffset ? `RADAR -${timeOffset * 10}M` : 'RADAR LIVE'} · ${stamp}` };
    viewer.scene.requestRender?.();
  };
  return {
    async enable() {
      status = { state: 'loading', text: 'CONNECTING RADAR…' };
      remove();
      try {
        const response = await fetch('/api/radar-manifest', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Radar HTTP ${response.status}`);
        manifest = await response.json();
        if (!manifest?.host || !manifest?.path || !manifest?.time) throw new Error('Radar manifest unavailable');
        renderFrame();
        return status;
      } catch (error) {
        remove();
        status = { state: 'error', text: shortFeedError(error), error: String(error) };
        return status;
      }
    },
    async disable() {
      remove();
      manifest = null;
      timeOffset = 0;
      status = { state: 'off', text: 'Precipitation radar' };
      viewer.scene.requestRender?.();
    },
    setVisible(visible: boolean) { if (layer) layer.show = visible; viewer.scene.requestRender?.(); },
    setOpacity(opacity: number) { if (layer) layer.alpha = Math.max(0.05, Math.min(1, opacity)); viewer.scene.requestRender?.(); },
    raiseToTop() { if (layer && collection?.contains?.(layer)) collection.raiseToTop?.(layer); viewer.scene.requestRender?.(); },
    setTimeOffset(offset: number) { timeOffset = Math.max(0, Math.min(7, Math.round(Number(offset) || 0))); if (manifest) renderFrame(); },
    getStatus: () => status,
  };
}

function createWmsController(
  viewer: any,
  tileset: any,
  kind: 'clouds' | 'lightning',
): CustomLayerController {
  let layer: any = null;
  let status: LiveFeedStatus = {
    state: 'off',
    text: kind === 'clouds' ? 'Satellite cloud field' : 'Lightning activity',
  };
  const collection = layerImageryCollection(viewer, tileset);
  const remove = () => {
    if (layer && collection?.contains?.(layer)) collection.remove(layer, true);
    else if (layer && !layer.isDestroyed?.()) layer.destroy?.();
    layer = null;
  };
  return {
    async enable() {
      status = { state: 'loading', text: kind === 'clouds' ? 'CONNECTING GOES…' : 'CONNECTING LIGHTNING…' };
      remove();
      try {
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: `/api/weather-wms?kind=${kind}`,
          layers: 'ocean-brain',
          rectangle: Cesium.Rectangle.fromDegrees(-105, 5, -20, 62),
          enablePickFeatures: false,
          maximumLevel: 6,
          parameters: {
            transparent: true,
            format: 'image/png',
            version: '1.3.0',
          },
          credit: new Cesium.Credit(kind === 'clouds' ? 'NOAA nowCOAST · GOES' : 'NOAA nowCOAST · lightning', false),
        });
        provider.errorEvent?.addEventListener?.((event: any) => {
          status = { state: 'error', text: shortFeedError(event?.error || event) };
        });
        layer = new Cesium.ImageryLayer(provider, { alpha: kind === 'clouds' ? 0.16 : 0.72, show: true });
        if (kind === 'clouds') {
          layer.brightness = 1.12;
          layer.contrast = 1.32;
          layer.saturation = 0.18;
          layer.gamma = 0.9;
        } else {
          layer.brightness = 1.18;
          layer.contrast = 1.18;
          layer.saturation = 1.2;
        }
        collection.add(layer);
        status = { state: 'live', text: kind === 'clouds' ? 'GOES CLOUDS · LIVE' : 'LIGHTNING · LIVE' };
        viewer.scene.requestRender?.();
        return status;
      } catch (error) {
        remove();
        status = { state: 'error', text: shortFeedError(error), error: String(error) };
        return status;
      }
    },
    async disable() {
      remove();
      status = { state: 'off', text: kind === 'clouds' ? 'Satellite cloud field' : 'Lightning activity' };
      viewer.scene.requestRender?.();
    },
    setVisible(visible: boolean) { if (layer) layer.show = visible; viewer.scene.requestRender?.(); },
    setOpacity(opacity: number) { if (layer) layer.alpha = Math.max(0.05, Math.min(1, opacity)); viewer.scene.requestRender?.(); },
    raiseToTop() { if (layer && collection?.contains?.(layer)) collection.raiseToTop?.(layer); viewer.scene.requestRender?.(); },
    getStatus: () => status,
  };
}

function destinationOffset(lon: number, lat: number, bearingDeg: number, distanceDeg: number) {
  const bearing = Cesium.Math.toRadians(bearingDeg);
  const latOffset = Math.cos(bearing) * distanceDeg;
  const lonOffset = Math.sin(bearing) * distanceDeg / Math.max(0.3, Math.cos(Cesium.Math.toRadians(lat)));
  return { longitude: lon + lonOffset, latitude: lat + latOffset };
}

function createWindController(viewer: any): CustomLayerController {
  let dataSource: any = null;
  let status: LiveFeedStatus = { state: 'off', text: 'Atmospheric flow' };
  const remove = () => {
    if (dataSource) viewer.dataSources.remove(dataSource, true);
    dataSource = null;
  };
  return {
    async enable() {
      status = { state: 'loading', text: 'SAMPLING WIND…' };
      remove();
      try {
        const response = await fetch('/api/telemetry', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Wind HTTP ${response.status}`);
        const payload = await response.json();
        const speedRaw = payload?.weather?.windKn;
        const directionRaw = payload?.weather?.windDirectionDeg;
        const speed = speedRaw === null || speedRaw === undefined ? NaN : Number(speedRaw);
        const direction = directionRaw === null || directionRaw === undefined ? NaN : Number(directionRaw);
        if (!Number.isFinite(speed) || !Number.isFinite(direction)) throw new Error('Wind direction unavailable');
        const flowBearing = (direction + 180) % 360;
        const length = Math.max(0.035, Math.min(0.095, 0.035 + speed * 0.0022));
        const color = Cesium.Color.fromCssColorString('#66b9ff').withAlpha(0.55);
        const source = new Cesium.CustomDataSource('ocean-brain-wind');
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 5; col++) {
            const latitude = 31.98 + row * 0.20 + (col % 2) * 0.035;
            const longitude = -65.18 + col * 0.245;
            const end = destinationOffset(longitude, latitude, flowBearing, length);
            source.entities.add({
              polyline: {
                positions: [
                  Cesium.Cartesian3.fromDegrees(longitude, latitude, 1000),
                  Cesium.Cartesian3.fromDegrees(end.longitude, end.latitude, 1000),
                ],
                width: 1.75,
                material: new Cesium.PolylineArrowMaterialProperty(color),
                arcType: Cesium.ArcType.NONE,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 125_000),
              },
            });
          }
        }
        dataSource = source;
        await viewer.dataSources.add(source);
        status = { state: 'live', text: `${Math.round(speed)} KT · ${Math.round(direction)}°` };
        viewer.scene.requestRender?.();
        return status;
      } catch (error) {
        remove();
        status = { state: 'error', text: shortFeedError(error), error: String(error) };
        return status;
      }
    },
    async disable() {
      remove();
      status = { state: 'off', text: 'Atmospheric flow' };
      viewer.scene.requestRender?.();
    },
    setVisible(visible: boolean) { if (dataSource) dataSource.show = visible; viewer.scene.requestRender?.(); },
    raiseToTop() { if (dataSource) viewer.dataSources.raiseToTop?.(dataSource); viewer.scene.requestRender?.(); },
    getStatus: () => status,
  };
}

function createCustomLiveControllers(viewer: any, tileset: any) {
  return new Map<string, CustomLayerController>([
    ['vessels', createVesselController(viewer)],
    ['flights', createAircraftController(viewer)],
    ['weather-radar', createRadarController(viewer, tileset)],
    ['wind', createWindController(viewer)],
    ['weather-satellite', createWmsController(viewer, tileset, 'clouds')],
    ['weather-lightning', createWmsController(viewer, tileset, 'lightning')],
    ['weather-cyclones', createCycloneController(viewer)],
  ]);
}

function nativeLayerStatus(dataManager: any, id: string): LiveFeedStatus {
  const entry = dataManager?.layers?.get?.(id);
  if (!entry?.enabled) return { state: 'off', text: '' };
  let stats: any = {};
  try {
    stats = entry.module?.getStats?.() || {};
  } catch (error) {
    return { state: 'error', text: shortFeedError(error), error: String(error) };
  }
  const error = stats.error || stats.lastError || stats.managerRefreshError;
  if (error) return { state: 'error', text: shortFeedError(error), error: String(error) };
  if (stats.loading || stats.refreshing || stats.firstConnectPhase === 'loading')
    return { state: 'loading', text: 'CONNECTING…' };
  const rawCount = stats.count ?? stats.acceptedRowCount ?? stats.visibleCount ?? stats.renderedCount ?? 0;
  const count = Number.isFinite(Number(rawCount)) ? Number(rawCount) : 0;
  if (count > 0) return { state: 'live', text: `${count} CONTACT${count === 1 ? '' : 'S'} · LIVE`, count };
  if (id === 'weather-cyclones' && stats.lastUpdate) return { state: 'live', text: 'NO ACTIVE STORMS', count: 0 };
  if (stats.lastUpdate || stats.fetchedAt || stats.source) return { state: 'empty', text: '0 CONTACTS · LIVE', count: 0 };
  return { state: 'loading', text: 'WAITING FOR DATA…', count: 0 };
}

function oceanLayerStatus(dataManager: any, id: string): LiveFeedStatus {
  const entry = dataManager?.layers?.get?.(id);
  if (!entry?.enabled) return { state: 'off', text: '' };
  let stats: any = {};
  try { stats = entry.module?.getStats?.() || {}; }
  catch (error) { return { state: 'error', text: shortFeedError(error), error: String(error) }; }
  const error = stats.error || stats.lastError;
  if (error) return { state: 'error', text: shortFeedError(error), error: String(error) };
  const count = Number(stats.count || 0);
  if (Number.isFinite(count) && count > 0) return { state: 'live', text: `${count} FEATURES · TAP MAP`, count };
  if (stats.lastUpdate) return { state: 'live', text: 'LAYER LIVE · TAP MAP', count: 0 };
  return { state: 'loading', text: 'LOADING OCEAN DATA…', count: 0 };
}

function formatCameraAltitude(viewer: any) {
  const altitudeKm = Math.max(0, Number(viewer.camera?.positionCartographic?.height || 0) / 1000);
  if (altitudeKm >= 100) return `${Math.round(altitudeKm)} KM`;
  if (altitudeKm >= 10) return `${altitudeKm.toFixed(1)} KM`;
  return `${altitudeKm.toFixed(2)} KM`;
}

async function refreshTelemetry(shell: HTMLElement) {
  const setText = (selector: string, text: string) => {
    const element = shell.querySelector<HTMLElement>(selector);
    if (element) element.textContent = text;
  };
  try {
    const response = await fetch('/api/telemetry', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`telemetry ${response.status}`);
    const telemetry = await response.json() as TelemetryPayload;
    const power = telemetry.power?.estimatedMW;
    const temp = telemetry.weather?.temperatureC;
    const wind = telemetry.weather?.windKn;
    const humidity = telemetry.weather?.humidityPct;
    const precipitation = telemetry.weather?.precipitationMm;
    const condition = telemetry.weather?.condition || 'LIVE';

    setText('.ob-rail-power-value', Number.isFinite(power) ? `${Number(power).toFixed(1)} MW` : '-- MW');
    setText('.ob-rail-weather-value', Number.isFinite(temp) ? `${Math.round(Number(temp))}°C` : '--°C');
    setText('.ob-intel-power-value', Number.isFinite(power) ? `${Number(power).toFixed(1)}` : '--');
    setText('.ob-intel-weather-temp', Number.isFinite(temp) ? `${Math.round(Number(temp))}°C` : '--°C');
    setText('.ob-intel-weather-wind', Number.isFinite(wind) ? `${Math.round(Number(wind))} KT` : '-- KT');
    setText('.ob-intel-weather-humidity', Number.isFinite(humidity) ? `${Math.round(Number(humidity))}%` : '--%');
    setText('.ob-intel-weather-rain', Number.isFinite(precipitation) ? `${Number(precipitation).toFixed(1)} MM` : '--');
    setText('.ob-intel-weather-condition', condition.toUpperCase());
    const meter = shell.querySelector<HTMLElement>('.ob-power-meter i');
    if (meter && Number.isFinite(power)) {
      const pct = Math.max(8, Math.min(100, ((Number(power) - 45) / 45) * 100));
      meter.style.width = `${pct.toFixed(0)}%`;
    }
  } catch (error) {
    console.warn('[Ocean Brain telemetry]', error);
    setText('.ob-rail-power-value', 'MODEL --');
    setText('.ob-rail-weather-value', 'WX --');
  }
}

function installMobileExperience(components: any, mapState: { tileset: any | null; errorCode: string | null }) {
  if (!window.matchMedia('(max-width: 720px)').matches) return null;

  const photoreal3D = Boolean(mapState.tileset);
  const mapSourceLabel = photoreal3D
    ? (GOOGLE_MAPS_API_KEY ? 'GOOGLE PHOTOREALISTIC 3D' : 'GOOGLE 3D · CESIUM ION')
    : mapState.errorCode
      ? `3D ERROR · ${mapState.errorCode}`
      : 'ESRI SATELLITE FALLBACK';

  document.documentElement.classList.add('ocean-brain-mobile');
  const shell = document.createElement('div');
  shell.className = 'ob-mobile-shell';
  shell.innerHTML = `
    <div class="ob-mobile-header">
      <div class="ob-mobile-brand">
        <img src="./logo.svg" alt="" />
        <div>
          <strong>BERMUDA OCEAN BRAIN</strong>
          <span>PLANETARY ISLAND INTELLIGENCE</span>
        </div>
      </div>
      <div class="ob-mobile-mode">${photoreal3D ? '3D' : mapState.errorCode ? '3D!' : 'SAT'}</div>
    </div>

    <div class="ob-signal-rail" aria-label="Mission telemetry">
      <button class="ob-rail-card ob-intel-open" type="button">
        <span>GRID · EST</span><strong class="ob-rail-power-value">-- MW</strong>
      </button>
      <button class="ob-rail-card ob-intel-open" type="button">
        <span>WEATHER</span><strong class="ob-rail-weather-value">--°C</strong>
      </button>
      <button class="ob-rail-card ob-center-button" type="button">
        <span>CAM ALT</span><strong class="ob-rail-alt-value">-- KM</strong>
      </button>
    </div>

    <div class="ob-reticle" aria-hidden="true"><i></i><b></b></div>
    <button class="ob-sheet-scrim" type="button" aria-label="Close intelligence panel"></button>

    <section class="ob-layer-sheet" aria-label="Mission layers">
      <div class="ob-sheet-handle"></div>
      <div class="ob-sheet-heading">
        <div>
          <span class="ob-kicker">MISSION LAYERS</span>
          <strong>Bermuda Spatial Stack</strong>
          <small>Live signals + environmental intelligence</small>
        </div>
        <button class="ob-sheet-close" type="button" aria-label="Close">×</button>
      </div>

      <div class="ob-layer-section ob-grouped-layers">
        <div class="ob-section-label"><span>SPATIAL DATA</span><em>LIVE + GIS</em></div>
        ${renderGroupedMissionLayers()}
      </div>

      <div class="ob-layer-section ob-geolibre-tools-section">
        <div class="ob-section-label"><span>MAP TOOLS</span><em>GEOLIBRE CORE</em></div>
        <div class="ob-tool-row">
          <button type="button" class="ob-map-tool" data-tool="identify">IDENTIFY</button>
          <button type="button" class="ob-map-tool" data-tool="measure">MEASURE</button>
          <button type="button" class="ob-map-tool" data-tool="range">5 NM RING</button>
          <button type="button" class="ob-map-tool" data-tool="clear">CLEAR</button>
        </div>
        <div class="ob-tool-status">Tap any visible feature to identify across all layers.</div>
        <div class="ob-quick-filters">
          <label><span>AIRCRAFT</span><select data-entity-filter="flights"><option value="all">ALL</option><option value="airliner">AIRLINER</option><option value="cargo">CARGO</option><option value="bizjet">BUSINESS JET</option><option value="prop">PROP</option><option value="helicopter">HELICOPTER</option></select></label>
          <label><span>VESSELS</span><select data-entity-filter="vessels"><option value="all">ALL</option><option value="yachts">YACHTS / SAIL</option><option value="cargoShip">CARGO</option><option value="tanker">TANKER</option><option value="fishing">FISHING</option><option value="tug">TUG</option><option value="ferry">PASSENGER</option></select></label>
          <label><span>RADAR TIME</span><select data-radar-time><option value="0">NOW</option><option value="1">-10 MIN</option><option value="2">-20 MIN</option><option value="3">-30 MIN</option><option value="4">-40 MIN</option></select></label>
        </div>
      </div>

      <div class="ob-layer-section ob-geolibre-stack-section">
        <div class="ob-section-label"><span>ACTIVE LAYER STACK</span><em>GEOLIBRE</em></div>
        <div class="ob-geolibre-stack"><div class="ob-stack-empty">Activate a layer to manage visibility, opacity and order.</div></div>
      </div>

      <div class="ob-layer-section ob-legend-section">
        <div class="ob-section-label"><span>LEGEND</span><em>AUTO</em></div>
        <div class="ob-live-legend"><span class="ob-stack-empty">Activate layers to build legend.</span></div>
      </div>

      <div class="ob-layer-section ob-attribute-preview" hidden>
        <div class="ob-section-label"><span class="ob-attribute-title">ATTRIBUTE TABLE</span><button type="button" class="ob-attribute-close">CLOSE</button></div>
        <div class="ob-attribute-summary"></div>
        <div class="ob-attribute-scroll"><table><thead></thead><tbody></tbody></table></div>
      </div>

      <div class="ob-sheet-footer">
        <span>${mapSourceLabel}</span>
        <span class="ob-active-count">0 ACTIVE</span>
        <button class="ob-clear-layers" type="button">CLEAR</button>
      </div>
    </section>

    <section class="ob-intel-sheet" aria-label="Bermuda intelligence dashboard">
      <div class="ob-sheet-handle"></div>
      <div class="ob-sheet-heading">
        <div>
          <span class="ob-kicker">BERMUDA // MISSION CONTROL</span>
          <strong>Island Systems</strong>
          <small>Infrastructure, atmosphere and scene state</small>
        </div>
        <button class="ob-sheet-close" type="button" aria-label="Close">×</button>
      </div>

      <div class="ob-intel-grid">
        <article class="ob-intel-card ob-intel-card-power">
          <div class="ob-card-top"><span>POWER GRID</span><em>MODEL</em></div>
          <div class="ob-power-readout"><strong class="ob-intel-power-value">--</strong><span>MW</span></div>
          <div class="ob-power-meter"><i></i></div>
          <p>Estimated island demand · IRP reference model. Not live BELCO telemetry.</p>
        </article>

        <article class="ob-intel-card">
          <div class="ob-card-top"><span>ATMOSPHERE</span><em>LIVE</em></div>
          <div class="ob-weather-primary"><strong class="ob-intel-weather-temp">--°C</strong><span class="ob-intel-weather-condition">LIVE</span></div>
          <div class="ob-mini-stats">
            <span><small>WIND</small><b class="ob-intel-weather-wind">-- KT</b></span>
            <span><small>HUMIDITY</small><b class="ob-intel-weather-humidity">--%</b></span>
            <span><small>RAIN</small><b class="ob-intel-weather-rain">--</b></span>
          </div>
        </article>

        <article class="ob-intel-card">
          <div class="ob-card-top"><span>SCENE</span><em>${photoreal3D ? 'NOMINAL' : 'DEGRADED'}</em></div>
          <div class="ob-mini-stats ob-scene-stats">
            <span><small>MAP</small><b>${photoreal3D ? '3D' : 'SAT'}</b></span>
            <span><small>ALT</small><b class="ob-intel-alt-value">-- KM</b></span>
            <span><small>LAYERS</small><b class="ob-intel-active-value">0</b></span>
          </div>
          <p>${mapSourceLabel}</p>
        </article>
      </div>
    </section>

    <section class="ob-entity-inspector" aria-label="Feature intelligence">
      <div class="ob-sheet-handle"></div>
      <div class="ob-entity-head">
        <div class="ob-entity-icon"><img alt="" /></div>
        <div class="ob-entity-head-copy"><span class="ob-entity-class">TARGET</span><strong class="ob-entity-title">ENTITY</strong><small class="ob-identify-counter">IDENTIFIED FEATURE</small></div>
        <button class="ob-entity-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="ob-identify-switcher"></div>
      <div class="ob-entity-grid"></div>
    </section>

    <nav class="ob-mobile-dock" aria-label="Ocean Brain controls">
      <button class="ob-dock-button ob-layers-button" type="button">
        <span class="ob-dock-icon">≋</span><span>Layers</span>
      </button>
      <button class="ob-dock-button ob-center-button" type="button">
        <span class="ob-dock-icon">⌖</span><span>Focus</span>
      </button>
      <button class="ob-dock-button ob-intel-button" type="button">
        <span class="ob-dock-icon">⌁</span><span>Intel</span>
      </button>
      <div class="ob-live-pill"><i></i><span>LIVE</span></div>
    </nav>
  `;
  document.body.appendChild(shell);

  const viewer = components.scene.viewer;
  const dataManager = components.data.dataManager;
  const customLiveControllers = createCustomLiveControllers(viewer, mapState.tileset);
  const geoLibreStack = new GeoLibreLayerStack();
  for (const definition of MOBILE_LAYER_DEFINITIONS) {
    const custom = customLiveControllers.get(definition.id);
    const nativeModule = dataManager?.layers?.get?.(definition.id)?.module;
    geoLibreStack.register({
      id: definition.id,
      title: definition.label,
      category: definition.category,
      color: definition.color,
      supportsOpacity: Boolean(custom?.setOpacity || nativeModule?.setOpacity),
      setVisible: (visible: boolean) => custom?.setVisible?.(visible) ?? nativeModule?.setVisible?.(visible),
      setOpacity: (opacity: number) => custom?.setOpacity?.(opacity) ?? nativeModule?.setOpacity?.(opacity),
      raiseToTop: () => custom?.raiseToTop?.() ?? nativeModule?.raiseToTop?.(),
      setStyleStrength: nativeModule?.setStyleStrength ? (strength: number) => nativeModule.setStyleStrength(strength) : undefined,
    });
  }
  const entityInspectorHandler = installEntityInspector(viewer, shell);
  const layerButtons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.ob-layer-toggle'));
  void entityInspectorHandler;
  const stackRoot = shell.querySelector<HTMLElement>('.ob-geolibre-stack');
  const attributePanel = shell.querySelector<HTMLElement>('.ob-attribute-preview');
  shell.querySelector<HTMLButtonElement>('.ob-attribute-close')?.addEventListener('click', () => { if (attributePanel) attributePanel.hidden = true; });
  const openAttributePreview = (id: string, title: string) => {
    if (!attributePanel) return;
    const module = dataManager?.layers?.get?.(id)?.module;
    const source = module?.getRenderHandle?.();
    const entities = Array.isArray(source?.entities?.values) ? source.entities.values : [];
    const rows = entities.slice(0, 30).map((entity: any) => entityProperties(entity)).filter((props: any) => Object.keys(props).length);
    const ignored = new Set(['oceanBrainLayerId','oceanBrainLayerName','oceanBrainIconKind']);
    const fieldCounts = new Map<string, number>();
    for (const row of rows) for (const [key, value] of Object.entries(row)) if (!ignored.has(key) && compactValue(value)) fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
    const fields = Array.from(fieldCounts.entries()).sort((a,b) => b[1]-a[1]).slice(0, 4).map(([key]) => key);
    const stats = module?.getStats?.() || {};
    const titleNode = attributePanel.querySelector<HTMLElement>('.ob-attribute-title');
    const summary = attributePanel.querySelector<HTMLElement>('.ob-attribute-summary');
    const thead = attributePanel.querySelector<HTMLElement>('thead');
    const tbody = attributePanel.querySelector<HTMLElement>('tbody');
    if (titleNode) titleNode.textContent = `${title.toUpperCase()} · ATTRIBUTES`;
    if (summary) summary.textContent = `${Number(stats.count || entities.length).toLocaleString()} FEATURES · SHOWING ${Math.min(rows.length, 30)} SAMPLE RECORDS`;
    if (thead) thead.innerHTML = `<tr>${fields.map((field) => `<th>${field.replace(/_/g,' ').toUpperCase()}</th>`).join('')}</tr>`;
    if (tbody) tbody.innerHTML = rows.slice(0, 12).map((row: any) => `<tr>${fields.map((field) => `<td>${compactValue(row[field]).replace(/[<>]/g,'')}</td>`).join('')}</tr>`).join('') || '<tr><td>NO ATTRIBUTES AVAILABLE</td></tr>';
    attributePanel.hidden = false;
  };
  const renderGeoLibreStack = (entries: readonly GeoLibreStackEntry[]) => {
    if (!stackRoot) return;
    const active = entries.filter((entry) => entry.active);
    const legendRoot = shell.querySelector<HTMLElement>('.ob-live-legend');
    if (!active.length) {
      stackRoot.innerHTML = '<div class="ob-stack-empty">Activate a layer to manage visibility, opacity and order.</div>';
      if (legendRoot) legendRoot.innerHTML = '<span class="ob-stack-empty">Activate layers to build legend.</span>';
      return;
    }
    if (legendRoot) {
      legendRoot.innerHTML = active.filter((entry) => entry.visible).map((entry) => {
        const def = MOBILE_LAYER_DEFINITIONS.find((layer) => layer.id === entry.id);
        return `<span class="ob-legend-item"><i style="--legend-color:${entry.color}"></i><b>${def?.glyph || '•'}</b><em>${entry.title}</em></span>`;
      }).join('') || '<span class="ob-stack-empty">All active layers are hidden.</span>';
    }
    stackRoot.innerHTML = active.map((entry, index) => `
      <div class="ob-stack-row" data-stack-id="${entry.id}" style="--stack-color:${entry.color}">
        <button class="ob-stack-eye" type="button" data-visible="${entry.visible}" aria-label="${entry.visible ? 'Hide' : 'Show'} ${entry.title}">${entry.visible ? '◉' : '○'}</button>
        <div class="ob-stack-copy"><strong>${entry.title}</strong><small>${entry.category === 'live' ? 'LIVE SIGNAL' : 'OCEAN INTELLIGENCE'} · ${entry.visible ? 'VISIBLE' : 'HIDDEN'}</small></div>
        <div class="ob-stack-opacity ${entry.supportsOpacity ? '' : 'disabled'}">
          <input type="range" min="5" max="100" step="1" value="${Math.round(entry.opacity * 100)}" ${entry.supportsOpacity ? '' : 'disabled'} aria-label="${entry.title} opacity"/>
          <b>${entry.supportsOpacity ? `${Math.round(entry.opacity * 100)}%` : '—'}</b>
        </div>
        <div class="ob-stack-actions">
          ${entry.category === 'ocean' ? `<button type="button" class="ob-stack-data" aria-label="Inspect ${entry.title} attributes">DATA</button>` : ''}
          ${entry.supportsStyle ? `<button type="button" class="ob-stack-style" aria-label="Cycle ${entry.title} style">${entry.styleStrength === 0 ? 'SOFT' : entry.styleStrength === 2 ? 'BOLD' : 'STD'}</button>` : ''}
          <div class="ob-stack-order">
            <button type="button" data-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${entry.title} up">↑</button>
            <button type="button" data-move="1" ${index === active.length - 1 ? 'disabled' : ''} aria-label="Move ${entry.title} down">↓</button>
          </div>
        </div>
      </div>`).join('');

    stackRoot.querySelectorAll<HTMLElement>('.ob-stack-row').forEach((row) => {
      const id = row.dataset.stackId;
      if (!id) return;
      row.querySelector<HTMLButtonElement>('.ob-stack-eye')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        const entry = geoLibreStack.snapshot().find((item) => item.id === id);
        if (!entry) return;
        await geoLibreStack.setVisible(id, !entry.visible);
      });
      const slider = row.querySelector<HTMLInputElement>('input[type="range"]');
      slider?.addEventListener('input', () => {
        const pct = Number(slider.value);
        const label = row.querySelector<HTMLElement>('.ob-stack-opacity b');
        if (label) label.textContent = `${Math.round(pct)}%`;
        void geoLibreStack.setOpacity(id, pct / 100);
      });
      row.querySelector<HTMLButtonElement>('.ob-stack-data')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const entry = geoLibreStack.snapshot().find((item) => item.id === id);
        if (entry) openAttributePreview(id, entry.title);
      });
      row.querySelector<HTMLButtonElement>('.ob-stack-style')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await geoLibreStack.cycleStyle(id);
      });
      row.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => {
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          await geoLibreStack.move(id, Number(button.dataset.move) as -1 | 1);
        });
      });
    });
  };
  geoLibreStack.subscribe(renderGeoLibreStack);

  const updateActiveCount = () => {
    const count = layerButtons.filter((button) => button.dataset.active === 'true').length;
    shell.querySelectorAll<HTMLElement>('.ob-active-count').forEach((element) => { element.textContent = `${count} ACTIVE`; });
    shell.querySelectorAll<HTMLElement>('.ob-intel-active-value').forEach((element) => { element.textContent = String(count); });
  };
  const updateAltitude = () => {
    const text = formatCameraAltitude(viewer);
    shell.querySelectorAll<HTMLElement>('.ob-rail-alt-value, .ob-intel-alt-value').forEach((element) => { element.textContent = text; });
  };
  const closeSheets = () => {
    shell.classList.remove('layers-open', 'intel-open', 'entity-open');
  };
  const openLayers = () => {
    shell.classList.remove('intel-open');
    shell.classList.add('layers-open');
  };
  const openIntel = () => {
    shell.classList.remove('layers-open');
    shell.classList.add('intel-open');
  };

  shell.querySelector<HTMLButtonElement>('.ob-layers-button')?.addEventListener('click', openLayers);
  shell.querySelector<HTMLButtonElement>('.ob-intel-button')?.addEventListener('click', openIntel);
  shell.querySelectorAll<HTMLButtonElement>('.ob-intel-open').forEach((button) => button.addEventListener('click', openIntel));
  shell.querySelectorAll<HTMLButtonElement>('.ob-sheet-close').forEach((button) => button.addEventListener('click', closeSheets));
  shell.querySelector<HTMLButtonElement>('.ob-sheet-scrim')?.addEventListener('click', closeSheets);
  shell.querySelectorAll<HTMLButtonElement>('.ob-center-button').forEach((button) => {
    button.addEventListener('click', () => focusBermuda(viewer, 0.9, photoreal3D));
  });

  // Lightweight GeoLibre-style spatial tools: identify, measure and range ring.
  const analysisSource = new Cesium.CustomDataSource('ocean-brain-analysis');
  void viewer.dataSources.add(analysisSource);
  let activeTool: 'identify' | 'measure' | 'range' = 'identify';
  let measureStart: Cesium.Cartographic | null = null;
  const toolStatus = shell.querySelector<HTMLElement>('.ob-tool-status');
  const toolButtons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.ob-map-tool'));
  const setTool = (tool: 'identify' | 'measure' | 'range') => {
    activeTool = tool;
    shell.dataset.mapTool = tool;
    measureStart = null;
    toolButtons.forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
    if (toolStatus) toolStatus.textContent = tool === 'measure'
      ? 'Tap two points to measure geodesic distance.'
      : tool === 'range'
        ? 'Tap map to place a 5 NM analysis ring.'
        : 'Tap any visible feature to identify across all layers.';
  };
  setTool('identify');
  shell.querySelectorAll<HTMLSelectElement>('[data-entity-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      const id = select.dataset.entityFilter;
      if (!id) return;
      void customLiveControllers.get(id)?.setFilter?.(select.value);
    });
  });
  shell.querySelector<HTMLSelectElement>('[data-radar-time]')?.addEventListener('change', (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    void customLiveControllers.get('weather-radar')?.setTimeOffset?.(Number(select.value));
  });
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      if (tool === 'clear') {
        analysisSource.entities.removeAll();
        measureStart = null;
        if (toolStatus) toolStatus.textContent = 'Analysis graphics cleared.';
        viewer.scene.requestRender?.();
        return;
      }
      if (tool === 'identify' || tool === 'measure' || tool === 'range') setTool(tool);
    });
  });
  const analysisHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  analysisHandler.setInputAction((movement: any) => {
    if (activeTool === 'identify') return;
    const cartesian = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(movement.position) : null;
    const fallback = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84);
    const point = cartesian || fallback;
    if (!point) return;
    const cartographic = Cesium.Cartographic.fromCartesian(point);
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    if (activeTool === 'range') {
      analysisSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 20),
        ellipse: {
          semiMajorAxis: 9260,
          semiMinorAxis: 9260,
          material: Cesium.Color.fromCssColorString('#4fe0ff').withAlpha(0.06),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#4fe0ff').withAlpha(0.95),
          outlineWidth: 3,
          height: 20,
        },
        label: {
          text: '5 NM RANGE',
          font: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      let nearby = 0;
      const centerCarto = Cesium.Cartographic.fromDegrees(lon, lat);
      const now = Cesium.JulianDate.now();
      for (const ds of viewer.dataSources?._dataSources || []) {
        for (const candidate of ds?.entities?.values || []) {
          try {
            const pos = candidate.position?.getValue?.(now);
            if (!pos) continue;
            const props = entityProperties(candidate);
            if (!props.oceanBrainKind && !props.oceanBrainLayerId) continue;
            const targetCarto = Cesium.Cartographic.fromCartesian(pos);
            const distance = new Cesium.EllipsoidGeodesic(centerCarto, targetCarto).surfaceDistance || Infinity;
            if (distance <= 9260) nearby++;
          } catch {}
        }
      }
      if (toolStatus) toolStatus.textContent = `5 NM buffer · ${nearby} nearby mapped features / targets`;
      viewer.scene.requestRender?.();
      return;
    }
    if (!measureStart) {
      measureStart = cartographic;
      if (toolStatus) toolStatus.textContent = 'First point set. Tap the second point.';
      return;
    }
    const geodesic = new Cesium.EllipsoidGeodesic(measureStart, cartographic);
    const metres = geodesic.surfaceDistance || 0;
    const nm = metres / 1852;
    const startLon = Cesium.Math.toDegrees(measureStart.longitude);
    const startLat = Cesium.Math.toDegrees(measureStart.latitude);
    analysisSource.entities.add({
      polyline: {
        positions: [Cesium.Cartesian3.fromDegrees(startLon, startLat, 40), Cesium.Cartesian3.fromDegrees(lon, lat, 40)],
        width: 3,
        material: Cesium.Color.fromCssColorString('#ffe66a').withAlpha(0.95),
        clampToGround: true,
      },
      position: Cesium.Cartesian3.fromDegrees((startLon + lon) / 2, (startLat + lat) / 2, 80),
      label: {
        text: `${nm.toFixed(2)} NM · ${(metres / 1000).toFixed(2)} KM`,
        font: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#111925').withAlpha(0.82),
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    if (toolStatus) toolStatus.textContent = `Distance ${nm.toFixed(2)} NM · ${(metres / 1000).toFixed(2)} KM`;
    measureStart = null;
    viewer.scene.requestRender?.();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  void analysisHandler;

  const refreshLayerButtonStates = () => {
    for (const definition of LIVE_LAYER_DEFINITIONS) {
      const button = shell.querySelector<HTMLButtonElement>(`.ob-layer-toggle[data-layer-id="${definition.id}"]`);
      if (!button || button.dataset.active !== 'true') continue;
      const custom = customLiveControllers.get(definition.id);
      setLayerButtonStatus(button, custom ? custom.getStatus() : nativeLayerStatus(dataManager, definition.id));
    }
    for (const definition of OCEAN_LAYER_DEFINITIONS) {
      const button = shell.querySelector<HTMLButtonElement>(`.ob-layer-toggle[data-layer-id="${definition.id}"]`);
      if (!button || button.dataset.active !== 'true') continue;
      setLayerButtonStatus(button, oceanLayerStatus(dataManager, definition.id));
    }
  };

  for (const button of layerButtons) {
    button.addEventListener('click', async () => {
      const id = button.dataset.layerId;
      if (!id || button.disabled) return;
      const next = button.dataset.active !== 'true';
      button.disabled = true;
      const definition = MOBILE_LAYER_DEFINITIONS.find((layer) => layer.id === id);
      const custom = customLiveControllers.get(id);
      if (definition?.category === 'live' && next)
        setLayerButtonStatus(button, { state: 'loading', text: 'CONNECTING…' });
      if (definition?.category === 'ocean' && next)
        setLayerButtonStatus(button, { state: 'loading', text: 'LOADING OCEAN DATA…' });
      try {
        if (custom) {
          if (next) {
            const state = await custom.enable();
            if (state.state === 'error') throw new Error(state.error || state.text);
          } else {
            await custom.disable();
          }
        } else {
          const changed = await dataManager.setEnabled(id, next, { origin: 'user' });
          if (changed === false) throw new Error(`${id} lifecycle rejected`);
        }
        button.dataset.active = String(next);
        await geoLibreStack.setActive(id, next);
        if (next) await geoLibreStack.syncRenderOrder();
        button.removeAttribute('data-error');
        if (!next) setLayerButtonStatus(button, { state: 'off', text: definition?.subtitle || '' });
        else if (definition?.category === 'live')
          setLayerButtonStatus(button, custom ? custom.getStatus() : nativeLayerStatus(dataManager, id));
        else if (definition?.category === 'ocean')
          setLayerButtonStatus(button, oceanLayerStatus(dataManager, id));
        // IMPORTANT: layer toggles never move the camera. The user owns the view;
        // the dedicated Focus control is the only automatic Bermuda recenter action.
      } catch (error) {
        button.dataset.active = 'false';
        await geoLibreStack.setActive(id, false);
        button.dataset.error = 'true';
        if (custom) await custom.disable().catch(() => {});
        setLayerButtonStatus(button, { state: 'error', text: shortFeedError(error), error: String(error) });
        console.warn(`[Ocean Brain mobile:${id}]`, error);
      } finally {
        button.disabled = false;
        updateActiveCount();
        window.setTimeout(refreshLayerButtonStates, 900);
      }
    });
  }

  shell.querySelector<HTMLButtonElement>('.ob-clear-layers')?.addEventListener('click', async () => {
    await Promise.allSettled(
      MOBILE_LAYER_DEFINITIONS.map((layer) => {
        const custom = customLiveControllers.get(layer.id);
        return custom
          ? custom.disable()
          : dataManager.setEnabled(layer.id, false, { origin: 'programmatic' });
      }),
    );
    layerButtons.forEach((button) => {
      button.dataset.active = 'false';
      const definition = MOBILE_LAYER_DEFINITIONS.find((layer) => layer.id === button.dataset.layerId);
      setLayerButtonStatus(button, { state: 'off', text: definition?.subtitle || '' });
    });
    await Promise.all(MOBILE_LAYER_DEFINITIONS.map((layer) => geoLibreStack.setActive(layer.id, false)));
    updateActiveCount();
  });

  updateActiveCount();
  updateAltitude();
  viewer.camera.moveEnd.addEventListener(updateAltitude);
  void refreshTelemetry(shell);
  window.setInterval(() => { void refreshTelemetry(shell); }, 60_000);
  window.setInterval(refreshLayerButtonStates, 2_500);
  return shell;
}

async function start() {
  applyOceanBrainBrand();

  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen?.querySelector<HTMLElement>('.loader-status');
  if (!loadingScreen || !loaderStatus) throw new Error('God’s Eye application chrome is missing');

  const placeSearch = unavailablePlaceSearch;
  let catalog: any;
  const application = createApplication({
    createScene: async (context: any) => {
      const scene = await createApplicationScene({
        ...context,
        requestServices: createApplicationRequestServices({ signal: context.signal }),
        googleApiKey: GOOGLE_MAPS_API_KEY,
        cesiumToken: CESIUM_ION_TOKEN,
        loaderStatus,
      });
      catalog = createOceanBrainCatalog(context, scene);
      return scene;
    },
    createControls: (context: any) =>
      createApplicationControls({
        ...context,
        loaderStatus,
        placeSearch,
        catalog,
      }),
    createData: (context: any) =>
      createApplicationData({
        ...context,
        allowQaRegistration: false,
        catalog,
      }),
    createTools: (context: any) =>
      createApplicationTools({
        ...context,
        loadingScreen,
        placeSearch,
        voice: {},
        startChrome: (options: any) =>
          startApplicationChrome({ ...options, initializeWelcome: null }),
      }),
  });

  await application.start();
  const components = application.getComponents();
  const viewer = components.scene.viewer;
  const marinePanelObserver = installMarinePanelBranding();
  applyOceanBrainBrand();

  let activeTileset = components.scene.tileset || null;
  let threeDErrorCode: string | null = null;
  if (!activeTileset && CESIUM_ION_TOKEN) {
    const recovery = await recoverPhotorealistic3D(viewer);
    activeTileset = recovery.tileset;
    threeDErrorCode = recovery.errorCode;
  } else if (!activeTileset && !CESIUM_ION_TOKEN) {
    threeDErrorCode = 'TOKEN MISSING';
  }

  const photoreal3D = Boolean(activeTileset);
  configureRenderQuality(viewer, activeTileset);
  const mobileShell = installMobileExperience(components, {
    tileset: activeTileset,
    errorCode: threeDErrorCode,
  });

  focusBermuda(viewer, 0, photoreal3D);
  window.setTimeout(() => focusBermuda(viewer, 0.9, photoreal3D), 500);

  await Promise.allSettled(
    DEFAULT_OCEAN_BRAIN_LAYERS.map((layerId) =>
      components.data.dataManager.setEnabled(layerId, true, {
        origin: 'programmatic',
      }),
    ),
  );

  window.setTimeout(() => focusBermuda(viewer, 0.8, photoreal3D), 1600);
  relabelMarineGroup();

  const activeStyle = document.querySelector<HTMLElement>('#active-style-name');
  if (activeStyle) activeStyle.textContent = photoreal3D ? 'BERMUDA // PHOTOREAL 3D' : 'BERMUDA // SATELLITE';

  if (!mobileShell) {
    const runtimeStatus = document.createElement('div');
    runtimeStatus.className = 'ocean-brain-status';
    runtimeStatus.textContent = photoreal3D
      ? (GOOGLE_MAPS_API_KEY ? 'GOOGLE PHOTOREALISTIC 3D · ACTIVE' : 'GOOGLE 3D · CESIUM ION · ACTIVE')
      : `SATELLITE FALLBACK · 3D ${threeDErrorCode || 'UNAVAILABLE'}`;
    document.body.appendChild(runtimeStatus);
  }

  Object.assign(window, {
    __oceanBrain: {
      application,
      viewer,
      dataManager: components.data.dataManager,
      styleManager: components.controls.styleManager,
      marinePanelObserver,
      mapDiagnostics: {
        tokenPresent: Boolean(CESIUM_ION_TOKEN),
        photoreal3D,
        errorCode: threeDErrorCode,
        ionAssetId: 2275207,
      },
      focusBermuda: () => focusBermuda(viewer, 1.15, photoreal3D),
    },
  });
}

start().catch((error) => {
  console.error('Bermuda Ocean Brain initialization failed:', error);
  const loaderStatus = document.querySelector<HTMLElement>('#loading-screen .loader-status');
  if (loaderStatus) {
    loaderStatus.textContent = 'Ocean Brain startup failed';
    loaderStatus.style.color = '#ff6b6b';
  }
});
