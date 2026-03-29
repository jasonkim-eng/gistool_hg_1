import { ImageryLayer } from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import type { LayerSymbology } from '../../types/symbology';

/**
 * Registry mapping layer IDs to CesiumJS ImageryLayer instances.
 * Used for visibility toggling, opacity control, and cleanup.
 */
const imageryMap = new Map<string, ImageryLayer>();

export function registerImagery(layerId: string, layer: ImageryLayer): void {
  imageryMap.set(layerId, layer);
}

export function getImageryLayer(layerId: string): ImageryLayer | undefined {
  return imageryMap.get(layerId);
}

export function setImageryVisibility(layerId: string, visible: boolean): void {
  const layer = imageryMap.get(layerId);
  if (layer) {
    layer.show = visible;
    const viewer = getCesiumViewer();
    if (viewer) {
      // Also sync bounding box entity visibility
      const bboxEntity = viewer.entities.getById(`${layerId}_bbox`);
      if (bboxEntity) bboxEntity.show = visible;
      viewer.scene.requestRender();
    }
  }
}

export function setImagerySymbology(layerId: string, symbology: LayerSymbology): void {
  const layer = imageryMap.get(layerId);
  if (layer) {
    layer.alpha = symbology.opacity;
    const viewer = getCesiumViewer();
    if (viewer) viewer.scene.requestRender();
  }
}

export function removeImagery(layerId: string): void {
  const layer = imageryMap.get(layerId);
  if (layer) {
    const viewer = getCesiumViewer();
    if (viewer) {
      viewer.imageryLayers.remove(layer, true);
      // Also remove bounding box entity
      const bboxEntity = viewer.entities.getById(`${layerId}_bbox`);
      if (bboxEntity) viewer.entities.remove(bboxEntity);
      viewer.scene.requestRender();
    }
    imageryMap.delete(layerId);
  }
}
