import { create } from 'zustand';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  layerId: string | null;
  layerName: string | null;
}

interface ContextMenuStore extends ContextMenuState {
  open: (x: number, y: number, layerId: string, layerName: string) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set) => ({
  visible: false,
  x: 0,
  y: 0,
  layerId: null,
  layerName: null,

  open: (x, y, layerId, layerName) =>
    set({ visible: true, x, y, layerId, layerName }),

  close: () =>
    set({ visible: false, layerId: null, layerName: null }),
}));
