/**
 * Texture extraction, blob URL caching, and cleanup utilities.
 * Shared between ModelLoader and BatchLoader.
 */

import * as THREE from 'three';

/**
 * Extract all texture filenames referenced in an MTL file.
 * Handles map_Kd, map_Ka, map_Ks, map_Bump, bump, map_d, map_Ns.
 */
export function extractTextureFilenames(mtlContent: string): string[] {
  const filenames = new Set<string>();
  const patterns = [
    /map_Kd\s+(.+)/gi,
    /map_Ka\s+(.+)/gi,
    /map_Ks\s+(.+)/gi,
    /map_Bump\s+(.+)/gi,
    /bump\s+(.+)/gi,
    /map_d\s+(.+)/gi,
    /map_Ns\s+(.+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(mtlContent)) !== null) {
      const filename = match[1].trim();
      if (filename) filenames.add(filename);
    }
  }
  return Array.from(filenames);
}

/**
 * Validate and sanitize a texture for GLTFExporter compatibility.
 * GLTFExporter only supports: HTMLCanvasElement, OffscreenCanvas, or ImageBitmap.
 * If the image is a loaded HTMLImageElement, convert to canvas.
 * If invalid/unloaded, return null (strip the texture).
 */
export function sanitizeTextureForExport(texture: THREE.Texture | null): THREE.Texture | null {
  if (!texture || !texture.image) return null;

  const img = texture.image;

  // Already a canvas — GLTFExporter can handle this directly
  if (img instanceof HTMLCanvasElement || img instanceof OffscreenCanvas) {
    return texture;
  }

  // ImageBitmap — GLTFExporter supports this
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    return texture;
  }

  // HTMLImageElement — only valid if fully loaded with dimensions
  if (img instanceof HTMLImageElement) {
    if (img.naturalWidth > 0 && img.naturalHeight > 0 && img.complete) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const canvasTex = new THREE.CanvasTexture(canvas);
        canvasTex.flipY = texture.flipY;
        canvasTex.colorSpace = texture.colorSpace;
        canvasTex.needsUpdate = true;
        return canvasTex;
      }
    }
    console.warn('[textureUtils] Stripping unloaded texture:', img.src?.substring(0, 80));
    return null;
  }

  // DataTexture or other typed array textures
  const anyImg = img as any;
  if (anyImg.data && anyImg.width && anyImg.height) {
    return texture;
  }

  console.warn('[textureUtils] Stripping unsupported texture type:', typeof img);
  return null;
}

/**
 * Load a sibling file from the same directory using Electron IPC.
 */
export async function loadSiblingFile(
  baseDir: string,
  filename: string,
  asBinary: boolean,
): Promise<ArrayBuffer | string | null> {
  if (!window.api?.file) return null;
  const sep = baseDir.includes('/') ? '/' : '\\';
  const fullPath = `${baseDir}${sep}${filename}`;

  if (asBinary) {
    return window.api.file.readBinary(fullPath);
  } else {
    return window.api.file.readText(fullPath);
  }
}

/**
 * Determine MIME type from file extension.
 */
export function mimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}
