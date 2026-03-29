/**
 * useCesiumSync — Subscribes to Zustand layer store changes and
 * pushes visibility + symbology state to Cesium.
 */

import { useEffect, useRef } from 'react';
import { useLayerStore, type LayerItem } from '../stores/useLayerStore';
import type { LayerSymbology } from '../types/symbology';
import { setModelVisibility, setModelSymbology } from '../viewers/cesium/CesiumModelRegistry';
import { setImageryVisibility, setImagerySymbology } from '../viewers/cesium/CesiumImageryRegistry';
import { setDxfVisibility, setDxfSymbology } from '../loaders/DxfLoader';
import { setShpVisibility, setShpSymbology } from '../loaders/ShapefileLoader';

export function useCesiumSync(): void {
  const layers = useLayerStore((s) => s.layers);
  const prevLayersRef = useRef<LayerItem[]>([]);

  useEffect(() => {
    const prevLayers = prevLayersRef.current;
    const prevMap = new Map(prevLayers.map((l) => [l.id, l]));

    for (const layer of layers) {
      const prev = prevMap.get(layer.id);
      if (!prev || prev.visible !== layer.visible) {
        if (layer.cesiumId) syncVisibility(layer);
      }
      if (prev && prev.symbology !== layer.symbology && layer.symbology && layer.cesiumId) {
        syncSymbology(layer, layer.symbology);
      }
    }

    prevLayersRef.current = layers;
  }, [layers]);
}

function syncVisibility(layer: LayerItem): void {
  switch (layer.type) {
    case 'GEOTIFF':
      setImageryVisibility(layer.cesiumId!, layer.visible);
      break;
    case 'DXF':
      setDxfVisibility(layer.cesiumId!, layer.visible);
      break;
    case 'SHP':
      setShpVisibility(layer.cesiumId!, layer.visible);
      break;
    default:
      setModelVisibility(layer.cesiumId!, layer.visible);
      break;
  }
}

function syncSymbology(layer: LayerItem, symbology: LayerSymbology): void {
  switch (layer.type) {
    case 'GEOTIFF':
      setImagerySymbology(layer.cesiumId!, symbology);
      break;
    case 'DXF':
      setDxfSymbology(layer.cesiumId!, symbology);
      break;
    case 'SHP':
      setShpSymbology(layer.cesiumId!, symbology);
      break;
    default:
      setModelSymbology(layer.cesiumId!, symbology);
      break;
  }
}
