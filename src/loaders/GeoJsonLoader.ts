/**
 * GeoJsonLoader — Loads GeoJSON files using Cesium GeoJsonDataSource.
 * Supports Point, LineString, Polygon, Multi* variants, and FeatureCollection.
 * GeoJSON is always WGS84 (EPSG:4326) — no CRS transform needed.
 */

import { GeoJsonDataSource, Color, Cartographic, Math as CesiumMath } from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { flyTo, requestRender } from '../viewers/cesium/CesiumAdapter';
import { registerDataSource, removeDataSource, setDataSourceVisibility, setDataSourceSymbology } from '../viewers/cesium/DataSourceRegistry';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';
import type { LayerSymbology } from '../types/symbology';

let idCounter = 0;
function generateId(): string {
  return `geojson_${Date.now()}_${++idCounter}`;
}

export async function loadGeoJsonFile(filePath: string, buffer: ArrayBuffer): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.geojson';
  const status = (msg: string) => useViewerStore.getState().setStatusMessage(msg);

  status(`${fileName} 로딩 중...`);

  try {
    const viewer = getCesiumViewer();
    if (!viewer) throw new Error('CesiumJS viewer not initialized');

    // Parse JSON
    const text = new TextDecoder('utf-8').decode(buffer);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('유효하지 않은 JSON 형식입니다');
    }

    // Validate GeoJSON structure
    if (!json.type || !['FeatureCollection', 'Feature', 'Point', 'LineString', 'Polygon',
      'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'].includes(json.type)) {
      throw new Error('유효하지 않은 GeoJSON 형식입니다');
    }

    // Count features for warning
    const featureCount = json.type === 'FeatureCollection' ? (json.features?.length || 0) : 1;
    if (featureCount > 5000) {
      status(`${fileName}: ${featureCount.toLocaleString()}개 피처 로딩 중 (대용량 — 시간이 걸릴 수 있습니다)...`);
    } else {
      status(`${fileName}: ${featureCount.toLocaleString()}개 피처 로딩 중...`);
    }

    // Load via Cesium DataSource
    const dataSource = await GeoJsonDataSource.load(json, {
      clampToGround: false,
      stroke: Color.CYAN,
      fill: Color.CYAN.withAlpha(0.2),
      strokeWidth: 2,
    });

    viewer.dataSources.add(dataSource);
    registerDataSource(layerId, dataSource);
    requestRender();

    // Compute center from entities
    const entities = dataSource.entities.values;
    let lonSum = 0, latSum = 0, count = 0;
    for (const entity of entities) {
      const pos = entity.position?.getValue(viewer.clock.currentTime);
      if (pos) {
        const carto = Cartographic.fromCartesian(pos);
        lonSum += CesiumMath.toDegrees(carto.longitude);
        latSum += CesiumMath.toDegrees(carto.latitude);
        count++;
      }
    }

    const centerLon = count > 0 ? lonSum / count : 127.0;
    const centerLat = count > 0 ? latSum / count : 36.5;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'GEOJSON',
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [centerLon, centerLat, 0],
    });

    // Fly to extent
    if (entities.length > 0) {
      viewer.flyTo(dataSource, { duration: 1.5 });
    }

    status(`✓ ${fileName} 로드 완료 (${entities.length.toLocaleString()}개 엔티티)`);
    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    status(`✗ ${fileName} 실패: ${errorMsg}`);
    console.error('[GeoJsonLoader] Error:', err);
    return { layerId, success: false, error: errorMsg };
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function setGeoJsonVisibility(layerId: string, visible: boolean): void {
  setDataSourceVisibility(layerId, visible);
}

export function setGeoJsonSymbology(layerId: string, symbology: LayerSymbology): void {
  setDataSourceSymbology(layerId, symbology);
}

export function removeGeoJsonEntities(layerId: string): void {
  removeDataSource(layerId);
}

// ─── IFileLoader ────────────────────────────────────────────────────────────

export const geoJsonFileLoader: IFileLoader = {
  supportedExtensions: ['.geojson'],
  formatName: 'GeoJSON',
  async load(filePath: string, buffer: ArrayBuffer | null): Promise<LoadResult> {
    if (!buffer) {
      buffer = await window.api.file.readBinary(filePath) as ArrayBuffer;
      if (!buffer) return { layerId: '', success: false, error: 'Failed to read file' };
    }
    return loadGeoJsonFile(filePath, buffer);
  },
};
