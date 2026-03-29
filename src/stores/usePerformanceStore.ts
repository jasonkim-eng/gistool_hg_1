/**
 * Performance settings store — user-configurable dynamic loading parameters.
 */

import { create } from 'zustand';

export interface PerformanceSettings {
  /** Use view-dependent loading for large OBJ batches */
  viewDependentLoading: boolean;
  /** Max models visible in viewport (inner ring) */
  maxVisibleModels: number;
  /** Max models kept in GPU memory (hidden but ready) */
  maxGpuModels: number;
  /** Spatial tile size in degrees (~0.005 = 500m) */
  tileSizeDeg: number;
  /** Camera debounce for tile/model updates in ms */
  viewportDebounceMs: number;
  /** Batch file count threshold for view-dependent mode */
  viewDependentThreshold: number;
}

interface PerformanceStore extends PerformanceSettings {
  isOpen: boolean;
  update: (settings: Partial<PerformanceSettings>) => void;
  open: () => void;
  close: () => void;
  reset: () => void;
}

const DEFAULTS: PerformanceSettings = {
  viewDependentLoading: true,
  maxVisibleModels: 300,
  maxGpuModels: 600,
  tileSizeDeg: 0.005,
  viewportDebounceMs: 200,
  viewDependentThreshold: 500,
};

export const usePerformanceStore = create<PerformanceStore>((set) => ({
  ...DEFAULTS,
  isOpen: false,

  update: (settings) => set(settings),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  reset: () => set(DEFAULTS),
}));

export { DEFAULTS as PERFORMANCE_DEFAULTS };
