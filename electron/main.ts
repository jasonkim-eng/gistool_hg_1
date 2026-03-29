import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const fsOpen = promisify(fs.open);
const fsRead = promisify(fs.read);
const fsClose = promisify(fs.close);
import os from 'os';
import sharp from 'sharp';

/** Send geotiff conversion progress to all renderer windows */
function sendGeotiffConvertProgress(percent: number, bytesRead?: number, totalBytes?: number) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('geotiff:convertProgress', { percent, bytesRead, totalBytes });
    }
  }
}

// ── GPU & Memory Optimization (COR-111) ──
// Force discrete GPU on NVIDIA Optimus / AMD Switchable laptops
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Use DirectX 11on12 ANGLE backend (fixes Dawn/EGL crash on Intel Arc/Ultra GPUs)
app.commandLine.appendSwitch('use-angle', 'd3d11on12');
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Enable hardware-accelerated video decode
app.commandLine.appendSwitch('enable-accelerated-video-decode');
// V8 memory limit for large datasets
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Register custom protocol to serve local files to renderer (for large GeoTIFF etc.)
  protocol.handle('local-file', (request) => {
    // URL format: local-file:///C:/path/to/file.tif
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    // On Windows, remove leading slash from /C:/path → C:/path
    const normalizedPath = process.platform === 'win32' && filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;
    return net.fetch(`file:///${normalizedPath}`);
  });

  // Register protocol to serve TIFF→JPEG converted previews via sharp
  protocol.handle('geotiff-preview', async (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    const normalizedPath = process.platform === 'win32' && filePath.startsWith('/')
      ? filePath.slice(1)
      : filePath;
    
    try {
      console.log(`[geotiff-preview] Converting: ${normalizedPath}`);
      const MAX_DIM = 8192;

      // Get file size for progress estimation
      let totalBytes = 0;
      try { totalBytes = (await fs.promises.stat(normalizedPath)).size; } catch {}

      // Phase 1: Reading & decoding TIFF (0→50%)
      sendGeotiffConvertProgress(0, 0, totalBytes);

      const image = sharp(normalizedPath, {
        limitInputPixels: false,  // Allow very large images
        sequentialRead: true,     // Memory-efficient sequential read
      });

      sendGeotiffConvertProgress(10, Math.round(totalBytes * 0.1), totalBytes);
      
      const metadata = await image.metadata();
      const w = metadata.width || 1;
      const h = metadata.height || 1;

      sendGeotiffConvertProgress(20, Math.round(totalBytes * 0.2), totalBytes);
      
      let pipeline = image;
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
        pipeline = pipeline.resize(
          Math.round(w * scale),
          Math.round(h * scale),
          { fit: 'inside', kernel: 'lanczos3' }
        );
        console.log(`[geotiff-preview] Resizing ${w}x${h} -> ${Math.round(w * scale)}x${Math.round(h * scale)}`);
      }

      // Phase 2: Decoding to raw RGBA — heaviest step (20→70%)
      sendGeotiffConvertProgress(25, Math.round(totalBytes * 0.25), totalBytes);

      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Phase 3: Pixel processing — alpha masking (70→85%)
      sendGeotiffConvertProgress(70, Math.round(totalBytes * 0.7), totalBytes);

      const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const chunkSize = 4 * 1024 * 1024; // report every 4M pixels
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 250 && pixels[i + 1] > 250 && pixels[i + 2] > 250) {
          pixels[i + 3] = 0;
        }
        // Progress ticks during pixel scan
        if (i > 0 && i % chunkSize === 0) {
          const scanPct = 70 + Math.round((i / pixels.length) * 15); // 70→85
          sendGeotiffConvertProgress(scanPct, Math.round(totalBytes * (scanPct / 100)), totalBytes);
        }
      }

      // Phase 4: PNG encoding (85→100%)
      sendGeotiffConvertProgress(85, Math.round(totalBytes * 0.85), totalBytes);

      const pngBuffer = await sharp(Buffer.from(pixels), {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png({ compressionLevel: 6 })
        .toBuffer();

      sendGeotiffConvertProgress(100, totalBytes, totalBytes);
      
      console.log(`[geotiff-preview] Converted to PNG: ${(pngBuffer.length / 1024 / 1024).toFixed(1)} MB (white→transparent)`);
      
      return new Response(new Uint8Array(pngBuffer), {
        headers: { 'Content-Type': 'image/png' },
      });
    } catch (err) {
      console.error('[geotiff-preview] Conversion failed:', err);
      return new Response('Conversion failed', { status: 500 });
    }
  });

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    title: 'GeoStudio X',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'bottom' });
    }
    // Log GPU info after window is ready
    logGpuInfo();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ── GPU Detection & Logging ──
