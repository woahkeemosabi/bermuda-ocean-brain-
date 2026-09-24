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
  BERMUDA_MARINE_LAYERS.map((layer) => Object.freeze({ id: layer.id, token: layer.token, disposition: 'enabled-only' })),
);

function featureCount(geojson: unknown) {
  if (!geojson || typeof geojson !== 'object') return 0;
  const features = (geojson as { features?: unknown[] }).features;
  return Array.isArray(features) ? features.length : 0;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char));
}

function oceanIconDataUrl(kind: string, color: string) {
  const c = escapeXml(color);
  const shapes: Record<string, string> = {
    seagrass: '<path d="M31 59c-1-15 2-25 8-42 2 13 0 27-6 42h-2zm-6 0c-8-14-12-25-10-39 8 10 13 23 12 39h-2zm12 0c3-14 9-25 17-34-1 15-6 26-15 34h-2z"/>',
    coral: '<path d="M29 60V39l-12-8 4-6 8 6V18h7v12l8-7 5 5-13 12v20h-7zm-12-18L8 35l4-5 9 7-4 5zm29 1l9-8 5 5-10 8-4-5z"/>',
    seamount: '<path d="M4 55L21 30l8 11L40 16l20 39H4z"/><path d="M34 29l6-13 7 14-6-3z" fill="#06141b" opacity=".55"/>',
    cable: '<path d="M6 35c10-15 18-15 28 0s18 15 24 0" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="7" cy="35" r="5"/><circle cx="58" cy="35" r="5"/>',
    boundary: '<circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="32" cy="32" r="8"/>',
    shelf: '<path d="M7 18h50L47 50H17L7 18z" fill="none" stroke="currentColor" stroke-width="6"/><path d="M18 29h28" stroke="currentColor" stroke-width="4"/>',
    slope: '<path d="M10 12h44L38 52H22L10 12z"/><path d="M17 18h28L34 45H26z" fill="#06141b" opacity=".55"/>',
  };
  const shape = shapes[kind] || shapes.boundary;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="${c}" color="${c}" stroke-linejoin="round">${shape}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function iconKind(definition: MarineLayerDefinition) {
  if (definition.key.includes('seagrass')) return 'seagrass';
  if (definition.key.includes('coral')) return 'coral';
  if (definition.key.includes('seamount')) return 'seamount';
  if (definition.key.includes('cable')) return 'cable';
  if (definition.key.includes('shelf')) return 'shelf';
  if (definition.key.includes('slope')) return 'slope';
  return 'boundary';
}

function propertiesOf(entity: any) {
  try { return entity.properties?.getValue?.(Cesium.JulianDate.now()) || {}; } catch { return {}; }
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function featureName(props: Record<string, any>, definition: MarineLayerDefinition) {
  const keys = ['Name','NAME','name','Type','TYPE','type','Category','CATEGORY','Class','CLASS','Habitat','HABITAT','Cable','CABLE','Feature','FEATURE'];
  for (const key of keys) {
    const value = textValue(props[key]);
    if (value && !/^null$/i.test(value)) return value;
  }
  return definition.name;
}

function variantColor(base: Cesium.Color, label: string) {
  if (!label) return base;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  const amount = ((Math.abs(hash) % 19) - 9) / 100;
  return new Cesium.Color(
    Math.min(1, Math.max(0, base.red + amount)),
    Math.min(1, Math.max(0, base.green - amount * 0.35)),
    Math.min(1, Math.max(0, base.blue - amount * 0.55)),
    1,
  );
}

function attachOceanBrainMetadata(entity: any, definition: MarineLayerDefinition) {
  const existing = propertiesOf(entity);
  entity.properties = new Cesium.PropertyBag({
    ...existing,
    oceanBrainLayerId: definition.id,
    oceanBrainLayerName: definition.name,
    oceanBrainIconKind: iconKind(definition),
  });
  return existing;
}

function entityAnchor(entity: any) {
  const now = Cesium.JulianDate.now();
  try {
    const existing = entity.position?.getValue?.(now);
    if (existing) return existing;
    const positions = entity.polyline?.positions?.getValue?.(now);
    if (Array.isArray(positions) && positions.length) return positions[Math.floor(positions.length / 2)];
    const hierarchy = entity.polygon?.hierarchy?.getValue?.(now);
    const polygonPositions = hierarchy?.positions;
    if (Array.isArray(polygonPositions) && polygonPositions.length) return Cesium.BoundingSphere.fromPoints(polygonPositions).center;
  } catch {}
  return null;
}

function configureClustering(dataSource: any, definition: MarineLayerDefinition) {
  if (!definition.clusterPoints) return;
  dataSource.clustering.enabled = true;
  dataSource.clustering.pixelRange = 72;
  dataSource.clustering.minimumClusterSize = 10;
  const color = Cesium.Color.fromCssColorString(definition.color);
  const icon = oceanIconDataUrl(iconKind(definition), definition.color);
  dataSource.clustering.clusterEvent.addEventListener((entities: any[], cluster: any) => {
    cluster.point.show = false;
    cluster.billboard.show = true;
    cluster.billboard.image = icon;
    cluster.billboard.width = 22;
    cluster.billboard.height = 22;
    cluster.billboard.color = Cesium.Color.WHITE.withAlpha(0.94 * Number(dataSource.__oceanBrainOpacity ?? 1));
    cluster.label.show = false;
    cluster.label.text = String(entities.length);
    cluster.label.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    cluster.label.fillColor = Cesium.Color.WHITE;
    cluster.label.outlineColor = Cesium.Color.BLACK;
    cluster.label.outlineWidth = 3;
    cluster.label.pixelOffset = new Cesium.Cartesian2(13, -13);
    cluster.label.showBackground = true;
    cluster.label.backgroundColor = color.withAlpha(0.75 * Number(dataSource.__oceanBrainOpacity ?? 1));
  });
}

function styleDataSource(dataSource: any, definition: MarineLayerDefinition) {
  const baseColor = Cesium.Color.fromCssColorString(definition.color);
  configureClustering(dataSource, definition);
  const icon = oceanIconDataUrl(iconKind(definition), definition.color);
  let labelBudget = definition.clusterPoints ? 0 : 12;

  for (const entity of dataSource.entities.values) {
    const props = attachOceanBrainMetadata(entity, definition);
    const name = featureName(props, definition);
    const color = variantColor(baseColor, name === definition.name ? '' : name);

    if (entity.polygon) {
      entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(definition.fillAlpha));
      entity.polygon.outline = true;
      entity.polygon.outlineColor = color.withAlpha(0.98);
      entity.polygon.outlineWidth = definition.lineWidth;
    }
    if (entity.polyline) {
      entity.polyline.material = definition.key === 'subsea-cables'
        ? new Cesium.PolylineGlowMaterialProperty({ color: color.withAlpha(0.96), glowPower: 0.22, taperPower: 0.6 })
        : new Cesium.ColorMaterialProperty(color.withAlpha(0.98));
      entity.polyline.width = definition.key === 'subsea-cables' ? 4.6 : definition.lineWidth;
      entity.polyline.clampToGround = true;
    }

    if (entity.position && !entity.polygon && !entity.polyline) {
      entity.point = undefined;
      entity.billboard = new Cesium.BillboardGraphics({
        image: icon,
        width: definition.key === 'seamounts' ? 30 : 20,
        height: definition.key === 'seamounts' ? 30 : 20,
        color: Cesium.Color.WHITE.withAlpha(definition.clusterPoints ? 0.82 : 0.96),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(4_000, 1.2, 130_000, 0.42),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, definition.clusterPoints ? 24_000 : 300_000),
      });
    } else if (entity.billboard && entity.position) {
      entity.billboard.image = icon;
      entity.billboard.color = Cesium.Color.WHITE.withAlpha(0.9);
    }

    const anchor = entityAnchor(entity);
    const shouldLabel = Boolean(anchor) && labelBudget > 0 && (
      definition.key === 'seamounts' || definition.key === 'subsea-cables' || name !== definition.name
    );
    if (shouldLabel) {
      entity.position = anchor;
      entity.label = new Cesium.LabelGraphics({
        text: name.toUpperCase().slice(0, 34),
        font: '700 10px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.95),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: color.withAlpha(0.7),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, definition.key === 'eez' ? 900_000 : 260_000),
        scaleByDistance: new Cesium.NearFarScalar(10_000, 1, 500_000, 0.55),
      });
      labelBudget--;
    }
  }
}


