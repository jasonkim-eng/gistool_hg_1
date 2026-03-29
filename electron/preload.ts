import { contextBridge, ipcRenderer } from 'electron';

// ── Typed IPC Bridge (COR-112) ──
contextBridge.exposeInMainWorld('api', {
  file: {
    openDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('file:openDialog', options),
    readBinary: (filePath: string): Promise<ArrayBuffer | null> =>
      ipcRenderer.invoke('file:readBinary', filePath),
    readText: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('file:readText', filePath),
    getInfo: (filePath: string): Promise<{ name: string; ext: string; size: number; dir: string } | null> =>
      ipcRenderer.invoke('file:getInfo', filePath),
    openFolderDialog: (): Promise<string | null> =>
      ipcRenderer.invoke('file:openFolderDialog'),
    scanObjFolder: (folderPath: string): Promise<string[]> =>
      ipcRenderer.invoke('file:scanObjFolder', folderPath),
    scanFolder: (folderPath: string, extension: string): Promise<string[]> =>
      ipcRenderer.invoke('file:scanFolder', folderPath, extension),
    readHeader: (filePath: string, bytes?: number): Promise<string | null> =>
      ipcRenderer.invoke('file:readHeader', filePath, bytes),
    readHeaders: (filePaths: string[], bytes?: number): Promise<(string | null)[]> =>
      ipcRenderer.invoke('file:readHeaders', filePaths, bytes),
    listSiblingFiles: (filePath: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke('file:listSiblingFiles', filePath),
    readBinaryHeader: (filePath: string, bytes?: number): Promise<ArrayBuffer | null> =>
      ipcRenderer.invoke('file:readBinaryHeader', filePath, bytes),
    getFileSize: (filePath: string): Promise<number | null> =>
      ipcRenderer.invoke('file:getFileSize', filePath),
    readBinaryAt: (filePath: string, offset: number, bytes: number): Promise<ArrayBuffer | null> =>
      ipcRenderer.invoke('file:readBinaryAt', filePath, offset, bytes),
  },
  geotiff: {
    onConvertProgress: (cb: (data: { percent: number; bytesRead?: number; totalBytes?: number }) => void) =>
      ipcRenderer.on('geotiff:convertProgress', (_e, data) => cb(data)),
    offConvertProgress: (cb: (data: { percent: number; bytesRead?: number; totalBytes?: number }) => void) =>
      ipcRenderer.removeListener('geotiff:convertProgress', (_e: any, data: any) => cb(data)),
    removeAllConvertProgress: () =>
      ipcRenderer.removeAllListeners('geotiff:convertProgress'),
  },
  cache: {
    readGlb: (filePath: string): Promise<ArrayBuffer | null> =>
      ipcRenderer.invoke('cache:readGlb', filePath),
    writeGlb: (filePath: string, glbBuffer: ArrayBuffer): Promise<boolean> =>
      ipcRenderer.invoke('cache:writeGlb', filePath, glbBuffer),
    hasPng: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('cache:hasPng', filePath),
    readPng: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('cache:readPng', filePath),
    writePng: (filePath: string, pngPath: string): Promise<string | null> =>
      ipcRenderer.invoke('cache:writePng', filePath, pngPath),
  },
  system: {
    platform: process.platform,
    getInfo: (): Promise<{
      cpuModel: string;
      cpuCores: number;
      totalRAM: number;
      gpuVendor: string;
      gpuActive: boolean;
    }> => ipcRenderer.invoke('system:getInfo'),
  },
});
