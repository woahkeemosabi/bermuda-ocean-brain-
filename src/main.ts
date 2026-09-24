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
  { id: 'vessels', label: 'Ships', glyph: '◆', category: 'live', color: '#4fffc0', subtitle: 'AIS vessel traffic' },
  { id: 'flights', label: 'Aircraft', glyph: '✈', category: 'live', color: '#ffbd66', subtitle: 'OpenSky air traffic' },
  { id: 'wind', label: 'Wind', glyph: '≈', category: 'live', color: '#66b9ff', subtitle: 'Atmospheric flow' },
  { id: 'weather-radar', label: 'Radar', glyph: '◌', category: 'live', color: '#4fe0ff', subtitle: 'Precipitation radar' },
  { id: 'weather-satellite', label: 'Clouds', glyph: '☁', category: 'live', color: '#c1d4ff', subtitle: 'Satellite cloud field' },
  { id: 'weather-lightning', label: 'Lightning', glyph: 'ϟ', category: 'live', color: '#ffe66a', subtitle: 'Lightning activity' },
  { id: 'weather-cyclones', label: 'Cyclones', glyph: '⊙', category: 'live', color: '#ff7f9d', subtitle: 'Tropical systems' },
]);

const OCEAN_LAYER_DEFINITIONS: readonly MobileLayerDefinition[] = Object.freeze([
  { id: 'bermuda-territorial-seas', label: 'Territorial Sea', glyph: '◎', category: 'ocean', color: '#35e6ff', subtitle: '12 NM sovereign boundary', camera: { ...BERMUDA, height: 145_000 } },
  { id: 'bermuda-coral-reef-type', label: 'Coral Reef', glyph: '✦', category: 'ocean', color: '#22f2d2', subtitle: 'Reef habitat classification' },
  { id: 'bermuda-seagrass', label: 'Seagrass', glyph: '≋', category: 'ocean', color: '#5cff9a', subtitle: 'Seagrass observations' },
  { id: 'bermuda-shelf', label: 'Bermuda Shelf', glyph: '▱', category: 'ocean', color: '#37b8ff', subtitle: 'Shallow platform', camera: { ...BERMUDA, height: 130_000 } },
  { id: 'bermuda-slope', label: 'Slope', glyph: '◢', category: 'ocean', color: '#586cff', subtitle: 'Shelf break + slope', camera: { ...BERMUDA, height: 185_000 } },
  { id: 'bermuda-seamounts', label: 'Seamounts', glyph: '▲', category: 'ocean', color: '#cf70ff', subtitle: 'Regional seamount field', camera: { ...BERMUDA, height: 650_000 } },
  { id: 'bermuda-eez', label: 'EEZ', glyph: '◉', category: 'ocean', color: '#786dff', subtitle: 'Exclusive Economic Zone', camera: { ...BERMUDA, height: 640_000 } },
  { id: 'bermuda-subsea-cables', label: 'Subsea Cables', glyph: '⌁', category: 'ocean', color: '#ffca5c', subtitle: 'Submarine cable routes', camera: { ...BERMUDA, height: 230_000 } },
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
    <button class="ob-layer-toggle" type="button" data-layer-id="${layer.id}" data-active="${DEFAULT_OCEAN_BRAIN_LAYERS.includes(layer.id) ? 'true' : 'false'}" style="--layer-color:${layer.color}">
      <span class="ob-layer-glyph">${layer.glyph}</span>
      <span class="ob-layer-copy"><strong>${layer.label}</strong><small>${layer.subtitle}</small></span>
    </button>
  `).join('');
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

      <div class="ob-layer-section">
        <div class="ob-section-label"><span>LIVE SIGNALS</span><em>REAL-TIME</em></div>
        <div class="ob-layer-grid ob-layer-grid-live">${renderLayerButtons(LIVE_LAYER_DEFINITIONS)}</div>
      </div>

      <div class="ob-layer-section">
        <div class="ob-section-label"><span>OCEAN INTELLIGENCE</span><em>BDA MSP</em></div>
        <div class="ob-layer-grid">${renderLayerButtons(OCEAN_LAYER_DEFINITIONS)}</div>
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
  const layerButtons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.ob-layer-toggle'));
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
    shell.classList.remove('layers-open', 'intel-open');
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

  for (const button of layerButtons) {
    button.addEventListener('click', async () => {
      const id = button.dataset.layerId;
      if (!id || button.disabled) return;
      const next = button.dataset.active !== 'true';
      button.disabled = true;
      try {
        const changed = await dataManager.setEnabled(id, next, { origin: 'user' });
        if (changed === false) throw new Error(`${id} lifecycle rejected`);
        button.dataset.active = String(next);
        button.removeAttribute('data-error');
        if (next) {
          const definition = MOBILE_LAYER_DEFINITIONS.find((layer) => layer.id === id);
          if (definition?.camera) flyToPreset(viewer, definition.camera);
        }
      } catch (error) {
        button.dataset.active = 'false';
        button.dataset.error = 'true';
        console.warn(`[Ocean Brain mobile:${id}]`, error);
      } finally {
        button.disabled = false;
        updateActiveCount();
      }
    });
  }

  shell.querySelector<HTMLButtonElement>('.ob-clear-layers')?.addEventListener('click', async () => {
    await Promise.allSettled(
      MOBILE_LAYER_DEFINITIONS.map((layer) =>
        dataManager.setEnabled(layer.id, false, { origin: 'programmatic' }),
      ),
    );
    layerButtons.forEach((button) => { button.dataset.active = 'false'; });
    updateActiveCount();
  });

  updateActiveCount();
  updateAltitude();
  viewer.camera.moveEnd.addEventListener(updateAltitude);
  void refreshTelemetry(shell);
  window.setInterval(() => { void refreshTelemetry(shell); }, 60_000);
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