function styleStrengthFactors(strength: number) {
  if (strength <= 0) return { fill: 0.45, line: 0.72, symbol: 0.78 };
  if (strength >= 2) return { fill: 1.55, line: 1.35, symbol: 1.18 };
  return { fill: 1, line: 1, symbol: 1 };
}

function applyDataSourceOpacity(dataSource: any, definition: MarineLayerDefinition, opacity: number, styleStrength = 1) {
  if (!dataSource) return;
  const alpha = Math.max(0.05, Math.min(1, opacity));
  const factors = styleStrengthFactors(styleStrength);
  dataSource.__oceanBrainOpacity = alpha;
  dataSource.__oceanBrainStyleStrength = styleStrength;
  const baseColor = Cesium.Color.fromCssColorString(definition.color);
  for (const entity of dataSource.entities.values) {
    const props = propertiesOf(entity);
    const name = featureName(props, definition);
    const color = variantColor(baseColor, name === definition.name ? '' : name);
    try {
      if (entity.polygon) {
        entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(Math.min(0.72, definition.fillAlpha * factors.fill) * alpha));
        entity.polygon.outlineColor = color.withAlpha(0.98 * alpha);
        entity.polygon.outlineWidth = Math.max(1, definition.lineWidth * factors.line);
      }
      if (entity.polyline) {
        entity.polyline.material = definition.key === 'subsea-cables'
          ? new Cesium.PolylineGlowMaterialProperty({ color: color.withAlpha(0.96 * alpha), glowPower: 0.22, taperPower: 0.6 })
          : new Cesium.ColorMaterialProperty(color.withAlpha(0.98 * alpha));
        entity.polyline.width = (definition.key === 'subsea-cables' ? 4.6 : definition.lineWidth) * factors.line;
      }
      if (entity.billboard) {
        entity.billboard.color = Cesium.Color.WHITE.withAlpha((definition.clusterPoints ? 0.82 : 0.96) * alpha);
        const baseSize = definition.key === 'seamounts' ? 30 : 20;
        entity.billboard.width = baseSize * factors.symbol;
        entity.billboard.height = baseSize * factors.symbol;
      }
      if (entity.label) {
        entity.label.fillColor = Cesium.Color.WHITE.withAlpha(alpha);
        entity.label.outlineColor = Cesium.Color.BLACK.withAlpha(0.95 * alpha);
        entity.label.backgroundColor = color.withAlpha(0.7 * alpha);
      }
    } catch {}
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
  let opacity = 1;
  let styleStrength = 1;

  return {
    id: definition.id,
    name: definition.name,
    icon: definition.icon,
    source: 'Bermuda Marine Spatial Plan',
    showInTogglePanel: true,
    updateInterval: 6 * 60 * 60 * 1000,

    init(nextViewer: any) {
      if (viewer) throw new Error(`${definition.name} is already initialized`);
      viewer = nextViewer; enabled = false; generation += 1; count = 0; lastUpdate = null; lastError = null; return true;
    },
    enable() { enabled = true; if (dataSource) dataSource.show = true; return true; },
    disable() { enabled = false; generation += 1; if (dataSource) dataSource.show = false; return true; },
    setVisible(visible: boolean) { if (dataSource) dataSource.show = visible; viewer?.scene?.requestRender?.(); return true; },
    setOpacity(nextOpacity: number) { opacity = Math.max(0.05, Math.min(1, Number(nextOpacity) || 1)); applyDataSourceOpacity(dataSource, definition, opacity, styleStrength); viewer?.scene?.requestRender?.(); return opacity; },
    getOpacity() { return opacity; },
    setStyleStrength(nextStrength: number) { styleStrength = Math.max(0, Math.min(2, Math.round(Number(nextStrength) || 0))); applyDataSourceOpacity(dataSource, definition, opacity, styleStrength); viewer?.scene?.requestRender?.(); return styleStrength; },
    getStyleStrength() { return styleStrength; },
    getRenderHandle() { return dataSource; },
    raiseToTop() { if (viewer && dataSource) viewer.dataSources.raiseToTop?.(dataSource); viewer?.scene?.requestRender?.(); },
    async update() {
      if (!viewer || !enabled) return false;
      const requestGeneration = ++generation;
      try {
        const response = await fetch(`/api/marine/layers/${definition.key}`, { headers: { Accept: 'application/geo+json,application/json' } });
        if (!response.ok) throw new Error(`${definition.name} request failed (${response.status})`);
        if (!enabled || requestGeneration !== generation) return false;
        const geojson = await response.json();
        const nextSource = await Cesium.GeoJsonDataSource.load(geojson, { clampToGround: true });
        if (!enabled || requestGeneration !== generation) { nextSource.destroy?.(); return false; }
        styleDataSource(nextSource, definition);
        applyDataSourceOpacity(nextSource, definition, opacity, styleStrength);
        nextSource.show = true;
        viewer.dataSources.add(nextSource);
        if (dataSource) viewer.dataSources.remove(dataSource, true);
        dataSource = nextSource; count = featureCount(geojson); lastUpdate = Date.now(); lastError = null;
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
      enabled = false; generation += 1;
      if (viewer && dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null; viewer = null; count = 0; lastUpdate = null; lastError = null; opacity = 1; styleStrength = 1;
    },
    getStats() { return { count, lastUpdate, error: lastError }; },
  };
}

export function createBermudaMarineLayers() {
  return BERMUDA_MARINE_LAYERS.map(createMarineLayer);
}
