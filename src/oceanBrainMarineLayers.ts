import * as Cesium from 'cesium';

export type MarineLayerDefinition = {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
  fillAlpha: number;
  token: string;
};

export const BERMUDA_MARINE_LAYERS: readonly MarineLayerDefinition[] = Object.freeze([
  { id: 'bermuda-territorial-seas', key: 'territorial-seas', name: 'Territorial Sea', icon: '◎', color: '#00d4ff', fillAlpha: 0.035, token: '0' },
  { id: 'bermuda-eez', key: 'eez', name: 'Exclusive Economic Zone', icon: '◉', color: '#4c7dff', fillAlpha: 0.018, token: '2' },
  { id: 'bermuda-coral-reef-type', key: 'coral-reef-type', name: 'Coral Reef Habitat', icon: '✦', color: '#20f0d0', fillAlpha: 0.12, token: '3' },
  { id: 'bermuda-coral-cover', key: 'coral-cover', name: 'Coral Cover', icon: '✧', color: '#72ffe5', fillAlpha: 0.11, token: '4' },
  { id: 'bermuda-seagrass', key: 'seagrass', name: 'Seagrass', icon: '≋', color: '#63e68b', fillAlpha: 0.13, token: '5' },
  { id: 'bermuda-shelf', key: 'shelf', name: 'Bermuda Shelf', icon: '▱', color: '#38a7ff', fillAlpha: 0.045, token: '6' },
  { id: 'bermuda-slope', key: 'slope', name: 'Bermuda Slope', icon: '◢', color: '#566dff', fillAlpha: 0.04, token: '7' },
  { id: 'bermuda-seamounts', key: 'seamounts', name: 'Seamounts', icon: '▲', color: '#b96cff', fillAlpha: 0.09, token: '8' },
]);

export const BERMUDA_MARINE_LAYER_METADATA = Object.freeze(
  BERMUDA_MARINE_LAYERS.map((layer) =>
    Object.freeze({ id: layer.id, token: layer.token, disposition: 'enabled-only' }),
  ),
);

function featureCount(geojson: unknown) {
  if (!geojson || typeof geojson !== 'object') return 0;
  const features = (geojson as { features?: unknown[] }).features;
  return Array.isArray(features) ? features.length : 0;
}

function styleDataSource(dataSource: any, definition: MarineLayerDefinition) {
  const color = Cesium.Color.fromCssColorString(definition.color);
  for (const entity of dataSource.entities.values) {
    if (entity.polygon) {
      entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(definition.fillAlpha));
      entity.polygon.outline = true;
      entity.polygon.outlineColor = color.withAlpha(0.82);
    }
    if (entity.polyline) {
      entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.9));
      entity.polyline.width = 1.5;
    }
    if (entity.point) {
      entity.point.color = color;
      entity.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.65);
      entity.point.outlineWidth = 1;
      entity.point.pixelSize = 6;
    }
  }
}

function createMarineLayer(definition: MarineLayerDefinition) {
  let viewer: any = null;
  let dataSource: any = null;
  let enabled = false;
  let generation = 0;
  let count = 0;
  let lastUpdate: number | null = null;
  let lastError: string | null = null;

  return {
    id: definition.id,
    name: definition.name,
    icon: definition.icon,
    source: 'Bermuda Marine Spatial Plan',
    showInTogglePanel: true,
    updateInterval: 6 * 60 * 60 * 1000,

    init(nextViewer: any) {
      if (viewer) throw new Error(`${definition.name} is already initialized`);
      viewer = nextViewer;
      enabled = false;
      generation += 1;
      count = 0;
      lastUpdate = null;
      lastError = null;
      return true;
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      return true;
    },

    disable() {
      enabled = false;
      generation += 1;
      if (dataSource) dataSource.show = false;
      return true;
    },

    async update() {
      if (!viewer || !enabled) return false;
      const requestGeneration = ++generation;
      try {
        const response = await fetch(`/api/marine/layers/${definition.key}`, { headers: { Accept: 'application/geo+json,application/json' } });
        if (!response.ok) throw new Error(`${definition.name} request failed (${response.status})`);
        if (!enabled || requestGeneration !== generation) return false;
        const geojson = await response.json();
        const nextSource = await Cesium.GeoJsonDataSource.load(geojson, {
          clampToGround: true,
        });
        if (!enabled || requestGeneration !== generation) {
          nextSource.destroy?.();
          return false;
        }
        styleDataSource(nextSource, definition);
        nextSource.show = true;
        viewer.dataSources.add(nextSource);
        if (dataSource) viewer.dataSources.remove(dataSource, true);
        dataSource = nextSource;
        count = featureCount(geojson);
        lastUpdate = Date.now();
        lastError = null;
        viewer.scene.requestRender?.();
        return true;
      } catch (cause) {
        if (requestGeneration !== generation || !enabled) return false;
        lastError = cause instanceof Error ? cause.message : `${definition.name} unavailable`;
        console.warn(`[Ocean Brain:${definition.id}]`, lastError);
        return false;
      }
    },

    destroy() {
      enabled = false;
      generation += 1;
      if (viewer && dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      count = 0;
      lastUpdate = null;
      lastError = null;
    },

    getStats() {
      return { count, lastUpdate, error: lastError };
    },
  };
}

export function createBermudaMarineLayers() {
  return BERMUDA_MARINE_LAYERS.map(createMarineLayer);
}
