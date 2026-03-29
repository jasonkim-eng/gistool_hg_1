/**
 * KmlLoader — Loads KML and KMZ files using Cesium KmlDataSource.
 * KML: XML-based geospatial format (Google Earth).
 * KMZ: ZIP archive containing KML + assets.
 * Always WGS84 — no CRS transform needed.
 */

import { KmlDataSource } from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { requestRender } from '../viewers/cesium/CesiumAdapter';
import { registerDataSource, removeDataSource, setDataSourceVisibility, setDataSourceSymbology } from '../viewers/cesium/DataSourceRegistry';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';
import type { LayerSymbology } from '../types/symbology';

let idCounter = 0;
function generateId(): string {
  return `kml_${Date.now()}_${++idCounter}`;
}

export async function loadKmlFile(filePath: string, buffer: ArrayBuffer): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.kml';
  const ext = fileName.split('.').pop()?.toLowerCase() || 'kml';
  const status = (msg: string) => useViewerStore.getState().setStatusMessage(msg);

  status(`${fileName} 로딩 중...`);

  try {
    const viewer = getCesiumViewer();
    if (!viewer) throw new Error('CesiumJS viewer not initialized');

    // Create Blob URL from buffer for KmlDataSource
    const mimeType = ext === 'kmz'
      ? 'application/vnd.google-earth.kmz'
      : 'application/vnd.google-earth.kml+xml';
    const blob = new Blob([buffer], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    status(`${fileName}: KML 구조 파싱 중...`);

    let dataSource: KmlDataSource;
    try {
      dataSource = await KmlDataSource.load(blobUrl, {
        camera: viewer.scene.camera,
        canvas: viewer.scene.canvas,
        clampToGround: false,
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    viewer.dataSources.add(dataSource);
    registerDataSource(layerId, dataSource);
    requestRender();

    const entityCount = dataSource.entities.values.length;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'KML',
      visible: true,
      filePath,
      cesiumId: layerId,
    });

    // Fly to extent
    if (entityCount > 0) {
      viewer.flyTo(dataSource, { duration: 1.5 });
    }

    status(`✓ ${fileName} 로드 완료 (${entityCount.toLocaleString()}개 엔티티)`);
    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    status(`✗ ${fileName} 실패: ${errorMsg}`);
    console.error('[KmlLoader] Error:', err);
    return { layerId, success: false, error: errorMsg };
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function setKmlVisibility(layerId: string, visible: boolean): void {
  setDataSourceVisibility(layerId, visible);
}

export function setKmlSymbology(layerId: string, symbology: LayerSymbology): void {
  setDataSourceSymbology(layerId, symbology);
}

export function removeKmlEntities(layerId: string): void {
  removeDataSource(layerId);
}

// ─── IFileLoader ────────────────────────────────────────────────────────────

export const kmlFileLoader: IFileLoader = {
  supportedExtensions: ['.kml', '.kmz'],
  formatName: 'KML / KMZ',
  async load(filePath: string, buffer: ArrayBuffer | null): Promise<LoadResult> {
    if (!buffer) {
      buffer = await window.api.file.readBinary(filePath) as ArrayBuffer;
      if (!buffer) return { layerId: '', success: false, error: 'Failed to read file' };
    }
    return loadKmlFile(filePath, buffer);
  },
};
