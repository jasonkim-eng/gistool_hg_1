import DxfParser from 'dxf-parser';
import { Cartesian3, Color } from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { flyTo, requestRender } from '../viewers/cesium/CesiumAdapter';
import {
  createVectorLayer,
  addPolyline,
  addPoint,
  setVectorVisibility,
  setVectorSymbology,
  removeVectorLayer,
} from '../viewers/cesium/VectorPrimitiveRegistry';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';
import type { LayerSymbology } from '../types/symbology';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DxfLoadResult extends LoadResult {
  entityCount: number;
}

// ─── ID Generator ────────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `dxf_${Date.now()}_${++idCounter}`;
}

// ─── Korean CRS (EPSG:5186) TM Inverse ──────────────────────────────────────

const CRS_5186 = {
  lon0: 127.0,
  lat0: 38.0,
  fe: 200000,
  fn: 600000,
  k0: 1.0,
};

const GRS80 = { a: 6378137.0, f: 1 / 298.257222101 };

function tmToWgs84(easting: number, northing: number): { lon: number; lat: number } {
  const a = GRS80.a;
  const f = GRS80.f;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);

  const lon0 = CRS_5186.lon0 * Math.PI / 180;
  const lat0 = CRS_5186.lat0 * Math.PI / 180;

  const x = (easting - CRS_5186.fe) / CRS_5186.k0;
  const y = (northing - CRS_5186.fn) / CRS_5186.k0;

  const M0 = meridionalArc(lat0, a, e2);
  const Mf = M0 + y;

  let mu = Mf / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fp =
    mu +
    (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu) +
    (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const Nf = a / Math.sqrt(1 - e2 * sinFp * sinFp);
  const Rf = (a * (1 - e2)) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const Df = x / Nf;

  const T1 = tanFp * tanFp;
  const C1 = ep2 * cosFp * cosFp;

  const lat =
    fp -
    (Nf * tanFp / Rf) *
      (Df * Df / 2 -
        (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Df * Df * Df * Df / 24 +
        (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) *
          Df * Df * Df * Df * Df * Df / 720);

  const lon =
    lon0 +
    (Df -
      (1 + 2 * T1 + C1) * Df * Df * Df / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) *
        Df * Df * Df * Df * Df / 120) /
      cosFp;

  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI };
}

function meridionalArc(lat: number, a: number, e2: number): number {
  const n = e2;
  return (
    a *
    ((1 - n / 4 - 3 * n * n / 64 - 5 * n * n * n / 256) * lat -
      (3 * n / 8 + 3 * n * n / 32 + 45 * n * n * n / 1024) * Math.sin(2 * lat) +
      (15 * n * n / 256 + 45 * n * n * n / 1024) * Math.sin(4 * lat) -
      (35 * n * n * n / 3072) * Math.sin(6 * lat))
  );
}

// ─── Layer Color Mapping (Korean topographic map convention) ─────────────────

function getLayerColor(layerName: string): Color {
  const upper = layerName.toUpperCase();

  // Buildings (건물)
  if (upper.startsWith('A0') || upper.includes('BUILD') || upper.includes('건물'))
    return Color.fromCssColorString('#D2691E'); // brown    

  // Roads (도로)
  if (upper.startsWith('B0') || upper.includes('ROAD') || upper.includes('도로'))
    return Color.fromCssColorString('#A0A0A0'); // gray

  // Railways (철도)
  if (upper.startsWith('C0') || upper.includes('RAIL') || upper.includes('철도'))
    return Color.fromCssColorString('#666666');

  // Water (수계)
  if (upper.startsWith('D0') || upper.includes('WATER') || upper.includes('수계') || upper.includes('하천'))
    return Color.fromCssColorString('#4169E1'); // royal blue

  // Contours (등고선)
  if (upper.startsWith('E0') || upper.includes('CONT') || upper.includes('등고'))
    return Color.fromCssColorString('#CD853F'); // peru/sandy

  // Vegetation (식생)
  if (upper.startsWith('F0') || upper.includes('VEG') || upper.includes('식생'))
    return Color.fromCssColorString('#228B22'); // forest green

  // Boundaries (경계)
  if (upper.startsWith('G0') || upper.includes('BOUND') || upper.includes('경계'))
    return Color.fromCssColorString('#FF6347'); // tomato

  // Utilities (시설물)
  if (upper.startsWith('H0') || upper.includes('UTIL') || upper.includes('시설'))
    return Color.fromCssColorString('#9370DB'); // medium purple

  // Text/Annotation
  if (upper.includes('TEXT') || upper.includes('ANNO') || upper.includes('주기'))
    return Color.fromCssColorString('#FFFF00'); // yellow

  // Default
  return Color.WHITE;
}

