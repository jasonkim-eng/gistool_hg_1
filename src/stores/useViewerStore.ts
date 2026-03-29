import { create } from 'zustand';

interface ViewerState {
  /** Mouse position: longitude, latitude, altitude */
  cursorPosition: { lon: number; lat: number; alt: number } | null;
  /** Current EPSG code */
  epsg: string;
  /** Frames per second */
  fps: number;
  /** Status bar message */
  statusMessage: string;

  /** GeoTIFF loading progress */
  geotiffLoading: boolean;
  /** Overall progress 0-100 across all steps */
  geotiffProgress: number;
  /** Current step label */
  geotiffStep: string;
  /** Current step index (0-based, out of GEOTIFF_STEPS.length) */
  geotiffCurrentStep: number;
  /** Sub-progress for the current conversion step (0-100, from sharp IPC) */
  geotiffConvertProgress: number;
  geotiffFileName: string;
  geotiffFileSizeMB: string;
  /** Bytes processed so far (for display) */
  geotiffBytesRead: number;
  /** Total file bytes */
  geotiffTotalBytes: number;

  setCursorPosition: (pos: { lon: number; lat: number; alt: number } | null) => void;
  setEpsg: (epsg: string) => void;
  setFps: (fps: number) => void;
  setStatusMessage: (msg: string) => void;
  setGeotiffProgress: (data: {
    progress: number;
    step: string;
    stepIndex?: number;
    fileName?: string;
    fileSizeMB?: string;
  }) => void;
  setGeotiffConvertProgress: (data: { percent: number; bytesRead?: number; totalBytes?: number }) => void;
  clearGeotiffProgress: () => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  cursorPosition: null,
  epsg: 'EPSG:4326',
  fps: 0,
  statusMessage: 'Ready',

  geotiffLoading: false,
  geotiffProgress: 0,
  geotiffStep: '',
  geotiffCurrentStep: -1,
  geotiffConvertProgress: 0,
  geotiffFileName: '',
  geotiffFileSizeMB: '',
  geotiffBytesRead: 0,
  geotiffTotalBytes: 0,

  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setEpsg: (epsg) => set({ epsg }),
  setFps: (fps) => set({ fps }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setGeotiffProgress: (data) =>
    set((state) => ({
      geotiffLoading: true,
      geotiffProgress: data.progress,
      geotiffStep: data.step,
      geotiffCurrentStep: data.stepIndex ?? state.geotiffCurrentStep,
      geotiffFileName: data.fileName ?? state.geotiffFileName,
      geotiffFileSizeMB: data.fileSizeMB ?? state.geotiffFileSizeMB,
    })),
  setGeotiffConvertProgress: (data) =>
    set({
      geotiffConvertProgress: data.percent,
      geotiffBytesRead: data.bytesRead ?? 0,
      geotiffTotalBytes: data.totalBytes ?? 0,
    }),
  clearGeotiffProgress: () =>
    set({
      geotiffLoading: false,
      geotiffProgress: 0,
      geotiffStep: '',
      geotiffCurrentStep: -1,
      geotiffConvertProgress: 0,
      geotiffFileName: '',
      geotiffFileSizeMB: '',
      geotiffBytesRead: 0,
      geotiffTotalBytes: 0,
    }),
}));

