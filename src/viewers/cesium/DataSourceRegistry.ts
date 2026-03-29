/**
 * DataSourceRegistry — Manages Cesium DataSource objects (GeoJSON, KML).
 * Provides visibility, symbology, and lifecycle management.
 */

import { type DataSource, Color } from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import type { LayerSymbology } from '../../types/symbology';

const registry = new Map<string, DataSource>();

export function registerDataSource(layerId: string, dataSource: DataSource): void {
  registry.set(layerId, dataSource);
}

export function getDataSource(layerId: string): DataSource | undefined {
  return registry.get(layerId);
}

export function setDataSourceVisibility(layerId: string, visible: boolean): void {
  const ds = registry.get(layerId);
  if (ds) {
    ds.show = visible;
    const viewer = getCesiumViewer();
    if (viewer) viewer.scene.requestRender();
  }
}

export function setDataSourceSymbology(layerId: string, symbology: LayerSymbology): void {
  const ds = registry.get(layerId);
  if (!ds) return;

  const isOverride = symbology.color.toUpperCase() !== '#FFFFFF';
  const overrideColor = isOverride
    ? Color.fromCssColorString(symbology.color).withAlpha(symbology.opacity)
    : null;

  const entities = ds.entities.values;
  for (const entity of entities) {
    if (entity.polyline) {
      if (overrideColor) {
        (entity.polyline.material as any) = overrideColor;
      }
      (entity.polyline.width as any) = symbology.lineWidth;
    }
    if (entity.polygon && overrideColor) {
      (entity.polygon.material as any) = overrideColor.withAlpha(symbology.opacity * 0.3);
      (entity.polygon.outlineColor as any) = overrideColor;
    }
    if (entity.point) {
      if (overrideColor) (entity.point.color as any) = overrideColor;
      (entity.point.pixelSize as any) = symbology.pointSize;
    }
    if (entity.billboard && overrideColor) {
      entity.billboard.color = overrideColor as any;
    }
  }

  const viewer = getCesiumViewer();
  if (viewer) viewer.scene.requestRender();
}

export function removeDataSource(layerId: string): void {
  const ds = registry.get(layerId);
  if (ds) {
    const viewer = getCesiumViewer();
    if (viewer) {
      viewer.dataSources.remove(ds, true);
      viewer.scene.requestRender();
    }
    registry.delete(layerId);
  }
}

export function getDataSourceEntityCount(layerId: string): number {
  const ds = registry.get(layerId);
  return ds ? ds.entities.values.length : 0;
}
