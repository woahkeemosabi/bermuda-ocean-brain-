import * as Cesium from 'cesium';

export type MarineLayerDefinition = {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
  fillAlpha: number;
  lineWidth: number;
  pointSize: number;
  clusterPoints?: boolean;
  token: string;
};

export const BERMUDA_MARINE_LAYERS: readonly MarineLayerDefinition[] = Object.freeze([
  { id: 'bermuda-territorial-seas', key: 'territorial-seas', name: 'Territorial Sea', icon: '◎', color: '#35e6ff', fillAlpha: 0.10, lineWidth: 3.5, pointSize: 4, token: '0' },
  { id: 'bermuda-eez', key: 'eez', name: 'Exclusive Economic Zone', icon: '◉', color: '#786dff', fillAlpha: 0.065, lineWidth: 4.0, pointSize: 4, token: '2' },
  { id: 'bermuda-coral-reef-type', key: 'coral-reef-type', name: 'Coral Reef Habitat', icon: '✦', color: '#22f2d2', fillAlpha: 0.31, lineWidth: 2.4, pointSize: 4, clusterPoints: true, token: '3' },
  { id: 'bermuda-coral-cover', key: 'coral-cover', name: 'Coral Cover', icon: '✧', color: '#8affdf', fillAlpha: 0.26, lineWidth: 2.2, pointSize: 4, clusterPoints: true, token: '4' },
  { id: 'bermuda-seagrass', key: 'seagrass', name: 'Seagrass', icon: '≋', color: '#5cff9a', fillAlpha: 0.22, lineWidth: 2.0, pointSize: 3.4, clusterPoints: true, token: '5' },
  { id: 'bermuda-shelf', key: 'shelf', name: 'Bermuda Shelf', icon: '▱', color: '#37b8ff', fillAlpha: 0.115, lineWidth: 2.7, pointSize: 4, token: '6' },
  { id: 'bermuda-slope', key: 'slope', name: 'Bermuda Slope', icon: '◢', color: '#586cff', fillAlpha: 0.14, lineWidth: 2.7, pointSize: 4, token: '7' },
  { id: 'bermuda-seamounts', key: 'seamounts', name: 'Seamounts', icon: '▲', color: '#cf70ff', fillAlpha: 0.18, lineWidth: 3.0, pointSize: 8, token: '8' },
  { id: 'bermuda-subsea-cables', key: 'subsea-cables', name: 'Subsea Cables', icon: '⌁', color: '#ffca5c', fillAlpha: 0.0, lineWidth: 3.6, pointSize: 5, token: '9' },
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

function configureClustering(dataSource: any, definition: MarineLayerDefinition) {
  if (!definition.clusterPoints) return;
  dataSource.clustering.enabled = true;
  dataSource.clustering.pixelRange = 22;
  dataSource.clustering.minimumClusterSize = 4;
  const color = Cesium.Color.fromCssColorString(definition.color);
  dataSource.clustering.clusterEvent.addEventListener((entities, cluster) => {
    cluster.billboard.show = false;
    cluster.label.show = false;
    cluster.point.show = true;
    cluster.point.color = color.withAlpha(0.72);
    cluster.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.5);
    cluster.point.outlineWidth = 1.5;
    cluster.point.pixelSize = Math.min(18, 6 + Math.sqrt(entities.length) * 1.8);
  });
}

function styleDataSource(dataSource: any, definition: MarineLayerDefinition) {
  const color = Cesium.Color.fromCssColorString(definition.color);
  configureClustering(dataSource, definition);

  for (const entity of dataSource.entities.values) {
    if (entity.polygon) {
      entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(definition.fillAlpha));
      entity.polygon.outline = true;
      entity.polygon.outlineColor = color.withAlpha(0.96);
      entity.polygon.outlineWidth = definition.lineWidth;
    }
    if (entity.polyline) {
      entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.98));
      entity.polyline.width = definition.lineWidth;
      entity.polyline.clampToGround = true;
    }
    if (entity.billboard) entity.billboard.show = false;

    if (entity.position && !entity.polygon && !entity.polyline) {
      entity.point = new Cesium.PointGraphics({
        color: color.withAlpha(definition.clusterPoints ? 0.62 : 0.9),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.52),
        outlineWidth: 1,
        pixelSize: definition.pointSize,
        scaleByDistance: new Cesium.NearFarScalar(5_000, 1.25, 160_000, 0.45),
        translucencyByDistance: new Cesium.NearFarScalar(5_000, 0.95, 180_000, 0.28),
      });
    } else if (entity.point) {
      entity.point.color = color.withAlpha(definition.clusterPoints ? 0.62 : 0.9);
      entity.point.outlineColor = Cesium.Color.BLACK.withAlpha(0.52);
      entity.point.outlineWidth = 1;
      entity.point.pixelSize = definition.pointSize;
      entity.point.scaleByDistance = new Cesium.NearFarScalar(5_000, 1.25, 160_000, 0.45);
      entity.point.translucencyByDistance = new Cesium.NearFarScalar(5_000, 0.95, 180_000, 0.28);
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
        const response = await fetch(`/api/marine/layers/${definition.key}`, {
          headers: { Accept: 'application/geo+json,application/json' },
        });
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
