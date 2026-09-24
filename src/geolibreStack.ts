/**
 * Bermuda Ocean Brain layer stack bridge.
 *
 * This small store/adapter layer is derived from GeoLibre's layer-state model:
 * separate visibility, opacity, ordering and selected/inspect state, then sync
 * those properties into the active renderer. It intentionally does not embed
 * the full GeoLibre application; it adapts the useful layer-stack semantics to
 * the existing God's Eye View + Cesium runtime.
 */

export type GeoLibreStackAdapter = {
  id: string;
  title: string;
  category: 'live' | 'ocean';
  color: string;
  supportsOpacity?: boolean;
  setVisible?: (visible: boolean) => void | Promise<void>;
  setOpacity?: (opacity: number) => void | Promise<void>;
  raiseToTop?: () => void | Promise<void>;
  setStyleStrength?: (strength: number) => void | Promise<void>;
};

export type GeoLibreStackEntry = {
  id: string;
  title: string;
  category: 'live' | 'ocean';
  color: string;
  active: boolean;
  visible: boolean;
  opacity: number;
  supportsOpacity: boolean;
  supportsStyle: boolean;
  styleStrength: number;
};

type Listener = (entries: readonly GeoLibreStackEntry[]) => void;

export class GeoLibreLayerStack {
  private readonly adapters = new Map<string, GeoLibreStackAdapter>();
  private readonly entries = new Map<string, GeoLibreStackEntry>();
  private order: string[] = [];
  private listeners = new Set<Listener>();

  register(adapter: GeoLibreStackAdapter) {
    this.adapters.set(adapter.id, adapter);
    if (!this.entries.has(adapter.id)) {
      this.entries.set(adapter.id, {
        id: adapter.id,
        title: adapter.title,
        category: adapter.category,
        color: adapter.color,
        active: false,
        visible: true,
        opacity: 1,
        supportsOpacity: adapter.supportsOpacity !== false && typeof adapter.setOpacity === 'function',
        supportsStyle: typeof adapter.setStyleStrength === 'function',
        styleStrength: 1,
      });
      this.order.push(adapter.id);
    }
    this.emit();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return this.order
      .map((id) => this.entries.get(id))
      .filter((entry): entry is GeoLibreStackEntry => Boolean(entry));
  }

  activeEntries() {
    return this.snapshot().filter((entry) => entry.active);
  }

  async setActive(id: string, active: boolean) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.active = active;
    if (active) entry.visible = true;
    this.emit();
  }

  async setVisible(id: string, visible: boolean) {
    const entry = this.entries.get(id);
    const adapter = this.adapters.get(id);
    if (!entry || !adapter) return;
    entry.visible = visible;
    await adapter.setVisible?.(visible);
    this.emit();
  }

  async setOpacity(id: string, opacity: number) {
    const entry = this.entries.get(id);
    const adapter = this.adapters.get(id);
    if (!entry || !adapter || !entry.supportsOpacity) return;
    const next = Math.max(0.05, Math.min(1, Number(opacity) || 1));
    entry.opacity = next;
    await adapter.setOpacity?.(next);
    this.emit();
  }

  async cycleStyle(id: string) {
    const entry = this.entries.get(id);
    const adapter = this.adapters.get(id);
    if (!entry || !adapter || !entry.supportsStyle) return;
    entry.styleStrength = entry.styleStrength >= 2 ? 0 : entry.styleStrength + 1;
    await adapter.setStyleStrength?.(entry.styleStrength);
    this.emit();
  }

  async move(id: string, direction: -1 | 1) {
    const activeIds = this.order.filter((candidate) => this.entries.get(candidate)?.active);
    const at = activeIds.indexOf(id);
    if (at < 0) return;
    const target = at + direction;
    if (target < 0 || target >= activeIds.length) return;
    const other = activeIds[target];
    const a = this.order.indexOf(id);
    const b = this.order.indexOf(other);
    [this.order[a], this.order[b]] = [this.order[b], this.order[a]];
    await this.syncRenderOrder();
    this.emit();
  }

  async syncRenderOrder() {
    // Raise from bottom to top in stack order. Unsupported adapters simply skip.
    for (const id of this.order.filter((candidate) => this.entries.get(candidate)?.active)) {
      await this.adapters.get(id)?.raiseToTop?.();
    }
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
