/**
 * Per-layer symbology settings for visual styling control.
 */

import type { LayerType } from '../stores/useLayerStore';

export interface LayerSymbology {
  /** Stroke/fill color override (CSS hex). '#FFFFFF' = no override (keep original). */
  color: string;
  /** Opacity 0.0–1.0 */
  opacity: number;
  /** Polyline width in pixels (DXF/SHP) */
  lineWidth: number;
  /** Point size in pixels (DXF/SHP) */
  pointSize: number;
}

const DEFAULTS: Record<string, LayerSymbology> = {
  MODEL: { color: '#FFFFFF', opacity: 1.0, lineWidth: 1.5, pointSize: 4 },
  GEOTIFF: { color: '#FFFFFF', opacity: 1.0, lineWidth: 1.5, pointSize: 4 },
  VECTOR: { color: '#FFFFFF', opacity: 1.0, lineWidth: 1.5, pointSize: 4 },
  POINTCLOUD: { color: '#FFFFFF', opacity: 1.0, lineWidth: 1.5, pointSize: 2 },
};

export function getDefaultSymbology(type: LayerType): LayerSymbology {
  switch (type) {
    case 'GEOTIFF':
      return { ...DEFAULTS.GEOTIFF };
    case 'DXF':
    case 'SHP':
    case 'GEOJSON':
    case 'KML':
      return { ...DEFAULTS.VECTOR };
    case 'LAS':
      return { ...DEFAULTS.POINTCLOUD };
    default:
      return { ...DEFAULTS.MODEL };
  }
}
