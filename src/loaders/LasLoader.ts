/**
 * LasLoader — Loads LAS point cloud files (LiDAR data).
 * Manual binary parser for LAS 1.2–1.4, point formats 0–3.
 * Renders via PointPrimitiveCollection (VectorPrimitiveRegistry).
 *
 * Features:
 * - Subsampling for large files (cap at 2M display points)
 * - CRS detection from GeoTIFF VLR keys or coordinate heuristic
 * - Color by: RGB (if available) → classification → elevation gradient
 */

import { Cartesian3, Color } from 'cesium';
import { flyTo, requestRender } from '../viewers/cesium/CesiumAdapter';
import {
  createVectorLayer,
  addPoint,
  setVectorVisibility,
  setVectorSymbology,
  removeVectorLayer,
} from '../viewers/cesium/VectorPrimitiveRegistry';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import { KOREAN_CRS, tmInverse, guessEpsgFromCoords } from './shared/crsUtils';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';
import type { LayerSymbology } from '../types/symbology';

const MAX_DISPLAY_POINTS = 2_000_000;
const BATCH_SIZE = 50_000;

let idCounter = 0;
function generateId(): string {
  return `las_${Date.now()}_${++idCounter}`;
}

// ─── LAS Header ─────────────────────────────────────────────────────────────

interface LasHeader {
  versionMajor: number;
  versionMinor: number;
  pointFormat: number;
  pointRecordLength: number;
  pointCount: number;
  scaleX: number; scaleY: number; scaleZ: number;
  offsetX: number; offsetY: number; offsetZ: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  pointDataOffset: number;
  vlrCount: number;
  headerSize: number;
}

function parseLasHeader(view: DataView): LasHeader {
  // Signature "LASF"
  const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (sig !== 'LASF') throw new Error('유효하지 않은 LAS 파일입니다 (서명 불일치)');

  const versionMajor = view.getUint8(24);
  const versionMinor = view.getUint8(25);
  const headerSize = view.getUint16(94, true);
  const pointDataOffset = view.getUint32(96, true);
  const vlrCount = view.getUint32(100, true);
  const pointFormat = view.getUint8(104);
  const pointRecordLength = view.getUint16(105, true);

  // Point count: LAS 1.4 uses 64-bit at offset 247, LAS 1.2 uses 32-bit at offset 107
  let pointCount: number;
  if (versionMajor >= 1 && versionMinor >= 4) {
    // LAS 1.4: legacy count at 107 may be 0, use 64-bit count at 247
    const legacy = view.getUint32(107, true);
    if (legacy === 0 && view.byteLength >= 255) {
      // Read as two 32-bit values (JS doesn't have native uint64)
      const lo = view.getUint32(247, true);
      const hi = view.getUint32(251, true);
      pointCount = hi * 4294967296 + lo;
    } else {
      pointCount = legacy;
    }
  } else {
    pointCount = view.getUint32(107, true);
  }

  const scaleX = view.getFloat64(131, true);
  const scaleY = view.getFloat64(139, true);
  const scaleZ = view.getFloat64(147, true);
  const offsetX = view.getFloat64(155, true);
  const offsetY = view.getFloat64(163, true);
  const offsetZ = view.getFloat64(171, true);
  const maxX = view.getFloat64(179, true);
  const minX = view.getFloat64(187, true);
  const maxY = view.getFloat64(195, true);
  const minY = view.getFloat64(203, true);
  const maxZ = view.getFloat64(211, true);
  const minZ = view.getFloat64(219, true);

  return {
    versionMajor, versionMinor, pointFormat, pointRecordLength, pointCount,
    scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ,
    minX, minY, minZ, maxX, maxY, maxZ,
    pointDataOffset, vlrCount, headerSize,
  };
}

// ─── VLR EPSG Detection ─────────────────────────────────────────────────────

function detectEpsgFromVlr(view: DataView, header: LasHeader): number | null {
  let offset = header.headerSize;
  for (let i = 0; i < header.vlrCount; i++) {
    if (offset + 54 > view.byteLength) break;

    const recordId = view.getUint16(offset + 20, true);
    const recordLength = view.getUint16(offset + 22, true);

    // GeoTIFF GeoKeyDirectoryTag (record ID 34735)
    if (recordId === 34735 && recordLength >= 8) {
      const keysOffset = offset + 54;
      const keyCount = view.getUint16(keysOffset + 6, true);

      for (let k = 0; k < keyCount; k++) {
        const keyOff = keysOffset + 8 + k * 8;
        if (keyOff + 8 > view.byteLength) break;

        const keyId = view.getUint16(keyOff, true);
        const value = view.getUint16(keyOff + 6, true);

        // ProjectedCSTypeGeoKey (3072) or GeographicTypeGeoKey (2048)
        if ((keyId === 3072 || keyId === 2048) && value > 0) {
          return value;
        }
      }
    }

    offset += 54 + recordLength;
  }
  return null;
}

