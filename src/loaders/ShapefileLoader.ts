/**
 * ShapefileLoader — Parses ESRI Shapefile (.shp/.dbf/.prj/.cpg)
 * and renders geometries as CesiumJS entities on the 3D globe.
 *
 * Supports shape types: Point (1), Polyline (3), Polygon (5).
 * Handles Korean TM CRS (EPSG:5186 etc.) via shared crsUtils.
 */

import { Cartesian3, Color } from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { flyTo, removeEntitiesByPrefix, requestRender } from '../viewers/cesium/CesiumAdapter';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import {
  KOREAN_CRS,
  tmInverse,
  detectEpsgFromPrj,
  guessEpsgFromCoords,
  type CrsEntry,
} from './shared/crsUtils';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';
import type { LayerSymbology } from '../types/symbology';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShpHeader {
  shapeType: number;
  xMin: number; yMin: number; xMax: number; yMax: number;
}

interface ShpRecord {
  shapeType: number;
  x?: number;
  y?: number;
  parts?: number[];
  points?: { x: number; y: number }[];
}

interface DbfField {
  name: string;
  type: string;
  length: number;
  offset: number;
}

// ─── ID Generator ───────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `shp_${Date.now()}_${++idCounter}`;
}

// ─── Cadastral Color Mapping ────────────────────────────────────────────────

function getCadastralColor(bchk: string): Color {
  switch (bchk.trim()) {
    case '대': return Color.fromCssColorString('#D2691E');   // building lot — brown
    case '전': return Color.fromCssColorString('#90EE90');   // field — light green
    case '답': return Color.fromCssColorString('#9ACD32');   // paddy — yellow-green
    case '임': return Color.fromCssColorString('#228B22');   // forest — dark green
    case '도': return Color.fromCssColorString('#A0A0A0');   // road — gray
    case '하': return Color.fromCssColorString('#4169E1');   // river — blue
    case '잡': return Color.fromCssColorString('#DEB887');   // miscellaneous — burlywood
    case '과': return Color.fromCssColorString('#7CFC00');   // orchard — lawn green
    case '목': return Color.fromCssColorString('#2E8B57');   // pasture — sea green
    case '광': return Color.fromCssColorString('#808080');   // mineral — gray
    case '염': return Color.fromCssColorString('#87CEEB');   // salt field — sky blue
    case '체': return Color.fromCssColorString('#FF6347');   // sports — tomato
    case '학': return Color.fromCssColorString('#FFD700');   // school — gold
    case '공': return Color.fromCssColorString('#DDA0DD');   // factory — plum
    default:   return Color.fromCssColorString('#00CED1');   // default — dark turquoise
  }
}

// ─── SHP Binary Parser ──────────────────────────────────────────────────────

function parseSHPHeader(view: DataView): ShpHeader {
  const fileCode = view.getInt32(0, false); // big-endian
  if (fileCode !== 9994) throw new Error('유효하지 않은 SHP 파일입니다');

  return {
    shapeType: view.getInt32(32, true),
    xMin: view.getFloat64(36, true),
    yMin: view.getFloat64(44, true),
    xMax: view.getFloat64(52, true),
    yMax: view.getFloat64(60, true),
  };
}

function parseSHPRecords(buffer: ArrayBuffer): { header: ShpHeader; records: ShpRecord[] } {
  const view = new DataView(buffer);
  const header = parseSHPHeader(view);
  const records: ShpRecord[] = [];
  let offset = 100; // records start after 100-byte header

  while (offset < buffer.byteLength - 8) {
    // Record header: 4 bytes record number (BE), 4 bytes content length in 16-bit words (BE)
    const contentLength = view.getInt32(offset + 4, false) * 2;
    offset += 8;

    if (offset + contentLength > buffer.byteLength) break;

    const shapeType = view.getInt32(offset, true);
    if (shapeType === 0) {
      // Null shape — skip
      offset += contentLength;
      continue;
    }

    if (shapeType === 1) {
      // Point
      records.push({
        shapeType,
        x: view.getFloat64(offset + 4, true),
        y: view.getFloat64(offset + 12, true),
      });
    } else if (shapeType === 3 || shapeType === 5) {
      // Polyline (3) or Polygon (5)
      const numParts = view.getInt32(offset + 36, true);
      const numPoints = view.getInt32(offset + 40, true);

      const parts: number[] = [];
      let pOff = offset + 44;
      for (let i = 0; i < numParts; i++) {
        parts.push(view.getInt32(pOff, true));
        pOff += 4;
      }

      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < numPoints; i++) {
        points.push({
          x: view.getFloat64(pOff, true),
          y: view.getFloat64(pOff + 8, true),
        });
        pOff += 16;
      }

      records.push({ shapeType, parts, points });
    }
    // Skip other shape types

    offset += contentLength;
  }

  return { header, records };
}

// ─── DBF Parser ─────────────────────────────────────────────────────────────