async function logGpuInfo() {
  try {
    const gpuInfo = await app.getGPUInfo('complete') as any;
    const gpuDevices = gpuInfo?.gpuDevice || [];
    const cpuCores = os.cpus().length;
    const totalRAM = (os.totalmem() / (1024 ** 3)).toFixed(1);

    console.log('═══════════════════════════════════════');
    console.log('  GeoStudio X — System Info');
    console.log('═══════════════════════════════════════');
    console.log(`  CPU: ${os.cpus()[0]?.model || 'Unknown'}`);
    console.log(`  CPU Cores: ${cpuCores} (logical)`);
    console.log(`  RAM: ${totalRAM} GB`);

    if (gpuDevices.length > 0) {
      for (let i = 0; i < gpuDevices.length; i++) {
        const gpu = gpuDevices[i];
        const vendorId = gpu.vendorId?.toString(16)?.toUpperCase();
        const deviceId = gpu.deviceId?.toString(16)?.toUpperCase();
        const vendor = vendorId === '10DE' ? 'NVIDIA'
          : vendorId === '1002' ? 'AMD'
          : vendorId === '8086' ? 'Intel'
          : `Vendor 0x${vendorId}`;
        const active = gpu.active ? ' ★ ACTIVE' : '';
        console.log(`  GPU ${i}: ${vendor} (0x${deviceId})${active}`);
        if (gpu.driverVersion) console.log(`         Driver: ${gpu.driverVersion}`);
      }
    } else {
      console.log('  GPU: Info not available');
    }

    const featureStatus = app.getGPUFeatureStatus();
    console.log(`  WebGL: ${featureStatus.webgl}`);
    console.log(`  WebGL2: ${featureStatus.webgl2}`);
    console.log('═══════════════════════════════════════');
  } catch (err) {
    console.warn('GPU info unavailable:', err);
  }
}

// IPC: Get system info for renderer process
ipcMain.handle('system:getInfo', async () => {
  try {
    const gpuInfo = await app.getGPUInfo('basic') as any;
    const gpuDevices = gpuInfo?.gpuDevice || [];
    const activeGpu = gpuDevices.find((g: any) => g.active) || gpuDevices[0];
    const vendorId = activeGpu?.vendorId?.toString(16)?.toUpperCase();
    const gpuVendor = vendorId === '10DE' ? 'NVIDIA'
      : vendorId === '1002' ? 'AMD'
      : vendorId === '8086' ? 'Intel'
      : 'Unknown';

    return {
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      cpuCores: os.cpus().length,
      totalRAM: Math.round(os.totalmem() / (1024 ** 3)),
      gpuVendor,
      gpuActive: !!activeGpu?.active,
    };
  } catch {
    return {
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      cpuCores: os.cpus().length,
      totalRAM: Math.round(os.totalmem() / (1024 ** 3)),
      gpuVendor: 'Unknown',
      gpuActive: false,
    };
  }
});

// ── IPC Handlers ──
ipcMain.handle('file:openDialog', async (_event, options: { filters?: { name: string; extensions: string[] }[] }) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [
      { name: '3D Models', extensions: ['obj', 'fbx', 'gltf', 'glb'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  // Limit individual file selection to 100 files max
  return result.filePaths.slice(0, 100);
});

ipcMain.handle('file:readBinary', async (_event, filePath: string) => {
  try {
    // Use async readFile — fs.readFileSync fails for files >2GB (ERR_FS_FILE_TOO_LARGE)
    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (err) {
    console.error('Failed to read file:', filePath, err);
    return null;
  }
});

ipcMain.handle('file:readText', async (_event, filePath: string) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Failed to read file:', err);
    return null;
  }
});

ipcMain.handle('file:getInfo', async (_event, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      ext: path.extname(filePath).toLowerCase(),
      size: stat.size,
      dir: path.dirname(filePath),
    };
  } catch {
    return null;
  }
});