// ─── Color Utilities ────────────────────────────────────────────────────────

const CLASSIFICATION_COLORS: Record<number, Color> = {
  2: Color.fromCssColorString('#8B7355'),  // Ground
  3: Color.fromCssColorString('#228B22'),  // Low vegetation
  4: Color.fromCssColorString('#32CD32'),  // Medium vegetation
  5: Color.fromCssColorString('#006400'),  // High vegetation
  6: Color.fromCssColorString('#B22222'),  // Building
  7: Color.fromCssColorString('#FF4500'),  // Low point (noise)
  9: Color.fromCssColorString('#4169E1'),  // Water
  17: Color.fromCssColorString('#808080'), // Bridge deck
};

function elevationColor(z: number, zMin: number, zRange: number): Color {
  if (zRange <= 0) return Color.WHITE;
  const t = Math.max(0, Math.min(1, (z - zMin) / zRange));
  // Green → Yellow → Red gradient
  const r = Math.min(1, t * 2);
  const g = Math.min(1, 2 - t * 2);
  return new Color(r, g, 0.1, 1.0);
}

// ─── Main Loader ────────────────────────────────────────────────────────────

export async function loadLasFile(filePath: string): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.las';
  const status = (msg: string) => useViewerStore.getState().setStatusMessage(msg);

  status(`${fileName} 로딩 준비 중...`);

  try {
    // ── Step 1: Read header ──
    status(`${fileName}: LAS 헤더 읽는 중...`);
    const headerBuffer = await window.api.file.readBinaryHeader(filePath, 375);
    if (!headerBuffer || headerBuffer.byteLength < 227) {
      throw new Error('LAS 헤더를 읽을 수 없습니다');
    }

    const headerView = new DataView(headerBuffer);
    const header = parseLasHeader(headerView);

    console.log(`[LasLoader] LAS ${header.versionMajor}.${header.versionMinor}, format=${header.pointFormat}, points=${header.pointCount.toLocaleString()}, recordLen=${header.pointRecordLength}`);

    const hasRgb = header.pointFormat === 2 || header.pointFormat === 3;
    const stride = Math.max(1, Math.ceil(header.pointCount / MAX_DISPLAY_POINTS));
    const displayPoints = Math.ceil(header.pointCount / stride);

    status(`${fileName}: ${header.pointCount.toLocaleString()}개 포인트 중 ${displayPoints.toLocaleString()}개 표시 (stride=${stride})...`);

    // ── Step 2: Detect CRS ──
    let epsg: number | null = null;
    let crsName = 'Unknown';

    // Try VLR detection from header buffer (may contain VLRs if header is large enough)
    epsg = detectEpsgFromVlr(headerView, header);

    if (!epsg) {
      const guessed = guessEpsgFromCoords(header.minX, header.minY);
      if (guessed) {
        epsg = guessed.epsg;
        crsName = `${guessed.name} (좌표 추론)`;
      }
    } else if (KOREAN_CRS[epsg]) {
      crsName = KOREAN_CRS[epsg].name;
    } else if (epsg === 4326) {
      crsName = 'WGS 84';
    } else {
      crsName = `EPSG:${epsg}`;
    }

    console.log(`[LasLoader] CRS: EPSG:${epsg} (${crsName})`);

    const crs = epsg && KOREAN_CRS[epsg] ? KOREAN_CRS[epsg] : null;
    const isWgs84 = epsg === 4326 || !crs;

    // ── Step 3: Read point data in chunks ──
    status(`${fileName}: 포인트 데이터 읽는 중...`);
    createVectorLayer(layerId);

    const zRange = header.maxZ - header.minZ;
    let rendered = 0;

    // Read in 10MB chunks
    const CHUNK_BYTES = 10 * 1024 * 1024;
    const totalPointBytes = header.pointCount * header.pointRecordLength;
    let fileOffset = header.pointDataOffset;
    let pointIndex = 0;

    while (fileOffset < header.pointDataOffset + totalPointBytes && rendered < displayPoints) {
      const readSize = Math.min(CHUNK_BYTES, header.pointDataOffset + totalPointBytes - fileOffset);
      const chunk = await window.api.file.readBinaryAt(filePath, fileOffset, readSize);
      if (!chunk || chunk.byteLength === 0) break;

      const chunkView = new DataView(chunk);
      const pointsInChunk = Math.floor(chunk.byteLength / header.pointRecordLength);

      for (let i = 0; i < pointsInChunk && rendered < displayPoints; i++) {
        // Apply stride — only process every Nth point
        if (pointIndex % stride !== 0) {
          pointIndex++;
          continue;
        }

        const off = i * header.pointRecordLength;
        if (off + 20 > chunk.byteLength) break;

        // Read raw coordinates (int32) and apply scale + offset
        const rawX = chunkView.getInt32(off, true);
        const rawY = chunkView.getInt32(off + 4, true);
        const rawZ = chunkView.getInt32(off + 8, true);

        const x = rawX * header.scaleX + header.offsetX;
        const y = rawY * header.scaleY + header.offsetY;
        const z = rawZ * header.scaleZ + header.offsetZ;

        // Transform to WGS84
        let lon: number, lat: number;
        if (isWgs84) {
          lon = x;
          lat = y;
        } else {
          const wgs = tmInverse(x, y, crs!);
          lon = wgs.lon;
          lat = wgs.lat;
        }

        // Determine color
        let color: Color;
        if (hasRgb && off + header.pointRecordLength >= off + 28) {
          // RGB at different offsets depending on format
          const rgbOff = header.pointFormat === 2 ? 20 : 28; // format 2: after 20 bytes, format 3: after GPS time (28)
          if (off + rgbOff + 6 <= chunk.byteLength) {
            const r = chunkView.getUint16(off + rgbOff, true) / 65535;
            const g = chunkView.getUint16(off + rgbOff + 2, true) / 65535;
            const b = chunkView.getUint16(off + rgbOff + 4, true) / 65535;
            color = new Color(r, g, b, 1.0);
          } else {
            color = elevationColor(z, header.minZ, zRange);
          }
        } else {
          // Try classification (byte at offset 15)
          const classification = off + 15 < chunk.byteLength ? chunkView.getUint8(off + 15) : 0;
          color = CLASSIFICATION_COLORS[classification] || elevationColor(z, header.minZ, zRange);
        }

        addPoint(layerId, Cartesian3.fromDegrees(lon, lat, z), color, 2);
        rendered++;
        pointIndex++;
      }

      // Advance to next chunk, accounting for remaining partial points
      const processedBytes = pointsInChunk * header.pointRecordLength;
      fileOffset += processedBytes;
      pointIndex = pointIndex; // continue global index

      // Yield to UI
      if (rendered % BATCH_SIZE < (pointsInChunk / stride)) {
        status(`${fileName}: 포인트 렌더링 중... (${rendered.toLocaleString()}/${displayPoints.toLocaleString()})`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    requestRender();
    console.log(`[LasLoader] Rendered ${rendered.toLocaleString()} points (stride=${stride})`);

    // ── Step 4: Register layer ──
    let centerLon: number, centerLat: number;
    if (isWgs84) {
      centerLon = (header.minX + header.maxX) / 2;
      centerLat = (header.minY + header.maxY) / 2;
    } else {
      const center = tmInverse(
        (header.minX + header.maxX) / 2,
        (header.minY + header.maxY) / 2,
        crs!,
      );
      centerLon = center.lon;
      centerLat = center.lat;
    }

    const centerAlt = (header.minZ + header.maxZ) / 2;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'LAS',
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [centerLon, centerLat, centerAlt],
    });

    const spanDeg = isWgs84
      ? Math.max(header.maxX - header.minX, header.maxY - header.minY)
      : 0.05; // ~5km for TM data
    const flyAlt = Math.max(spanDeg * 111000 * 1.5, 500);
    flyTo(centerLon, centerLat, centerAlt + flyAlt);

    const sizeMB = ((header.pointCount * header.pointRecordLength) / (1024 * 1024)).toFixed(1);
    status(`✓ ${fileName} 로드 완료 (${sizeMB}MB, ${rendered.toLocaleString()}/${header.pointCount.toLocaleString()} 포인트, ${crsName})`);

    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    status(`✗ ${fileName} 실패: ${errorMsg}`);
    console.error('[LasLoader] Error:', err);
    return { layerId, success: false, error: errorMsg };
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function setLasVisibility(layerId: string, visible: boolean): void {
  setVectorVisibility(layerId, visible);
}

export function setLasSymbology(layerId: string, symbology: LayerSymbology): void {
  setVectorSymbology(layerId, symbology);
}

export function removeLasPoints(layerId: string): void {
  removeVectorLayer(layerId);
}

// ─── IFileLoader ────────────────────────────────────────────────────────────

export const lasFileLoader: IFileLoader = {
  supportedExtensions: ['.las'],
  formatName: 'LAS 포인트 클라우드',
  async load(filePath: string, _buffer: ArrayBuffer | null): Promise<LoadResult> {
    return loadLasFile(filePath);
  },
};