function parseDBF(
  buffer: ArrayBuffer,
  encoding: string,
): { fields: DbfField[]; records: Record<string, string>[] } {
  const view = new DataView(buffer);
  const numRecords = view.getUint32(4, true);
  const headerLen = view.getUint16(8, true);
  const recordLen = view.getUint16(10, true);

  // Parse field descriptors
  const fields: DbfField[] = [];
  let fieldOffset = 1; // skip deletion flag byte
  let off = 32;
  const bytes = new Uint8Array(buffer);
  while (off < headerLen - 1 && bytes[off] !== 0x0d) {
    const nameBytes = bytes.slice(off, off + 11);
    const name = String.fromCharCode(...nameBytes).replace(/\0/g, '');
    const type = String.fromCharCode(bytes[off + 11]);
    const length = bytes[off + 16];
    fields.push({ name, type, length, offset: fieldOffset });
    fieldOffset += length;
    off += 32;
  }

  // Parse records
  const decoder = new TextDecoder(encoding);
  const dataStart = headerLen;
  const records: Record<string, string>[] = [];

  for (let i = 0; i < numRecords; i++) {
    const recOffset = dataStart + i * recordLen;
    if (recOffset + recordLen > buffer.byteLength) break;

    // Skip deleted records
    if (bytes[recOffset] === 0x2a) continue;

    const record: Record<string, string> = {};
    for (const field of fields) {
      const start = recOffset + field.offset;
      const raw = bytes.slice(start, start + field.length);
      record[field.name] = decoder.decode(raw).trim();
    }
    records.push(record);
  }

  return { fields, records };
}

// ─── Main Loader ────────────────────────────────────────────────────────────

export async function loadShapefile(filePath: string): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.shp';

  const status = (msg: string) => useViewerStore.getState().setStatusMessage(msg);
  status(`${fileName} 로딩 준비 중...`);

  try {
    const viewer = getCesiumViewer();
    if (!viewer) throw new Error('CesiumJS viewer not initialized');

    // ── Step 1: Discover companion files ──
    status(`${fileName}: 보조 파일 검색 중...`);
    const siblings = await window.api.file.listSiblingFiles(filePath);

    // ── Step 2: Read SHP file ──
    status(`${fileName}: SHP 파일 읽는 중...`);
    const shpBuffer = await window.api.file.readBinary(filePath);
    if (!shpBuffer) throw new Error('SHP 파일을 읽을 수 없습니다');

    const sizeMB = (shpBuffer.byteLength / (1024 * 1024)).toFixed(1);

    const { header, records } = parseSHPRecords(shpBuffer);
    console.log(`[ShapefileLoader] Parsed ${records.length} records, shape type=${header.shapeType}`);

    // ── Step 3: Read DBF ──
    status(`${fileName}: SHP 파싱 완료 (${sizeMB}MB, ${records.length}개) — DBF 읽는 중...`);
    let dbfRecords: Record<string, string>[] = [];

    // Detect encoding from CPG
    let encoding = 'euc-kr';
    const cpgPath = siblings['.cpg'];
    if (cpgPath) {
      const cpgContent = await window.api.file.readText(cpgPath);
      if (cpgContent?.toUpperCase().includes('UTF')) encoding = 'utf-8';
    }

    const dbfPath = siblings['.dbf'];
    if (dbfPath) {
      const dbfBuffer = await window.api.file.readBinary(dbfPath);
      if (dbfBuffer) {
        const parsed = parseDBF(dbfBuffer, encoding);
        dbfRecords = parsed.records;
        console.log(`[ShapefileLoader] DBF: ${dbfRecords.length} records, fields: ${parsed.fields.map(f => f.name).join(', ')}`);
      }
    }

    // ── Step 4: Detect CRS ──
    status(`${fileName}: 좌표계 감지 중...`);
    let epsg: number | null = null;
    let crsName = 'Unknown';

    const prjPath = siblings['.prj'];
    if (prjPath) {
      const prjContent = await window.api.file.readText(prjPath);
      if (prjContent) {
        epsg = detectEpsgFromPrj(prjContent);
        if (epsg && KOREAN_CRS[epsg]) crsName = KOREAN_CRS[epsg].name;
        else if (epsg === 4326) crsName = 'WGS 84';
        else if (epsg) crsName = `EPSG:${epsg}`;
      }
    }

    if (!epsg) {
      const guessed = guessEpsgFromCoords(header.xMin, header.yMin);
      if (guessed) {
        epsg = guessed.epsg;
        crsName = `${guessed.name} (좌표 자동 추론)`;
      }
    }

    console.log(`[ShapefileLoader] CRS: EPSG:${epsg} (${crsName})`);

    // ── Step 5: Transform and render ──
    status(`${fileName}: ${records.length.toLocaleString()}개 도형 렌더링 중...`);

    const crs = epsg && KOREAN_CRS[epsg] ? KOREAN_CRS[epsg] : null;
    const isWgs84 = epsg === 4326;

    function toWgs84(x: number, y: number): { lon: number; lat: number } {
      if (isWgs84 || !crs) return { lon: x, lat: y };
      return tmInverse(x, y, crs);
    }

    let rendered = 0;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const updateBounds = (lon: number, lat: number) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };

    const BATCH_SIZE = 2000;
    for (let batchStart = 0; batchStart < records.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, records.length);
      status(`${fileName}: 도형 렌더링 중... (${batchStart.toLocaleString()}/${records.length.toLocaleString()})`);

      for (let i = batchStart; i < batchEnd; i++) {
        const rec = records[i];
        const entityId = `${layerId}_e${i}`;
        const dbfRec = dbfRecords[i];
        const color = dbfRec?.BCHK ? getCadastralColor(dbfRec.BCHK) : Color.CYAN;

        try {
          if (rec.shapeType === 1 && rec.x != null && rec.y != null) {
            // Point
            const wgs = toWgs84(rec.x, rec.y);
            updateBounds(wgs.lon, wgs.lat);
            viewer.entities.add({
              id: entityId,
              position: Cartesian3.fromDegrees(wgs.lon, wgs.lat),
              point: { pixelSize: 4, color, outlineColor: Color.BLACK, outlineWidth: 1 },
            });
            rendered++;
          } else if ((rec.shapeType === 3 || rec.shapeType === 5) && rec.parts && rec.points) {
            // Polyline or Polygon — render each part as a polyline
            for (let p = 0; p < rec.parts.length; p++) {
              const start = rec.parts[p];
              const end = p + 1 < rec.parts.length ? rec.parts[p + 1] : rec.points.length;
              const degreesArr: number[] = [];

              for (let j = start; j < end; j++) {
                const wgs = toWgs84(rec.points[j].x, rec.points[j].y);
                degreesArr.push(wgs.lon, wgs.lat);
                updateBounds(wgs.lon, wgs.lat);
              }

              // Close polygon rings
              if (rec.shapeType === 5 && degreesArr.length >= 4) {
                const firstWgs = toWgs84(rec.points[start].x, rec.points[start].y);
                degreesArr.push(firstWgs.lon, firstWgs.lat);
              }

              if (degreesArr.length >= 4) {
                viewer.entities.add({
                  id: `${entityId}_p${p}`,
                  polyline: {
                    positions: Cartesian3.fromDegreesArray(degreesArr),
                    width: 1.5,
                    material: color,
                    clampToGround: false,
                  },
                });
              }
            }
            rendered++;
          }
        } catch {
          // Skip individual record errors
        }
      }

      await new Promise((r) => setTimeout(r, 0));
    }

    requestRender();
    console.log(`[ShapefileLoader] Rendered ${rendered}/${records.length} features`);

    // ── Step 6: Register layer ──
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'SHP',
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [centerLon, centerLat, 0],
    });

    // ── Step 7: Fly to extent ──
    const maxSpanDeg = Math.max(maxLat - minLat, maxLon - minLon);
    const flyAlt = Math.max(maxSpanDeg * 111000 * 1.8, 500);
    flyTo(centerLon, centerLat, flyAlt);

    status(`✓ ${fileName} 로드 완료 (${sizeMB}MB, ${rendered.toLocaleString()}개 도형, ${crsName})`);

    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    status(`✗ ${fileName} 실패: ${errorMsg}`);
    console.error('[ShapefileLoader] Error:', err);
    return { layerId, success: false, error: errorMsg };
  }
}

