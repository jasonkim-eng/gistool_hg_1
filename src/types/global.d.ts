export {};

declare global {
  interface Window {
    api: {
      file: {
        openDialog: (options?: {
          filters?: { name: string; extensions: string[] }[];
        }) => Promise<string[] | null>;
        readBinary: (filePath: string) => Promise<ArrayBuffer | null>;
        readText: (filePath: string) => Promise<string | null>;
        getInfo: (filePath: string) => Promise<{
          name: string;
          ext: string;
          size: number;
          dir: string;
        } | null>;
        openFolderDialog: () => Promise<string | null>;
        scanObjFolder: (folderPath: string) => Promise<string[]>;
        scanFolder: (folderPath: string, extension: string) => Promise<string[]>;
        readHeader: (filePath: string, bytes?: number) => Promise<string | null>;
        readHeaders: (filePaths: string[], bytes?: number) => Promise<(string | null)[]>;
        listSiblingFiles: (filePath: string) => Promise<Record<string, string>>;
        readBinaryHeader: (filePath: string, bytes?: number) => Promise<ArrayBuffer | null>;
        getFileSize: (filePath: string) => Promise<number | null>;
        readBinaryAt: (filePath: string, offset: number, bytes: number) => Promise<ArrayBuffer | null>;
      };
      geotiff: {
        onConvertProgress: (cb: (data: { percent: number; bytesRead?: number; totalBytes?: number }) => void) => void;
        offConvertProgress: (cb: (data: { percent: number; bytesRead?: number; totalBytes?: number }) => void) => void;
        removeAllConvertProgress: () => void;
      };
      cache: {
        readGlb: (filePath: string) => Promise<ArrayBuffer | null>;
        writeGlb: (filePath: string, glbBuffer: ArrayBuffer) => Promise<boolean>;
        hasPng: (filePath: string) => Promise<string | null>;
        readPng: (filePath: string) => Promise<string | null>;
        writePng: (filePath: string, pngPath: string) => Promise<string | null>;
      };
      system: {
        platform: string;
      };
    };
  }
}
