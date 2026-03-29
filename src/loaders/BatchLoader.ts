/**
 * BatchLoader — Two-phase smart batch OBJ loading engine (facade).
 *
 * Phase 1: Rapid Header Scan (BatchScanner)
 *   - Reads only the first 2KB of each OBJ to extract WGS84 coordinates
 *   - Builds a spatial catalog without any 3D parsing
 *
 * Phase 2: Background Full Loading (BatchWorker)
 *   - Concurrent workers load OBJ files with cached textures
 *   - Periodic render flushes for progressive display
 *
 * Texture caching managed by BatchCacheManager.
 */

import { scanHeaders } from './BatchScanner';
import { loadSingleOBJ, workerLoop, flushPendingLayers } from './BatchWorker';
import { prewarmTextureCache, clearAllCaches } from './BatchCacheManager';
import { startViewDependentLoading } from './ViewDependentLoader';
import { flyTo, requestRender } from '../viewers/cesium/CesiumAdapter';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import { useBatchStore } from '../stores/useBatchStore';
import { useSpatialCatalogStore, type CatalogEntry } from '../stores/useSpatialCatalogStore';
import { BATCH } from '../config/defaults';

/** Threshold: batches larger than this use view-dependent loading */
const VIEW_DEPENDENT_THRESHOLD = 500;

// ── State ──
let currentAbortController: AbortController | null = null;
let currentGroupId: string | null = null;
let currentBaseDir: string | null = null;

// ═══════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Open folder dialog and start smart loading pipeline.
 */
export async function openFolderAndLoad(): Promise<void> {
  if (!window.api?.file) {
    console.warn('[BatchLoader] Electron IPC not available');
    return;
  }
  if (useBatchStore.getState().isRunning) {
    console.warn('[BatchLoader] Batch already in progress');
    return;
  }

  const folderPath = await window.api.file.openFolderDialog();
  if (!folderPath) return;

  useViewerStore.getState().setStatusMessage('폴더 스캔 중...');
  const objFiles: string[] = await window.api.file.scanObjFolder(folderPath);

  if (objFiles.length === 0) {
    useViewerStore.getState().setStatusMessage('OBJ 파일을 찾을 수 없습니다');
    return;
  }

  const folderName = folderPath.split(/[/\\]/).pop() || 'Folder';
  await smartLoad(objFiles, folderName, folderPath);
}

/**
 * Cancel any running batch or view-dependent loading.
 */
export function cancelBatch(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  useSpatialCatalogStore.getState().setViewLoading(false);
}

/**
 * Load specific catalog entries into Cesium.
 * Called by ViewDependentLoader when camera moves near unloaded objects.
 */
export async function loadCatalogEntries(entries: CatalogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  if (!currentGroupId || !currentBaseDir) return;

  const store = useSpatialCatalogStore.getState();
  const filePaths = entries.map((e) => e.filePath);
  store.markLoading(filePaths);

  const signal = currentAbortController?.signal;

  for (const entry of entries) {
    if (signal?.aborted) break;
    try {
      const layerId = await loadSingleOBJ(
        entry.filePath,
        entry.fileName,
        currentGroupId,
        currentBaseDir,
        signal || new AbortController().signal,
      );
      useSpatialCatalogStore.getState().markLoaded(entry.filePath, layerId);
    } catch (err: any) {
      if (signal?.aborted) break;
      console.warn(`[BatchLoader] Failed: ${entry.fileName}:`, err?.message || err);
      useSpatialCatalogStore.getState().markFailed(entry.filePath);
    }
  }

  flushPendingLayers();
  requestRender();

  const stats = useSpatialCatalogStore.getState().getStats();
  useBatchStore.getState().updateProgress(stats.loaded, stats.failed, '');
  useViewerStore.getState().setStatusMessage(
    `📊 ${stats.loaded}/${stats.total} 로딩됨 (${stats.loading} 진행중)`,
  );
}

// ═══════════════════════════════════════════════════════════════
//  SMART LOADING PIPELINE
// ═══════════════════════════════════════════════════════════════