// ─── Main Loader ─────────────────────────────────────────────────────────────

/**
 * Load a DXF digital topographic map file, parse its entities,
 * transform coordinates from EPSG:5186 to WGS84, and render
 * as CesiumJS entities on the 3D globe.
 */
export async function loadDxfFile(filePath: string): Promise<DxfLoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.dxf';

  const status = (msg: string) => useViewerStore.getState().setStatusMessage(msg);
  status(`${fileName} 로딩 준비 중...`);

  try {
    const viewer = getCesiumViewer();
    if (!viewer) throw new Error('CesiumJS viewer not initialized');

    // ── Step 1: Read file as binary and decode EUC-KR ──
    status(`${fileName}: DXF 파일 읽는 중...`);
    const buffer = await window.api.file.readBinary(filePath);
    if (!buffer) throw new Error('DXF 파일을 읽을 수 없습니다');

    const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(1);

    // Decode EUC-KR (Korean encoding used in 수치지형도)
    let dxfText: string;
    try {
      const decoder = new TextDecoder('euc-kr');
      dxfText = decoder.decode(buffer);
    } catch {
      // Fallback to UTF-8
      const decoder = new TextDecoder('utf-8');
      dxfText = decoder.decode(buffer);
    }

    // ── Step 2: Parse DXF ──
    status(`${fileName}: DXF 구조 파싱 중 (${sizeMB}MB)...`);
    const parser = new DxfParser();
    const dxf = parser.parseSync(dxfText);
    if (!dxf || !dxf.entities || dxf.entities.length === 0) {
      throw new Error('DXF 파일에 엔티티가 없거나 파싱에 실패했습니다');
    }

    const totalEntities = dxf.entities.length;
    console.log(`[DxfLoader] Parsed ${totalEntities} entities from ${fileName}`);
    console.log(`[DxfLoader] Layers: ${Object.keys(dxf.tables?.layer?.layers || {}).join(', ')}`);

    // ── Step 3: Transform and render via batched primitive collections ──
    status(`${fileName}: ${totalEntities.toLocaleString()}개 엔티티 렌더링 중...`);
    createVectorLayer(layerId);

    let rendered = 0;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const updateBounds = (lon: number, lat: number) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };

    const BATCH_SIZE = 2000;
    for (let batchStart = 0; batchStart < totalEntities; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalEntities);
      status(`${fileName}: 엔티티 렌더링 중... (${batchStart.toLocaleString()}/${totalEntities.toLocaleString()})`);

      for (let i = batchStart; i < batchEnd; i++) {
        const entity = dxf.entities[i];
        const layerName = entity.layer || '0';
        const color = getLayerColor(layerName);

        try {
          switch (entity.type) {
            case 'LINE': {
              const start = tmToWgs84(entity.vertices[0].x, entity.vertices[0].y);
              const end = tmToWgs84(entity.vertices[1].x, entity.vertices[1].y);
              updateBounds(start.lon, start.lat);
              updateBounds(end.lon, end.lat);
              addPolyline(layerId, Cartesian3.fromDegreesArray([
                start.lon, start.lat, end.lon, end.lat,
              ]), color, 1.5);
              rendered++;
              break;
            }

            case 'LWPOLYLINE':
            case 'POLYLINE': {
              const verts = entity.vertices;
              if (!verts || verts.length < 2) break;
              const degreesArr: number[] = [];
              for (const v of verts) {
                const wgs = tmToWgs84(v.x, v.y);
                degreesArr.push(wgs.lon, wgs.lat);
                updateBounds(wgs.lon, wgs.lat);
              }
              if ((entity as any).shape || (entity as any).isClosed) {
                const first = tmToWgs84(verts[0].x, verts[0].y);
                degreesArr.push(first.lon, first.lat);
              }
              addPolyline(layerId, Cartesian3.fromDegreesArray(degreesArr), color, 1.5);
              rendered++;
              break;
            }

            case 'POINT': {
              const wgs = tmToWgs84(entity.position.x, entity.position.y);
              updateBounds(wgs.lon, wgs.lat);
              addPoint(layerId, Cartesian3.fromDegrees(wgs.lon, wgs.lat), color, 4);
              rendered++;
              break;
            }

            case 'CIRCLE': {
              const radius = entity.radius || 1;
              const circleCoords: number[] = [];
              for (let a = 0; a <= 360; a += 15) {
                const rad = (a * Math.PI) / 180;
                const cx = entity.center.x + radius * Math.cos(rad);
                const cy = entity.center.y + radius * Math.sin(rad);
                const pt = tmToWgs84(cx, cy);
                circleCoords.push(pt.lon, pt.lat);
              }
              const cWgs = tmToWgs84(entity.center.x, entity.center.y);
              updateBounds(cWgs.lon, cWgs.lat);
              addPolyline(layerId, Cartesian3.fromDegreesArray(circleCoords), color, 1.5);
              rendered++;
              break;
            }

            case 'ARC': {
              const arcRadius = entity.radius || 1;
              let startAngle = entity.startAngle || 0;
              let endAngle = entity.endAngle || 360;
              if (endAngle < startAngle) endAngle += 360;
              const arcCoords: number[] = [];
              for (let a = startAngle; a <= endAngle; a += 5) {
                const rad = (a * Math.PI) / 180;
                const cx = entity.center.x + arcRadius * Math.cos(rad);
                const cy = entity.center.y + arcRadius * Math.sin(rad);
                const pt = tmToWgs84(cx, cy);
                arcCoords.push(pt.lon, pt.lat);
              }
              const aWgs = tmToWgs84(entity.center.x, entity.center.y);
              updateBounds(aWgs.lon, aWgs.lat);
              if (arcCoords.length >= 4) {
                addPolyline(layerId, Cartesian3.fromDegreesArray(arcCoords), color, 1.5);
                rendered++;
              }
              break;
            }

            default:
              break;
          }
        } catch {
          // Skip individual entity errors
        }
      }

      await new Promise((r) => setTimeout(r, 0));
    }

    requestRender();
    console.log(`[DxfLoader] Rendered ${rendered}/${totalEntities} primitives (batched)`);

    // ── Step 4: Add bounding box ──
    if (minLon < maxLon && minLat < maxLat) {
      viewer.entities.add({
        id: `${layerId}_bbox`,
        name: `${fileName} 영역`,
        polyline: {
          positions: Cartesian3.fromDegreesArray([
            minLon, minLat,
            maxLon, minLat,
            maxLon, maxLat,
            minLon, maxLat,
            minLon, minLat,
          ]),
          width: 2,
          material: Color.CYAN,
          clampToGround: false,
        },
      });
    }

    // ── Step 5: Register in layer store ──
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'DXF',
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [centerLon, centerLat, 0],
    });

    // ── Step 6: Fly to data extent ──
    const latSpan = maxLat - minLat;
    const lonSpan = maxLon - minLon;
    const maxSpanDeg = Math.max(latSpan, lonSpan);
    const flyAlt = Math.max(maxSpanDeg * 111000 * 1.8, 500);

    flyTo(centerLon, centerLat, flyAlt);

    status(`✓ ${fileName} 로드 완료 (${sizeMB}MB, ${rendered.toLocaleString()}개 엔티티)`);

    return { layerId, success: true, entityCount: rendered };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    status(`✗ ${fileName} 실패: ${errorMsg}`);
    console.error('[DxfLoader] Error:', err);
    return { layerId, success: false, entityCount: 0, error: errorMsg };
  }
}

// ─── Lifecycle (using VectorPrimitiveRegistry) ──────────────────────────────

export function setDxfVisibility(layerId: string, visible: boolean): void {
  setVectorVisibility(layerId, visible);
}

export function setDxfSymbology(layerId: string, symbology: LayerSymbology): void {
  setVectorSymbology(layerId, symbology);
}

export function removeDxfEntities(layerId: string): void {
  removeVectorLayer(layerId);
}

/**
 * DxfFileLoader — IFileLoader implementation for DXF files.
 */
export const dxfFileLoader: IFileLoader = {
  supportedExtensions: ['.dxf'],
  formatName: '수치지형도 (DXF)',
  async load(filePath: string, _buffer: ArrayBuffer | null): Promise<LoadResult> {
    const result = await loadDxfFile(filePath);
    return { layerId: result.layerId, success: result.success, error: result.error };
  },
};