// ─── Visibility / Removal ───────────────────────────────────────────────────

export function setShpVisibility(layerId: string, visible: boolean): void {
  const viewer = getCesiumViewer();
  if (!viewer) return;
  const prefix = `${layerId}_`;
  for (let i = viewer.entities.values.length - 1; i >= 0; i--) {
    const entity = viewer.entities.values[i];
    if (entity.id && entity.id.startsWith(prefix)) {
      entity.show = visible;
    }
  }
  requestRender();
}

/**
 * Apply symbology to all entities belonging to a SHP layer.
 */
export function setShpSymbology(layerId: string, symbology: LayerSymbology): void {
  const viewer = getCesiumViewer();
  if (!viewer) return;
  const prefix = `${layerId}_`;
  const isOverride = symbology.color.toUpperCase() !== '#FFFFFF';
  const overrideColor = isOverride
    ? Color.fromCssColorString(symbology.color).withAlpha(symbology.opacity)
    : null;

  for (const entity of viewer.entities.values) {
    if (!entity.id || !entity.id.startsWith(prefix)) continue;
    if (entity.polyline) {
      if (overrideColor) {
        (entity.polyline.material as any) = overrideColor;
      }
      (entity.polyline.width as any) = symbology.lineWidth;
    }
    if (entity.point) {
      if (overrideColor) {
        (entity.point.color as any) = overrideColor;
      }
      (entity.point.pixelSize as any) = symbology.pointSize;
    }
  }
  requestRender();
}

export function removeShpEntities(layerId: string): void {
  removeEntitiesByPrefix(`${layerId}_`);
}

// ─── IFileLoader ────────────────────────────────────────────────────────────

export const shapefileLoader: IFileLoader = {
  supportedExtensions: ['.shp'],
  formatName: '연속지적도 (Shapefile)',
  async load(filePath: string, _buffer: ArrayBuffer | null): Promise<LoadResult> {
    return loadShapefile(filePath);
  },
};
