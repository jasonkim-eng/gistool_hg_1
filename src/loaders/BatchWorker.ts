/**
 * BatchWorker — Phase 2 concurrent OBJ loading engine.
 * Loads individual OBJ files using cached textures/MTL
 * and registers them with Cesium via the adapter.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

import {
  parseWGS84OriginFast,
  extractTextureFilenames,
  mimeFromExt,
  prepareForExport,
  exportToGLB,
  disposeThreeScene,
} from './shared';
import { getTextureCache, getMtlContentCache } from './BatchCacheManager';
import { addModel } from '../viewers/cesium/CesiumAdapter';
import { useLayerStore, type LayerItem } from '../stores/useLayerStore';
import { BATCH, DEFAULT_GEO } from '../config/defaults';

let idCounter = 0;
function generateId(): string {
  return `b${Date.now()}_${++idCounter}`;
}

/** Pending layers to flush in batches for performance. */
let pendingLayers: LayerItem[] = [];

/**
 * Flush any pending layers to the store.
 */
export function flushPendingLayers(): void {
  if (pendingLayers.length === 0) return;
  useLayerStore.getState().addLayers([...pendingLayers]);
  pendingLayers = [];
}

/**
 * Load a single OBJ file, converting it to GLB and adding to Cesium.
 * Uses cached textures/MTL from BatchCacheManager.
 */
export async function loadSingleOBJ(
  filePath: string,
  fileName: string,
  groupId: string,
  baseDir: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new Error('Cancelled');

  const objText = await window.api.file.readText(filePath);
  if (!objText) throw new Error('Failed to read OBJ');
  if (signal.aborted) throw new Error('Cancelled');

  const geoRef = parseWGS84OriginFast(objText);
  const threeScene = await parseOBJFast(objText, baseDir, signal);
  if (signal.aborted) throw new Error('Cancelled');

  // Z-up → Y-up rotation for GIS OBJ
  threeScene.rotation.x = -Math.PI / 2;
  threeScene.updateMatrixWorld(true);

  const rotatedBox = new THREE.Box3().setFromObject(threeScene);
  const rotatedCenter = rotatedBox.getCenter(new THREE.Vector3());

  const wrapper = new THREE.Group();
  threeScene.position.set(-rotatedCenter.x, -rotatedCenter.y, -rotatedCenter.z);
  wrapper.add(threeScene);
  wrapper.updateMatrixWorld(true);

  prepareForExport(wrapper);

  const glbBuffer = await exportToGLB(wrapper);
  if (signal.aborted) throw new Error('Cancelled');

  const modelLon = geoRef?.lon ?? DEFAULT_GEO.MODEL_LON;
  const modelLat = geoRef?.lat ?? DEFAULT_GEO.MODEL_LAT;
  const modelAlt = geoRef?.alt ?? DEFAULT_GEO.MODEL_ALT;
  const layerId = generateId();

  // Respect parent group's current visibility
  const groupLayer = useLayerStore.getState().layers.find((l) => l.id === groupId);
  const groupVisible = groupLayer?.visible ?? true;

  await addModel({
    layerId,
    glbBuffer,
    lon: modelLon,
    lat: modelLat,
    alt: modelAlt,
    show: groupVisible,
  });

  pendingLayers.push({
    id: layerId,
    name: fileName,
    type: 'OBJ',
    visible: groupVisible,
    filePath,
    cesiumId: layerId,
    center: [modelLon, modelLat, modelAlt],
    groupId,
  });

  if (pendingLayers.length >= BATCH.LAYER_FLUSH_INTERVAL) {
    flushPendingLayers();
  }

  disposeThreeScene(wrapper);
  return layerId;
}

/**
 * Worker loop: pull files from a shared queue and load them.
 */
export async function workerLoop(
  queue: string[],
  groupId: string,
  baseDir: string,
  signal: AbortSignal,
  onComplete: (success: boolean, filename: string) => void,
): Promise<void> {
  while (queue.length > 0) {
    if (signal.aborted) break;
    const filePath = queue.shift()!;
    const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
    try {
      await loadSingleOBJ(filePath, fileName, groupId, baseDir, signal);
      onComplete(true, fileName);
    } catch (err: any) {
      if (signal.aborted) break;
      console.warn(`[BatchWorker] Failed: ${fileName}:`, err?.message || err);
      onComplete(false, fileName);
    }
  }
}

// ── Fast OBJ Parsing with Cached MTL ──

async function parseOBJFast(
  objText: string,
  baseDir: string,
  signal: AbortSignal,
): Promise<THREE.Group> {
  const mtlMatch = objText.match(/^\s*mtllib\s+(.+)$/m);
  let materials: MTLLoader.MaterialCreator | null = null;

  if (mtlMatch && window.api?.file) {
    const mtlFilename = mtlMatch[1].trim();
    const mtlContentCache = getMtlContentCache();
    const textureCache = getTextureCache();

    let mtlContent = mtlContentCache.get(mtlFilename);
    if (!mtlContent) {
      const sep = baseDir.includes('/') ? '/' : '\\';
      mtlContent = await window.api.file.readText(`${baseDir}${sep}${mtlFilename}`) || undefined;
      if (mtlContent) mtlContentCache.set(mtlFilename, mtlContent);
    }

    if (mtlContent) {
      if (signal.aborted) throw new Error('Cancelled');

      const blobUrls = new Map<string, string>();
      const textureFilenames = extractTextureFilenames(mtlContent);

      for (const texFile of textureFilenames) {
        const cacheKey = `${baseDir}/${texFile}`;
        if (textureCache.has(cacheKey)) {
          blobUrls.set(texFile, textureCache.get(cacheKey)!);
        } else {
          try {
            const sep = baseDir.includes('/') ? '/' : '\\';
            const texData = await window.api.file.readBinary(`${baseDir}${sep}${texFile}`);
            if (texData && texData instanceof ArrayBuffer) {
              const blob = new Blob([texData], { type: mimeFromExt(texFile) });
              const blobUrl = URL.createObjectURL(blob);
              textureCache.set(cacheKey, blobUrl);
              blobUrls.set(texFile, blobUrl);
            }
          } catch { /* non-fatal */ }
        }
      }

      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url: string) => {
        const filename = url.split('/').pop()?.split('\\').pop() || url;
        return blobUrls.get(filename) || url;
      });

      const mtlLoader = new MTLLoader(manager);
      materials = mtlLoader.parse(mtlContent, '');

      await new Promise<void>((resolve) => {
        manager.onLoad = () => resolve();
        manager.onError = () => {};
        materials!.preload();
        setTimeout(resolve, BATCH.TEXTURE_TIMEOUT_MS);
      });
    }
  }

  const objLoader = new OBJLoader();
  if (materials) objLoader.setMaterials(materials);
  return objLoader.parse(objText);
}
