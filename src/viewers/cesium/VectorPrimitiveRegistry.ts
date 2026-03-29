/**
 * VectorPrimitiveRegistry — Manages batched PolylineCollection and
 * PointPrimitiveCollection primitives for DXF/SHP layers.
 *
 * Instead of creating individual Cesium entities (slow at 100k+),
 * this batches all polylines/points per layer into a single GPU primitive.
 * Result: ~100x fewer draw calls, dramatically better FPS.
 */

import {
  PolylineCollection,
  PointPrimitiveCollection,
  Material,
  Color,
  Cartesian3,
  type Polyline,
  type PointPrimitive,
} from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import type { LayerSymbology } from '../../types/symbology';

interface VectorLayer {
  polylines: PolylineCollection;
  points: PointPrimitiveCollection;
}

const registry = new Map<string, VectorLayer>();

/**
 * Create a new vector layer with empty primitive collections.
 * Call this once per DXF/SHP layer before adding geometries.
 */
export function createVectorLayer(layerId: string): VectorLayer {
  const viewer = getCesiumViewer();
  if (!viewer) throw new Error('Viewer not available');

  // Remove existing if present
  removeVectorLayer(layerId);

  const polylines = new PolylineCollection();
  const points = new PointPrimitiveCollection();

  viewer.scene.primitives.add(polylines);
  viewer.scene.primitives.add(points);

  const layer: VectorLayer = { polylines, points };
  registry.set(layerId, layer);
  return layer;
}

/**
 * Add a polyline to a vector layer's collection.
 */
export function addPolyline(
  layerId: string,
  positions: Cartesian3[],
  color: Color,
  width: number,
): Polyline | null {
  const layer = registry.get(layerId);
  if (!layer || positions.length < 2) return null;

  return layer.polylines.add({
    positions,
    width,
    material: Material.fromType('Color', { color }),
  });
}

/**
 * Add a point to a vector layer's collection.
 */
export function addPoint(
  layerId: string,
  position: Cartesian3,
  color: Color,
  pixelSize: number,
): PointPrimitive | null {
  const layer = registry.get(layerId);
  if (!layer) return null;

  return layer.points.add({
    position,
    color,
    pixelSize,
    outlineColor: Color.BLACK,
    outlineWidth: 1,
  });
}

/**
 * Set visibility for a vector layer.
 */
export function setVectorVisibility(layerId: string, visible: boolean): void {
  const layer = registry.get(layerId);
  if (!layer) return;
  layer.polylines.show = visible;
  layer.points.show = visible;
  const viewer = getCesiumViewer();
  if (viewer) viewer.scene.requestRender();
}

/**
 * Apply symbology changes to a vector layer.
 */
export function setVectorSymbology(layerId: string, symbology: LayerSymbology): void {
  const layer = registry.get(layerId);
  if (!layer) return;

  const isOverride = symbology.color.toUpperCase() !== '#FFFFFF';

  // Update polylines
  for (let i = 0; i < layer.polylines.length; i++) {
    const pl = layer.polylines.get(i);
    pl.width = symbology.lineWidth;
    if (isOverride) {
      pl.material = Material.fromType('Color', {
        color: Color.fromCssColorString(symbology.color).withAlpha(symbology.opacity),
      });
    }
  }

  // Update points
  for (let i = 0; i < layer.points.length; i++) {
    const pt = layer.points.get(i);
    pt.pixelSize = symbology.pointSize;
    if (isOverride) {
      pt.color = Color.fromCssColorString(symbology.color).withAlpha(symbology.opacity);
    }
  }

  const viewer = getCesiumViewer();
  if (viewer) viewer.scene.requestRender();
}

/**
 * Remove and destroy a vector layer's primitives.
 */
export function removeVectorLayer(layerId: string): void {
  const layer = registry.get(layerId);
  if (!layer) return;

  const viewer = getCesiumViewer();
  if (viewer) {
    viewer.scene.primitives.remove(layer.polylines);
    viewer.scene.primitives.remove(layer.points);
    viewer.scene.requestRender();
  }

  registry.delete(layerId);
}

/**
 * Get polyline/point counts for a layer.
 */
export function getVectorStats(layerId: string): { polylines: number; points: number } | null {
  const layer = registry.get(layerId);
  if (!layer) return null;
  return { polylines: layer.polylines.length, points: layer.points.length };
}
