import { create } from 'zustand';
import type { LayerSymbology } from '../types/symbology';

export type LayerType = 'OBJ' | 'FBX' | 'GLTF' | 'GLB' | 'GEOTIFF' | 'DXF' | 'SHP';

export interface LayerItem {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  filePath: string;
  cesiumId?: string;
  center?: [number, number, number];
  groupId?: string;
  symbology?: LayerSymbology;
}

interface LayerStore {
  layers: LayerItem[];
  activeLayerId: string | null;
  /** Multi-selection for keyboard shortcuts */
  selectedLayerIds: Set<string>;
  /** Collapsed group IDs */
  collapsedGroups: Set<string>;

  addLayer: (layer: LayerItem) => void;
  addLayers: (layers: LayerItem[]) => void;
  removeLayer: (id: string) => void;
  removeLayers: (ids: string[]) => void;
  toggleVisibility: (id: string) => void;
  toggleGroupVisibility: (groupId: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<LayerItem>) => void;
  toggleGroupCollapse: (groupId: string) => void;

  updateSymbology: (id: string, updates: Partial<LayerSymbology>) => void;

  // Multi-selection
  selectAll: () => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;
  setSelection: (ids: string[]) => void;
}

export const useLayerStore = create<LayerStore>((set, get) => ({
  layers: [],
  activeLayerId: null,
  selectedLayerIds: new Set(),
  collapsedGroups: new Set(),

  addLayer: (layer) =>
    set((state) => ({ layers: [...state.layers, layer] })),

  addLayers: (newLayers) =>
    set((state) => ({ layers: [...state.layers, ...newLayers] })),

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
      activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
      selectedLayerIds: (() => {
        const next = new Set(state.selectedLayerIds);
        next.delete(id);
        return next;
      })(),
    })),

  removeLayers: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      layers: state.layers.filter((l) => !idSet.has(l.id)),
      activeLayerId: state.activeLayerId && idSet.has(state.activeLayerId) ? null : state.activeLayerId,
      selectedLayerIds: new Set(),
    }));
  },

  toggleVisibility: (id) => {
    const layer = get().layers.find((l) => l.id === id);
    if (!layer) return;
    const newVisible = !layer.visible;
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, visible: newVisible } : l
      ),
    }));
  },

  toggleGroupVisibility: (groupId: string) => {
    const state = get();
    const group = state.layers.find((l) => l.id === groupId);
    if (!group) return;
    const newVisible = !group.visible;
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id === groupId) return { ...l, visible: newVisible };
        if (l.groupId === groupId) return { ...l, visible: newVisible };
        return l;
      }),
    }));
  },

  setActiveLayer: (id) => set({ activeLayerId: id }),

  updateLayer: (id, updates) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, ...updates } : l
      ),
    })),

  toggleGroupCollapse: (groupId) =>
    set((state) => {
      const next = new Set(state.collapsedGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { collapsedGroups: next };
    }),

  updateSymbology: (id, updates) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id
          ? { ...l, symbology: { ...(l.symbology || { color: '#FFFFFF', opacity: 1, lineWidth: 1.5, pointSize: 4 }), ...updates } }
          : l
      ),
    })),

  // ── Multi-selection ──
  selectAll: () => {
    const ids = get().layers.map((l) => l.id);
    set({ selectedLayerIds: new Set(ids) });
  },

  clearSelection: () =>
    set({ selectedLayerIds: new Set() }),

  toggleSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedLayerIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedLayerIds: next };
    }),

  setSelection: (ids) =>
    set({ selectedLayerIds: new Set(ids) }),
}));
