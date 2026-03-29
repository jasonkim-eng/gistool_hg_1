/**
 * ModelLoader — Loads individual OBJ/FBX model files.
 * Uses shared utilities for material conversion, texture handling, and geo-ref parsing.
 * Delegates Cesium operations to CesiumAdapter.
 */

import * as THREE from 'three';
import { Cartesian3 } from 'cesium';

// Format-specific loaders are lazy-imported inside parseWithThreeJS
// to reduce initial bundle size (~200KB saved on startup)

import {
  parseWGS84Origin,
  extractTextureFilenames,
  loadSiblingFile,
  mimeFromExt,
  prepareForExport,
  exportToGLB,
} from './shared';
import { addModel, flyTo } from '../viewers/cesium/CesiumAdapter';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { useLayerStore, type LayerItem } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import { DEFAULT_GEO, MODEL_DEFAULTS } from '../config/defaults';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';

let idCounter = 0;
function generateId(): string {
  return `layer_${Date.now()}_${++idCounter}`;
}

/**
 * Parse buffer with the appropriate Three.js loader.
 */
async function parseWithThreeJS(
  buffer: ArrayBuffer,
  ext: string,
  objText: string,
  baseDir: string,
): Promise<THREE.Group> {
  if (ext === '.obj') {
    return parseOBJWithMaterials(objText, baseDir);
  } else if (ext === '.fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    return new Promise((resolve, reject) => {
      try {
        resolve(new FBXLoader().parse(buffer, ''));
      } catch (err) {
        reject(err);
      }
    });
  } else if (ext === '.3ds') {
    const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
    return new TDSLoader().parse(buffer, '');
  } else if (ext === '.ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const geometry = new PLYLoader().parse(buffer);
    const hasVertexColors = geometry.hasAttribute('color');
    const material = new THREE.MeshStandardMaterial({
      color: MODEL_DEFAULTS.DEFAULT_MATERIAL_COLOR,
      vertexColors: hasVertexColors,
      metalness: MODEL_DEFAULTS.DEFAULT_METALNESS,
      roughness: MODEL_DEFAULTS.DEFAULT_ROUGHNESS,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  } else if (ext === '.stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const geometry = new STLLoader().parse(buffer);
    const material = new THREE.MeshStandardMaterial({
      color: MODEL_DEFAULTS.DEFAULT_MATERIAL_COLOR,
      metalness: MODEL_DEFAULTS.DEFAULT_METALNESS,
      roughness: MODEL_DEFAULTS.DEFAULT_ROUGHNESS,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  } else {
    throw new Error(`Unsupported format: ${ext}`);
  }
}

/**
 * Parse OBJ with MTL materials and textures from the same directory.
 */
async function parseOBJWithMaterials(objText: string, baseDir: string): Promise<THREE.Group> {
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
  const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');

  const mtlMatch = objText.match(/^\s*mtllib\s+(.+)$/m);
  let materials: any = null;

  if (mtlMatch && window.api?.file) {
    const mtlFilename = mtlMatch[1].trim();
    try {
      const mtlContent = await loadSiblingFile(baseDir, mtlFilename, false);
      if (mtlContent && typeof mtlContent === 'string') {
        const textureFilenames = extractTextureFilenames(mtlContent);

        const textureBlobUrls = new Map<string, string>();
        for (const texFile of textureFilenames) {
          try {
            const texData = await loadSiblingFile(baseDir, texFile, true);
            if (texData && texData instanceof ArrayBuffer) {
              const blob = new Blob([texData], { type: mimeFromExt(texFile) });
              textureBlobUrls.set(texFile, URL.createObjectURL(blob));
            }
          } catch (err) {
            console.warn(`[ModelLoader] Failed to read texture: ${texFile}`, err);
          }
        }

        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url: string) => {
          const filename = url.split('/').pop()?.split('\\').pop() || url;
          return textureBlobUrls.get(filename) || url;
        });

        const mtlLoader = new MTLLoader(manager);
        materials = mtlLoader.parse(mtlContent, '');

        await new Promise<void>((resolve) => {
          manager.onLoad = () => resolve();
          manager.onError = () => {};
          materials!.preload();
          setTimeout(resolve, 3000);
        });
      }
    } catch (err) {
      console.warn(`[ModelLoader] Failed to load MTL: ${mtlMatch[1].trim()}`, err);
    }
  }

  const objLoader = new OBJLoader();
  if (materials) objLoader.setMaterials(materials);
  return objLoader.parse(objText);
}

/**
 * Load a single model file (OBJ/FBX) into the Cesium scene.
 */
export async function loadModelFile(
  filePath: string,
  buffer: ArrayBuffer,
  fileExt: string,
): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
  const type = fileExt.replace('.', '').toUpperCase() as LayerItem['type'];
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const baseDir = lastSep >= 0 ? filePath.substring(0, lastSep) : '.';

  useViewerStore.getState().setStatusMessage(`Loading ${fileName}...`);

  try {
    const objText = fileExt === '.obj' ? new TextDecoder().decode(buffer) : '';
    const geoRef = fileExt === '.obj' ? parseWGS84Origin(objText) : null;

    useViewerStore.getState().setStatusMessage(`Parsing ${fileName}...`);
    const threeScene = await parseWithThreeJS(buffer, fileExt, objText, baseDir);

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(threeScene);
    const size = box.getSize(new THREE.Vector3());

    const wrapper = new THREE.Group();

    // For Z-up formats: convert Z-up → Y-up (glTF/Cesium convention)
    const zUpFormats = ['.obj', '.3ds', '.ply', '.stl'];
    if (zUpFormats.includes(fileExt)) {
      threeScene.rotation.x = -Math.PI / 2;
      threeScene.updateMatrixWorld(true);
      const rotatedBox = new THREE.Box3().setFromObject(threeScene);
      const rotatedCenter = rotatedBox.getCenter(new THREE.Vector3());
      const rotatedSize = rotatedBox.getSize(new THREE.Vector3());
      threeScene.position.set(-rotatedCenter.x, -rotatedCenter.y, -rotatedCenter.z);
      wrapper.add(threeScene);
      size.copy(rotatedSize);
    } else {
      const center = box.getCenter(new THREE.Vector3());
      threeScene.position.set(-center.x, -center.y, -center.z);
      wrapper.add(threeScene);
    }

    const maxDim = Math.max(size.x, size.y, size.z);
    wrapper.updateMatrixWorld(true);

    useViewerStore.getState().setStatusMessage(`Converting ${fileName} to glTF...`);
    await prepareForExport(wrapper);

    const glbBuffer = await exportToGLB(wrapper);

    const modelLon = geoRef?.lon ?? DEFAULT_GEO.MODEL_LON;
    const modelLat = geoRef?.lat ?? DEFAULT_GEO.MODEL_LAT;
    const modelAlt = geoRef?.alt ?? DEFAULT_GEO.MODEL_ALT;

    useViewerStore.getState().setStatusMessage(`Rendering ${fileName}...`);

    await addModel({
      layerId,
      glbBuffer,
      lon: modelLon,
      lat: modelLat,
      alt: modelAlt,
      minimumPixelSize: MODEL_DEFAULTS.MINIMUM_PIXEL_SIZE,
      maximumScale: MODEL_DEFAULTS.MAXIMUM_SCALE,
    });

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type,
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [modelLon, modelLat, modelAlt],
    });

    const flyAlt = Math.max(maxDim * 3, 200);
    flyTo(modelLon, modelLat, modelAlt + flyAlt);

    useViewerStore.getState().setStatusMessage(`✓ ${fileName} loaded successfully`);
    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || 'Unknown error';
    useViewerStore.getState().setStatusMessage(`✗ Failed: ${fileName}: ${errorMsg}`);
    console.error('Model load error:', err);
    return { layerId, success: false, error: errorMsg };
  }
}

/**
 * Fly camera to a specific layer.
 */
export function flyToLayer(layerId: string): void {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (layer?.center) {
    flyTo(
      layer.center[0],
      layer.center[1],
      layer.center[2] + DEFAULT_GEO.FLY_OFFSET_ALT,
    );
  }
}

/**
 * ModelFileLoader — IFileLoader implementation for OBJ/FBX files.
 */
export const modelFileLoader: IFileLoader = {
  supportedExtensions: ['.obj', '.fbx', '.gltf', '.glb', '.3ds', '.ply', '.stl'],
  formatName: '3D Models',
  async load(filePath: string, buffer: ArrayBuffer | null): Promise<LoadResult> {
    if (!buffer) return { layerId: '', success: false, error: 'No buffer provided' };
    const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '');
    return loadModelFile(filePath, buffer, ext);
  },
};