async function smartLoad(
  objFiles: string[],
  folderName: string,
  folderPath: string,
): Promise<void> {
  const t0 = performance.now();
  const groupId = `group_${Date.now()}`;
  currentGroupId = groupId;
  currentBaseDir = folderPath;

  currentAbortController = new AbortController();
  useBatchStore.getState().startBatch(objFiles.length, folderName);

  console.log(`[BatchLoader] Smart loading: ${objFiles.length} files from ${folderName}`);
  useViewerStore.getState().setStatusMessage(`⚡ 헤더 스캔 중... (${objFiles.length}개 파일)`);

  // ── Phase 1: Rapid header scan ──
  const catalogEntries = await scanHeaders(objFiles, currentAbortController.signal);

  const scanTime = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[BatchLoader] Phase 1 complete: ${catalogEntries.length} entries scanned in ${scanTime}s`);

  const withCoords = catalogEntries.filter((e) => e.center !== null);
  const withoutCoords = catalogEntries.length - withCoords.length;

  // Store catalog
  useSpatialCatalogStore.getState().buildCatalog(catalogEntries, groupId, folderPath);

  // Create group layer in layer panel
  useLayerStore.getState().addLayer({
    id: groupId,
    name: `📁 ${folderName} (0/${objFiles.length})`,
    type: 'OBJ',
    visible: true,
    filePath: folderPath,
    groupId: undefined,
  });

  // Pre-warm texture cache from first file
  await prewarmTextureCache(objFiles[0], folderPath, currentAbortController.signal);

  // Fly to first geo-referenced entry
  const firstWithCenter = catalogEntries.find((e) => e.center !== null);
  if (firstWithCenter?.center) {
    flyTo(
      firstWithCenter.center[0],
      firstWithCenter.center[1],
      firstWithCenter.center[2] + 500,
    );
  }

  // ── Phase 2: Load models ──
  if (objFiles.length > VIEW_DEPENDENT_THRESHOLD && withCoords.length > 0) {
    // Large batch with geo-coordinates: use view-dependent loading
    // Only loads models visible in the current camera viewport
    useViewerStore.getState().setStatusMessage(
      `✓ 스캔 완료: ${withCoords.length}개 좌표 확인 — ${scanTime}초 | 시야 기반 로딩 시작 (카메라 이동 시 자동 로딩)`,
    );
    console.log(`[BatchLoader] Using view-dependent loading for ${objFiles.length} files`);
    startViewDependentLoading();
  } else {
    // Small batch or no coordinates: load all immediately
    useViewerStore.getState().setStatusMessage(
      `✓ 스캔 완료: ${withCoords.length}개 좌표 확인 (${withoutCoords}개 미확인) — ${scanTime}초 | 전체 로딩 시작`,
    );
    await backgroundLoadAll(catalogEntries, groupId, folderPath, folderName);
  }
}

/**
 * Phase 2: Load ALL catalog entries in the background with concurrent workers.
 */
async function backgroundLoadAll(
  catalogEntries: CatalogEntry[],
  groupId: string,
  folderPath: string,
  folderName: string,
): Promise<void> {
  useSpatialCatalogStore.getState().setViewLoading(true);
  const signal = currentAbortController!.signal;
  const t0 = performance.now();

  // Sort by proximity to first geo-referenced entry
  const firstWithCenter = catalogEntries.find((e) => e.center !== null);
  let sortedEntries = [...catalogEntries];
  if (firstWithCenter?.center) {
    const [refLon, refLat] = firstWithCenter.center;
    sortedEntries.sort((a, b) => {
      if (!a.center && !b.center) return 0;
      if (!a.center) return 1;
      if (!b.center) return -1;
      const da = (a.center[0] - refLon) ** 2 + (a.center[1] - refLat) ** 2;
      const db = (b.center[0] - refLon) ** 2 + (b.center[1] - refLat) ** 2;
      return da - db;
    });
  }

  const queue = sortedEntries.map((e) => e.filePath);
  let loaded = 0;
  let failed = 0;
  let lastProgressUpdate = 0;
  const PROGRESS_THROTTLE_MS = 500;

  console.log(`[BatchLoader] Phase 2: Background loading ${queue.length} files (${BATCH.MAX_CONCURRENT} workers)`);

  const workers: Promise<void>[] = [];
  for (let i = 0; i < BATCH.MAX_CONCURRENT; i++) {
    workers.push(
      workerLoop(queue, groupId, folderPath, signal, (success, filename) => {
        if (success) loaded++;
        else failed++;

        // Throttle Zustand updates to reduce re-renders
        const now = performance.now();
        const processed = loaded + failed;
        const isLast = processed === sortedEntries.length;
        if (now - lastProgressUpdate >= PROGRESS_THROTTLE_MS || isLast) {
          lastProgressUpdate = now;
          useBatchStore.getState().updateProgress(loaded, failed, filename);
        }

        const entry = sortedEntries.find((e) => e.fileName === filename);
        if (entry) {
          if (success) {
            useSpatialCatalogStore.getState().markLoaded(entry.filePath, '');
          } else {
            useSpatialCatalogStore.getState().markFailed(entry.filePath);
          }
        }

        if (processed % BATCH.RENDER_FLUSH_INTERVAL === 0 || isLast) {
          flushPendingLayers();
          requestRender();

          useLayerStore.getState().updateLayer(groupId, {
            name: `📁 ${folderName} (${loaded}/${sortedEntries.length})`,
          });
        }
      }),
    );
  }

  await Promise.all(workers);

  flushPendingLayers();
  requestRender();

  useLayerStore.getState().updateLayer(groupId, {
    name: `📁 ${folderName} (${loaded}/${sortedEntries.length})`,
  });

  clearAllCaches();
  currentAbortController = null;
  useSpatialCatalogStore.getState().setViewLoading(false);
  useBatchStore.getState().finishBatch();

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const msg = signal.aborted
    ? `⚠ 취소됨: ${loaded}/${sortedEntries.length} (${elapsed}초)`
    : `✓ 전체 로딩 완료: ${loaded}/${sortedEntries.length} (${failed} 실패, ${elapsed}초)`;

  useViewerStore.getState().setStatusMessage(msg);
  console.log(`[BatchLoader] ${msg}`);
}
