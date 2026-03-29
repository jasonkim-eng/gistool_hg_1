import { create } from 'zustand';

export interface BatchState {
  /** Is a batch loading operation in progress? */
  isRunning: boolean;
  /** Total OBJ files to process */
  totalFiles: number;
  /** Successfully loaded count */
  loadedFiles: number;
  /** Failed count */
  failedFiles: number;
  /** Currently processing filename */
  currentFile: string;
  /** Folder name being loaded */
  folderName: string;
  /** Can be cancelled? */
  canCancel: boolean;

  // Actions
  startBatch: (totalFiles: number, folderName: string) => void;
  updateProgress: (loaded: number, failed: number, currentFile: string) => void;
  finishBatch: () => void;
  reset: () => void;
}

export const useBatchStore = create<BatchState>((set) => ({
  isRunning: false,
  totalFiles: 0,
  loadedFiles: 0,
  failedFiles: 0,
  currentFile: '',
  folderName: '',
  canCancel: true,

  startBatch: (totalFiles, folderName) =>
    set({
      isRunning: true,
      totalFiles,
      loadedFiles: 0,
      failedFiles: 0,
      currentFile: '',
      folderName,
      canCancel: true,
    }),

  updateProgress: (loaded, failed, currentFile) =>
    set({ loadedFiles: loaded, failedFiles: failed, currentFile }),

  finishBatch: () =>
    set({ isRunning: false, canCancel: false, currentFile: '' }),

  reset: () =>
    set({
      isRunning: false,
      totalFiles: 0,
      loadedFiles: 0,
      failedFiles: 0,
      currentFile: '',
      folderName: '',
      canCancel: true,
    }),
}));
