import { create } from 'zustand';

interface SymbologyPanelStore {
  isOpen: boolean;
  layerId: string | null;
  anchorX: number;
  anchorY: number;
  open: (layerId: string, x: number, y: number) => void;
  close: () => void;
}

export const useSymbologyPanelStore = create<SymbologyPanelStore>((set) => ({
  isOpen: false,
  layerId: null,
  anchorX: 0,
  anchorY: 0,

  open: (layerId, x, y) =>
    set({ isOpen: true, layerId, anchorX: x, anchorY: y }),

  close: () =>
    set({ isOpen: false, layerId: null }),
}));
