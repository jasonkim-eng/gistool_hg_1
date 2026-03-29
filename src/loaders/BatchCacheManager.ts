/**
 * BatchCacheManager — Texture and MTL caching for batch loading.
 * Manages blob URL lifecycle with guaranteed cleanup.
 */

import { extractTextureFilenames, mimeFromExt } from './shared';

/** Raw texture blob URLs keyed by `baseDir/filename` */
let textureCache = new Map<string, string>();
/** MTL file content cache keyed by MTL filename */
let mtlContentCache = new Map<string, string>();
/** Texture blob URLs keyed by texture filename (for LoadingManager redirect) */
let textureBlobUrlCache = new Map<string, string>();

export function getTextureCache(): Map<string, string> {
  return textureCache;
}

export function getMtlContentCache(): Map<string, string> {
  return mtlContentCache;
}

export function getTextureBlobUrlCache(): Map<string, string> {
  return textureBlobUrlCache;
}

/**
 * Pre-read MTL and all referenced textures from the first OBJ file.
 * Creates blob URLs and populates caches for reuse across the batch.
 */
export async function prewarmTextureCache(
  firstObjPath: string,
  baseDir: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const api = window.api.file;
    const objText = await api.readText(firstObjPath);
    if (!objText) return;

    const mtlMatch = objText.match(/^\s*mtllib\s+(.+)$/m);
    if (!mtlMatch) return;

    const mtlFilename = mtlMatch[1].trim();
    const sep = baseDir.includes('/') ? '/' : '\\';
    const mtlPath = `${baseDir}${sep}${mtlFilename}`;

    const mtlContent = await api.readText(mtlPath);
    if (!mtlContent) return;
    mtlContentCache.set(mtlFilename, mtlContent);

    const textureFilenames = extractTextureFilenames(mtlContent);
    console.log(`[BatchCache] Pre-warming ${textureFilenames.length} textures...`);

    const texturePromises = textureFilenames.map(async (texFile) => {
      if (signal.aborted) return;
      try {
        const texData = await api.readBinary(`${baseDir}${sep}${texFile}`);
        if (texData && texData instanceof ArrayBuffer) {
          const blob = new Blob([texData], { type: mimeFromExt(texFile) });
          const blobUrl = URL.createObjectURL(blob);
          const cacheKey = `${baseDir}/${texFile}`;
          textureCache.set(cacheKey, blobUrl);
          textureBlobUrlCache.set(texFile, blobUrl);
        }
      } catch { /* non-fatal */ }
    });

    await Promise.all(texturePromises);
  } catch {
    console.warn('[BatchCache] Pre-warm failed (non-fatal)');
  }
}

/**
 * Revoke all texture blob URLs and clear all caches.
 * Must be called when a batch completes or is cancelled.
 */
export function clearAllCaches(): void {
  for (const url of textureCache.values()) {
    URL.revokeObjectURL(url);
  }
  textureCache.clear();
  mtlContentCache.clear();
  textureBlobUrlCache.clear();
}

/**
 * Reset caches for a new batch.
 */
export function resetCaches(): void {
  clearAllCaches();
  textureCache = new Map();
  mtlContentCache = new Map();
  textureBlobUrlCache = new Map();
}
