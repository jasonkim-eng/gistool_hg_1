/**
 * CesiumAdapter — Abstraction layer over Cesium viewer operations.
 * Loaders call this adapter instead of importing Cesium directly.
 * This decouples file loading logic from the specific 3D engine.
 */

import {
  Cartesian3,
  Transforms,
  Model,
  HeadingPitchRoll,
  ImageryLayer,
  SingleTileImageryProvider,
  Rectangle,
  Color,
  Entity,
} from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import { registerModel, unregisterModel, setModelVisibility, setGroupVisibility } from './CesiumModelRegistry';
import { registerImagery, setImageryVisibility, removeImagery } from './CesiumImageryRegistry';
import { DEFAULT_GEO } from '../../config/defaults';

export interface ModelLoadOptions {
  layerId: string;
  glbBuffer: ArrayBuffer;
  lon: number;
  lat: number;
  alt: number;
  scale?: number;
  minimumPixelSize?: number;
  maximumScale?: number;
  show?: boolean;
}

export interface ImageryLoadOptions {
  layerId: string;
  url: string;
  west: number;
  south: number;
  east: number;
  north: number;
  alpha?: number;
}

/**
 * Load a GLB model into the Cesium scene.
 * Returns the Cesium Model instance.
 */
export async function addModel(opts: ModelLoadOptions): Promise<Model> {
  const viewer = getCesiumViewer();
  if (!viewer) throw new Error('CesiumJS viewer not initialized');

  const position = Cartesian3.fromDegrees(opts.lon, opts.lat, opts.alt);
  const hpr = new HeadingPitchRoll(0, 0, 0);
  const modelMatrix = Transforms.headingPitchRollToFixedFrame(position, hpr);

  const blob = new Blob([opts.glbBuffer], { type: 'model/gltf-binary' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const model = await Model.fromGltfAsync({
      url: blobUrl,
      modelMatrix,
      scale: opts.scale ?? 1.0,
      minimumPixelSize: opts.minimumPixelSize ?? 0,
      maximumScale: opts.maximumScale,
      allowPicking: true,
      show: opts.show ?? true,
    });

    viewer.scene.primitives.add(model);
    registerModel(opts.layerId, model);
    viewer.scene.requestRender();

    return model;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Remove a model from the Cesium scene.
 */
export function removeModel(layerId: string): void {
  unregisterModel(layerId, true);
}

/**
 * Set model visibility.
 */
export { setModelVisibility, setGroupVisibility };

/**
 * Add an imagery layer to the Cesium scene.
 */
export async function addImagery(opts: ImageryLoadOptions): Promise<ImageryLayer> {
  const viewer = getCesiumViewer();
  if (!viewer) throw new Error('CesiumJS viewer not initialized');

  const rectangle = Rectangle.fromDegrees(opts.west, opts.south, opts.east, opts.north);
  const imageryProvider = await SingleTileImageryProvider.fromUrl(opts.url, { rectangle });
  const imageryLayer = new ImageryLayer(imageryProvider, { alpha: opts.alpha ?? 1.0 });

  viewer.imageryLayers.add(imageryLayer);
  registerImagery(opts.layerId, imageryLayer);
  viewer.scene.requestRender();

  return imageryLayer;
}

/**
 * Set imagery layer visibility.
 */
export { setImageryVisibility, removeImagery };

/**
 * Add a bounding box polyline entity.
 */
export function addBoundingBox(
  entityId: string,
  name: string,
  west: number,
  south: number,
  east: number,
  north: number,
  color: Color = Color.RED,
  width = 3,
): Entity | null {
  const viewer = getCesiumViewer();
  if (!viewer) return null;

  const corners = Cartesian3.fromDegreesArray([
    west, south,
    east, south,
    east, north,
    west, north,
    west, south,
  ]);

  return viewer.entities.add({
    id: entityId,
    name,
    polyline: {
      positions: corners,
      width,
      material: color,
      clampToGround: true,
    },
  });
}

/**
 * Remove entities by ID prefix.
 */
export function removeEntitiesByPrefix(prefix: string): void {
  const viewer = getCesiumViewer();
  if (!viewer) return;

  const toRemove: Entity[] = [];
  for (const entity of viewer.entities.values) {
    if (entity.id && entity.id.startsWith(prefix)) {
      toRemove.push(entity);
    }
  }
  for (const entity of toRemove) {
    viewer.entities.remove(entity);
  }
  if (toRemove.length > 0) viewer.scene.requestRender();
}

/**
 * Fly camera to a position.
 */
export function flyTo(
  lon: number,
  lat: number,
  alt: number,
  duration = DEFAULT_GEO.FLY_DURATION,
): void {
  const viewer = getCesiumViewer();
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat, alt),
    duration,
  });
}

/**
 * Request a scene render.
 */
export function requestRender(): void {
  const viewer = getCesiumViewer();
  if (viewer) viewer.scene.requestRender();
}
