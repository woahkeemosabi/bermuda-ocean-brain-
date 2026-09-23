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
const MOBILE_LAYER_DEFINITIONS = [
  { id: 'bermuda-territorial-seas', label: 'Territorial Sea', glyph: '◎' },
  { id: 'bermuda-coral-reef-type', label: 'Coral Reef', glyph: '✦' },
  { id: 'bermuda-seagrass', label: 'Seagrass', glyph: '≋' },
  { id: 'bermuda-shelf', label: 'Bermuda Shelf', glyph: '▱' },
  { id: 'bermuda-slope', label: 'Slope', glyph: '◢' },
  { id: 'bermuda-seamounts', label: 'Seamounts', glyph: '▲' },
  { id: 'bermuda-eez', label: 'EEZ', glyph: '◉' },
  { id: 'bermuda-subsea-cables', label: 'Subsea Cables', glyph: '⌁' },
];
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
const HAS_3D_CREDENTIALS = Boolean(GOOGLE_MAPS_API_KEY || CESIUM_ION_TOKEN);

function applyOceanBrainBrand() {
  document.title = 'Bermuda Ocean Brain';
  const title = document.querySelector<HTMLElement>('#title-bar h1');
  if (title) title.innerHTML = '<span class="title-logo brand-logo" aria-hidden="true"><img src="./logo.svg" alt="" /></span> <span>BERMUDA OCEAN <span class="title-accent">BRAIN</span></span>';
  const subtitle = document.querySelector<HTMLElement>('#title-bar .subtitle');
  if (subtitle) subtitle.textContent = 'LIVE MARINE SPATIAL INTELLIGENCE';
  const styleLabel = document.querySelector<HTMLElement>('#style-indicator .indicator-label');
  if (styleLabel) styleLabel.textContent = 'OCEAN BRAIN // ACTIVE STYLE';
  const dataTitle = document.querySelector<HTMLElement>('#data-panel .panel-title');
  if (dataTitle) dataTitle.textContent = 'OCEAN LAYERS';
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
  // Render above CSS-pixel resolution on Retina phones without forcing the
  // full 3x device pixel ratio, which is too expensive for a live Cesium scene.
  const deviceScale = Number(window.devicePixelRatio || 1);
  viewer.resolutionScale = Math.min(Math.max(deviceScale * 0.65, 1.25), 1.85);

  if (viewer.scene?.globe) {
    viewer.scene.globe.maximumScreenSpaceError = 1.35;
  }
  if (viewer.scene?.fog) viewer.scene.fog.enabled = false;

  if (tileset) {
    // Lower SSE = request sharper 3D tiles. Keep this conservative for iPhone.
    tileset.maximumScreenSpaceError = 8;
    tileset.preloadWhenHidden = false;
    tileset.preloadFlightDestinations = true;
  }
  viewer.scene?.requestRender?.();
}

function focusBermuda(viewer: any, duration = 1.15, photoreal3D = HAS_3D_CREDENTIALS) {
  const cameraOptions = {
    destination: Cesium.Cartesian3.fromDegrees(
      BERMUDA.longitude,
      BERMUDA.latitude,
      photoreal3D ? 56000 : 61000,
    ),
    orientation: {
      // Near-nadir God’s-eye framing keeps Bermuda in the optical centre of
      // a portrait phone instead of pushing it toward the bottom edge.
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

function installMobileExperience(components: any) {
  if (!window.matchMedia('(max-width: 720px)').matches) return null;

  const photoreal3D = Boolean(components.scene.tileset);
  const mapSourceLabel = photoreal3D
    ? (GOOGLE_MAPS_API_KEY ? 'GOOGLE PHOTOREALISTIC 3D' : 'GOOGLE 3D · CESIUM ION')
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
          <span>LIVE MARINE INTELLIGENCE</span>
        </div>
      </div>
      <div class="ob-mobile-mode">${photoreal3D ? '3D' : 'SAT'}</div>
    </div>
    <button class="ob-sheet-scrim" type="button" aria-label="Close ocean layers"></button>
    <section class="ob-layer-sheet" aria-label="Ocean layers">
      <div class="ob-sheet-handle"></div>
      <div class="ob-sheet-heading">
        <div>
          <span class="ob-kicker">OCEAN LAYERS</span>
          <strong>Bermuda Marine Intelligence</strong>
        </div>
        <button class="ob-sheet-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="ob-layer-grid">
        ${MOBILE_LAYER_DEFINITIONS.map((layer) => `
          <button class="ob-layer-toggle" type="button" data-layer-id="${layer.id}" data-active="${DEFAULT_OCEAN_BRAIN_LAYERS.includes(layer.id) ? 'true' : 'false'}">
            <span class="ob-layer-glyph">${layer.glyph}</span>
            <span>${layer.label}</span>
          </button>
        `).join('')}
      </div>
      <div class="ob-sheet-footer">
        <span>${mapSourceLabel}</span>
        <button class="ob-clear-layers" type="button">CLEAR</button>
      </div>
    </section>
    <nav class="ob-mobile-dock" aria-label="Ocean Brain controls">
      <button class="ob-dock-button ob-layers-button" type="button">
        <span class="ob-dock-icon">≋</span><span>Layers</span>
      </button>
      <button class="ob-dock-button ob-center-button" type="button">
        <span class="ob-dock-icon">⌖</span><span>Bermuda</span>
      </button>
      <div class="ob-live-pill"><i></i><span>LIVE</span></div>
    </nav>
  `;
  document.body.appendChild(shell);

  const dataManager = components.data.dataManager;
  const layerButtons = Array.from(shell.querySelectorAll<HTMLButtonElement>('.ob-layer-toggle'));
  const setOpen = (open: boolean) => shell.classList.toggle('layers-open', open);

  shell.querySelector<HTMLButtonElement>('.ob-layers-button')?.addEventListener('click', () => setOpen(true));
  shell.querySelector<HTMLButtonElement>('.ob-sheet-close')?.addEventListener('click', () => setOpen(false));
  shell.querySelector<HTMLButtonElement>('.ob-sheet-scrim')?.addEventListener('click', () => setOpen(false));
  shell.querySelector<HTMLButtonElement>('.ob-center-button')?.addEventListener('click', () => focusBermuda(components.scene.viewer, 0.9, photoreal3D));

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
      } catch (error) {
        button.dataset.active = 'false';
        button.dataset.error = 'true';
        console.warn(`[Ocean Brain mobile:${id}]`, error);
      } finally {
        button.disabled = false;
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
  });

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
  const photoreal3D = Boolean(components.scene.tileset);
  configureRenderQuality(viewer, components.scene.tileset);
  const mobileShell = installMobileExperience(components);

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
      : 'SATELLITE FALLBACK · 3D UNAVAILABLE';
    document.body.appendChild(runtimeStatus);
  }

  Object.assign(window, {
    __oceanBrain: {
      application,
      viewer,
      dataManager: components.data.dataManager,
      styleManager: components.controls.styleManager,
      marinePanelObserver,
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