// Folder selection dialog for batch OBJ loading
ipcMain.handle('file:openFolderDialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'OBJ 폴더 선택',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── Partial Header Read (for spatial catalog scan) ──

ipcMain.handle('file:readHeader', async (_event, filePath: string, bytes: number = 2048) => {
  try {
    const fd = await fsOpen(filePath, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fsRead(fd, buffer, 0, bytes, 0);
    await fsClose(fd);
    return buffer.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  }
});

ipcMain.handle('file:readHeaders', async (_event, filePaths: string[], bytes: number = 2048) => {
  const CONCURRENCY = 16;
  const results: (string | null)[] = new Array(filePaths.length).fill(null);

  for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
    const batch = filePaths.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (fp, idx) => {
      try {
        const fd = await fsOpen(fp, 'r');
        const buffer = Buffer.alloc(bytes);
        const { bytesRead } = await fsRead(fd, buffer, 0, bytes, 0);
        await fsClose(fd);
        results[i + idx] = buffer.toString('utf-8', 0, bytesRead);
      } catch {
        results[i + idx] = null;
      }
    });
    await Promise.all(promises);
  }
  return results;
});

// Scan a folder for OBJ files (non-recursive for performance with thousands of files)
ipcMain.handle('file:scanObjFolder', async (_event, folderPath: string) => {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const objFiles: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.obj')) {
        objFiles.push(path.join(folderPath, entry.name));
      }
    }
    // Sort for consistent ordering
    objFiles.sort((a, b) => a.localeCompare(b));
    return objFiles;
  } catch (err) {
    console.error('Failed to scan folder:', err);
    return [];
  }
});

// Scan a folder for files with a given extension (generic version)
ipcMain.handle('file:scanFolder', async (_event, folderPath: string, extension: string) => {
  try {
    const ext = extension.toLowerCase();
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
        files.push(path.join(folderPath, entry.name));
      }
    }
    files.sort((a, b) => a.localeCompare(b));
    return files;
  } catch (err) {
    console.error('Failed to scan folder:', err);
    return [];
  }
});

// ── Binary header read (for TIFF dimension parsing without loading entire file) ──
ipcMain.handle('file:readBinaryHeader', async (_event, filePath: string, bytes: number = 8192) => {
  try {
    const fd = await fsOpen(filePath, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fsRead(fd, buffer, 0, bytes, 0);
    await fsClose(fd);
    // Return as ArrayBuffer
    const trimmed = buffer.slice(0, bytesRead);
    return trimmed.buffer.slice(trimmed.byteOffset, trimmed.byteOffset + trimmed.byteLength);
  } catch (err) {
    console.error('Failed to read binary header:', filePath, err);
    return null;
  }
});

// ── Read N bytes from a specific offset in a file ──
ipcMain.handle('file:readBinaryAt', async (_event, filePath: string, offset: number, bytes: number) => {
  try {
    const fd = await fsOpen(filePath, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fsRead(fd, buffer, 0, bytes, offset);
    await fsClose(fd);
    const trimmed = buffer.slice(0, bytesRead);
    return trimmed.buffer.slice(trimmed.byteOffset, trimmed.byteOffset + trimmed.byteLength);
  } catch (err) {
    console.error('Failed to read binary at offset:', filePath, offset, err);
    return null;
  }
});

// ── Get file size without reading ──
ipcMain.handle('file:getFileSize', async (_event, filePath: string) => {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return null;
  }
});

// ── List sibling files with same base name (for companion files like .prj, .tfw) ──
ipcMain.handle('file:listSiblingFiles', async (_event, filePath: string) => {
  try {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const siblings: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const entryBase = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      if (entryBase === baseName) {
        const ext = path.extname(entry.name).toLowerCase();
        siblings[ext] = path.join(dir, entry.name);
      }
    }
    return siblings;
  } catch (err) {
    console.error('Failed to list sibling files:', err);
    return {};
  }
});

// ── App lifecycle ──
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
