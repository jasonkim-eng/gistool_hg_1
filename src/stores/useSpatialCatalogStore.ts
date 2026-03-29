/**
 * SpatialCatalogStore — Lightweight index of all scanned OBJ files.
 *
 * Phase 1 of the smart loading pipeline:
 * Stores file paths + WGS84 coordinates extracted from headers (no 3D parsing).
 * Enables spatial queries: "which files are near this camera view?"
 */

import { create } from 'zustand';

export interface CatalogEntry {
  /** Absolute file path */
  filePath: string;
  /** Filename only */
  fileName: string;
  /** WGS84 coordinates [lon, lat, alt] — null if no geo-ref in header */
  center: [number, number, number] | null;
  /** Loading status */
  status: 'pending' | 'loading' | 'loaded' | 'failed';
  /** Layer ID after successful loading */
  layerId?: string;
}

interface SpatialCatalogState {
  /** All scanned entries */
  entries: CatalogEntry[];
  /** Group layer ID in the layer panel */
  groupId: string | null;
  /** Folder path being managed */
  folderPath: string | null;
  /** Is Phase 1 scan in progress? */
  isScanning: boolean;
  /** Is view-dependent loading active? */
  isViewLoading: boolean;

  // Actions
  buildCatalog: (entries: CatalogEntry[], groupId: string, folderPath: string) => void;
  markLoading: (filePaths: string[]) => void;
  markLoaded: (filePath: string, layerId: string) => void;
  markFailed: (filePath: string) => void;
  setScanning: (v: boolean) => void;
  setViewLoading: (v: boolean) => void;
  clear: () => void;

  // Queries
  getStats: () => { total: number; loaded: number; loading: number; failed: number; pending: number };
  getNearestUnloaded: (lon: number, lat: number, count: number) => CatalogEntry[];
  getInBounds: (west: number, south: number, east: number, north: number) => CatalogEntry[];
}

/** Haversine-like fast distance² (good enough for sorting, avoids trig) */
function distSq(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLon = lon1 - lon2;
  const dLat = lat1 - lat2;
  return dLon * dLon + dLat * dLat;
}

export const useSpatialCatalogStore = create<SpatialCatalogState>((set, get) => ({
  entries: [],
  groupId: null,
  folderPath: null,
  isScanning: false,
  isViewLoading: false,

  buildCatalog: (entries, groupId, folderPath) =>
    set({ entries, groupId, folderPath }),

  markLoading: (filePaths) => {
    const pathSet = new Set(filePaths);
    set((s) => ({
      entries: s.entries.map((e) =>
        pathSet.has(e.filePath) ? { ...e, status: 'loading' as const } : e
      ),
    }));
  },

  markLoaded: (filePath, layerId) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.filePath === filePath ? { ...e, status: 'loaded' as const, layerId } : e
      ),
    })),

  markFailed: (filePath) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.filePath === filePath ? { ...e, status: 'failed' as const } : e
      ),
    })),

  setScanning: (v) => set({ isScanning: v }),
  setViewLoading: (v) => set({ isViewLoading: v }),

  clear: () => set({
    entries: [],
    groupId: null,
    folderPath: null,
    isScanning: false,
    isViewLoading: false,
  }),

  getStats: () => {
    const entries = get().entries;
    let loaded = 0, loading = 0, failed = 0, pending = 0;
    for (const e of entries) {
      if (e.status === 'loaded') loaded++;
      else if (e.status === 'loading') loading++;
      else if (e.status === 'failed') failed++;
      else pending++;
    }
    return { total: entries.length, loaded, loading, failed, pending };
  },

  getNearestUnloaded: (lon, lat, count) => {
    const entries = get().entries;
    const unloaded = entries.filter(
      (e) => e.status === 'pending' && e.center !== null
    );
    // Sort by distance from camera center
    unloaded.sort((a, b) => {
      const da = distSq(a.center![0], a.center![1], lon, lat);
      const db = distSq(b.center![0], b.center![1], lon, lat);
      return da - db;
    });
    return unloaded.slice(0, count);
  },

  getInBounds: (west, south, east, north) => {
    return get().entries.filter((e) => {
      if (!e.center) return false;
      const [lon, lat] = e.center;
      return lon >= west && lon <= east && lat >= south && lat <= north;
    });
  },
}));
