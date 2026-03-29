/**
 * Material conversion utilities for Three.js → glTF export pipeline.
 * Converts MeshPhongMaterial / MeshBasicMaterial to MeshStandardMaterial
 * and sanitizes textures for GLTFExporter compatibility.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { sanitizeTextureForExport } from './textureUtils';
import { MODEL_DEFAULTS } from '../../config/defaults';

/**
 * Convert all materials in a scene to MeshStandardMaterial and sanitize textures.
 * Mutates the scene in-place.
 */
export function prepareForExport(scene: THREE.Object3D): void {
  const processedMaterials = new Map<string, THREE.MeshStandardMaterial>();

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const srcMat = child.material as THREE.Material;
    if (!srcMat) {
      child.material = new THREE.MeshStandardMaterial({
        color: MODEL_DEFAULTS.DEFAULT_MATERIAL_COLOR,
        metalness: MODEL_DEFAULTS.DEFAULT_METALNESS,
        roughness: MODEL_DEFAULTS.DEFAULT_ROUGHNESS,
        side: THREE.DoubleSide,
      });
      return;
    }

    if (processedMaterials.has(srcMat.uuid)) {
      child.material = processedMaterials.get(srcMat.uuid)!;
      return;
    }

    if (srcMat.type === 'MeshStandardMaterial') {
      const stdMat = srcMat as THREE.MeshStandardMaterial;
      stdMat.map = sanitizeTextureForExport(stdMat.map);
      stdMat.needsUpdate = true;
      return;
    }

    const phong = srcMat as THREE.MeshPhongMaterial;
    const stdMat = new THREE.MeshStandardMaterial({
      color: phong.color || new THREE.Color(MODEL_DEFAULTS.DEFAULT_MATERIAL_COLOR),
      map: sanitizeTextureForExport(phong.map),
      metalness: MODEL_DEFAULTS.DEFAULT_METALNESS,
      roughness: MODEL_DEFAULTS.DEFAULT_ROUGHNESS,
      side: THREE.DoubleSide,
      transparent: phong.transparent || false,
      opacity: phong.opacity ?? 1.0,
    });

    processedMaterials.set(srcMat.uuid, stdMat);
    child.material = stdMat;
  });
}

/**
 * Export Three.js scene to GLB binary buffer.
 */
export async function exportToGLB(scene: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          const json = JSON.stringify(result);
          resolve(new TextEncoder().encode(json).buffer);
        }
      },
      (error) => reject(error),
      { binary: true },
    );
  });
}

/**
 * Dispose all geometries and materials in a Three.js scene to free GPU memory.
 */
export function disposeThreeScene(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      } else if (mat) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
}
