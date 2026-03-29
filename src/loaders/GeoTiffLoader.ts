import {
  Rectangle,
  SingleTileImageryProvider,
  ImageryLayer,
  Cartesian3,
  Math as CesiumMath,
  Color,
} from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { addImagery, addBoundingBox, flyTo } from '../viewers/cesium/CesiumAdapter';
import { useLayerStore, type LayerItem } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';
import type { LoadResult, IFileLoader } from './FileFormatRegistry';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TfwParams {
  /** Pixel size in X direction (map units per pixel) */
  scaleX: number;
  /** Rotation term (usually 0 for north-up) */
  rotY: number;
  /** Rotation term (usually 0 for north-up) */
  rotX: number;
  /** Pixel size in Y direction (negative for top-down) */
  scaleY: number;
  /** X coordinate of upper-left pixel center */
  upperLeftX: number;
  /** Y coordinate of upper-left pixel center */
  upperLeftY: number;
}

interface GeoTiffMeta {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Bounding box in source CRS */
  bounds: { west: number; south: number; east: number; north: number };
  /** Detected EPSG code (null if unknown) */
  epsg: number | null;
  /** Source CRS name for UI display */
  crsName: string;
}

interface LoadResult {
  layerId: string;
  success: boolean;
  error?: string;
}

// ─── ID Generator ────────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `geotiff_${Date.now()}_${++idCounter}`;
}

// ─── TFW (World File) Parser ─────────────────────────────────────────────────

function parseTfw(content: string): TfwParams | null {
  const lines = content.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return null;

  const vals = lines.slice(0, 6).map(Number);
  if (vals.some(isNaN)) return null;

  return {
    scaleX: vals[0],
    rotY: vals[1],
    rotX: vals[2],
    scaleY: vals[3],
    upperLeftX: vals[4],
    upperLeftY: vals[5],
  };
}

// ─── PRJ (WKT CRS) Parser ───────────────────────────────────────────────────

/**
 * Korean CRS mapping table — covers common EPSG codes used in
 * Korean government spatial data (drone orthophotos, cadastral maps, etc.)
 * Maps EPSG code → { name, transform function from source CRS to WGS84 lon/lat }
 */
interface CrsEntry {
  name: string;
  /** Central meridian in degrees */
  lon0: number;
  /** Origin latitude in degrees */
  lat0: number;
  /** False easting in meters */
  fe: number;
  /** False northing in meters */
  fn: number;
  /** Scale factor */
  k0: number;
  /** Ellipsoid: 'grs80' | 'bessel' */
  ellipsoid: 'grs80' | 'bessel';
}

const KOREAN_CRS: Record<number, CrsEntry> = {
  // Korea 2000 / Central Belt (GRS80)
  5186: { name: 'Korea 2000 중부', lon0: 127.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5187: { name: 'Korea 2000 동부', lon0: 129.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5185: { name: 'Korea 2000 서부', lon0: 125.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5188: { name: 'Korea 2000 동해', lon0: 131.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  // Korea 2000 / Unified (single zone)
  5179: { name: 'Korea 2000 통합', lon0: 127.5, lat0: 38.0, fe: 1000000, fn: 2000000, k0: 0.9996, ellipsoid: 'grs80' },
  // Old Korean datums (Bessel: Tokyo datum)
  2097: { name: '한국 중부원점(Bessel)', lon0: 127.0, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5174: { name: '한국 중부원점(수정)', lon0: 127.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5175: { name: '한국 서부원점(수정)', lon0: 125.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5176: { name: '한국 동부원점(수정)', lon0: 129.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  // UTM zone 52N (WGS84) — sometimes used for drone ortho
  32652: { name: 'UTM Zone 52N', lon0: 129.0, lat0: 0.0, fe: 500000, fn: 0, k0: 0.9996, ellipsoid: 'grs80' },
};

// Ellipsoid parameters
const ELLIPSOIDS = {
  grs80: { a: 6378137.0, f: 1 / 298.257222101 },
  bessel: { a: 6377397.155, f: 1 / 299.1528128 },
};

/**
 * Detect EPSG code from PRJ WKT string.
 * Looks for AUTHORITY["EPSG","XXXX"] or known projection names.
 */
function detectEpsgFromPrj(prjContent: string): number | null {
  // Try AUTHORITY tag first
  const authMatch = prjContent.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi);
  if (authMatch) {
    // Take the last (outermost) AUTHORITY match
    const last = authMatch[authMatch.length - 1];
    const code = last.match(/(\d+)/);
    if (code) {
      const epsg = parseInt(code[1], 10);
      if (KOREAN_CRS[epsg]) return epsg;
      // Known WGS84
      if (epsg === 4326) return 4326;
      return epsg;
    }
  }

  // Heuristic: check for known Korean CRS names in PRJ
  const upper = prjContent.toUpperCase();
  if (upper.includes('KOREA_2000') && upper.includes('CENTRAL')) return 5186;
  if (upper.includes('KOREA_2000') && upper.includes('EAST')) return 5187;
  if (upper.includes('KOREA_2000') && upper.includes('WEST')) return 5185;
  if (upper.includes('KOREA_2000') && upper.includes('UNIFIED')) return 5179;
  if (upper.includes('KOREAN_1985') && upper.includes('CENTRAL')) return 2097;
  if (upper.includes('UTM') && upper.includes('ZONE_52N')) return 32652;

  // Check central meridian values for Korean TM
  const cmMatch = prjContent.match(/central_meridian["\s,]*(-?[\d.]+)/i);
  if (cmMatch) {
    const cm = parseFloat(cmMatch[1]);
    const feMatch = prjContent.match(/false_easting["\s,]*(-?[\d.]+)/i);
    const fe = feMatch ? parseFloat(feMatch[1]) : 0;
    
    if (Math.abs(cm - 127.0) < 0.01 && Math.abs(fe - 200000) < 1) return 5186;
    if (Math.abs(cm - 129.0) < 0.01 && Math.abs(fe - 200000) < 1) return 5187;
    if (Math.abs(cm - 125.0) < 0.01 && Math.abs(fe - 200000) < 1) return 5185;
    if (Math.abs(cm - 127.5) < 0.01 && Math.abs(fe - 1000000) < 1) return 5179;
  }

  return null;
}

// ─── Coordinate-based CRS Heuristic ─────────────────────────────────────────

/**
 * When no PRJ file is available, attempt to guess the Korean TM EPSG code
 * from the raw TFW easting/northing coordinates.
 *
 * Korean TM systems all share the same general easting/northing ranges:
 *  - Easting (X): roughly 0 – 600,000 m (false easting 200,000 m)
 *  - Northing (Y): roughly 280,000 – 750,000 m (false northing 600,000 m)
 * The correct zone is identified by the central meridian implied by easting.
 *
 * Korea 2000 Unified (EPSG:5179) uses fe=1,000,000 / fn=2,000,000 — much larger.
 * UTM Zone 52N (EPSG:32652) uses fe=500,000 and fn≈3,xxx,xxx – northing will be far larger.
 */
function guessEpsgFromCoords(
  easting: number,
  northing: number
): { epsg: number; name: string } | null {
  // ── Korea 2000 Unified (EPSG:5179): fe=1,000,000 / fn=2,000,000 ──
  if (easting > 800_000 && easting < 1_200_000 &&
      northing > 1_800_000 && northing < 2_300_000) {
    return { epsg: 5179, name: KOREAN_CRS[5179].name };
  }

  // ── UTM Zone 52N (EPSG:32652): fe=500,000 / northing = latitude × ~111km ──
  // Korean peninsula northing: roughly 3,850,000 – 4,250,000
  if (easting > 300_000 && easting < 700_000 &&
      northing > 3_800_000 && northing < 4_300_000) {
    return { epsg: 32652, name: KOREAN_CRS[32652].name };
  }

  // ── Standard Korean TM zones (fe=200,000 / fn=600,000) ──
  // Easting roughly 0 – 550,000; Northing roughly 280,000 – 750,000
  if (easting > 0 && easting < 600_000 &&
      northing > 280_000 && northing < 760_000) {
    // Determine zone by easting distance from false easting (200,000)
    // West belt (lon0=125): data tends to have lower easting values
    // Central belt (lon0=127): most common, easting ~130,000 – 350,000
    // East belt (lon0=129): easting typically slightly higher
    // (No definitive formula without PRJ; default to central = EPSG:5186)
    if (easting < 100_000) return { epsg: 5185, name: KOREAN_CRS[5185].name }; // West
    if (easting > 350_000) return { epsg: 5187, name: KOREAN_CRS[5187].name }; // East
    return { epsg: 5186, name: KOREAN_CRS[5186].name }; // Central — most common
  }

  // ── Old Bessel datums (same false easting/northing but fn=500,000) ──
  if (easting > 0 && easting < 600_000 &&
      northing > 150_000 && northing < 650_000) {
    return { epsg: 2097, name: KOREAN_CRS[2097].name };
  }

  return null; // Cannot determine CRS from coordinates alone
}

// ─── Transverse Mercator Inverse (TM → Lat/Lon) ─────────────────────────────

/**
 * Pure math TM inverse projection.
 * Converts TM easting/northing → WGS84 longitude/latitude (degrees).
 */
function tmInverse(
  easting: number,
  northing: number,
  crs: CrsEntry
): { lon: number; lat: number } {
  const e = ELLIPSOIDS[crs.ellipsoid];
  const a = e.a;
  const f = e.f;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);

  const lon0 = crs.lon0 * Math.PI / 180;
  const lat0 = crs.lat0 * Math.PI / 180;

  // Remove false easting/northing
  const x = (easting - crs.fe) / crs.k0;
  const y = (northing - crs.fn) / crs.k0;

  // Meridional arc length at origin latitude
  const M0 = meridionalArc(lat0, a, e2);
  const Mf = M0 + y;

  // Footpoint latitude (by Newton-Raphson)
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

  return {
    lon: (lon * 180) / Math.PI,
    lat: (lat * 180) / Math.PI,
  };
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

// ─── TIFF Header Parser ─────────────────────────────────────────────────────

interface TiffDimensions {
  width: number;
  height: number;
}

/**
 * Parse TIFF binary header to extract image dimensions.
 * Reads the IFD entries to find ImageWidth (tag 256) and ImageLength (tag 257).
 */
function parseTiffDimensions(buffer: ArrayBuffer): TiffDimensions | null {
  try {
    const view = new DataView(buffer);

    // Byte order: "II" (0x4949) = little-endian, "MM" (0x4D4D) = big-endian
    const bom = view.getUint16(0, false);
    const le = bom === 0x4949;

    // Magic number: 42
    const magic = view.getUint16(2, le);
    if (magic !== 42) return null;

    // First IFD offset
    const ifdOffset = view.getUint32(4, le);
    if (ifdOffset >= buffer.byteLength) return null;

    const numEntries = view.getUint16(ifdOffset, le);
    let width = 0;
    let height = 0;

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      if (entryOffset + 12 > buffer.byteLength) break;

      const tag = view.getUint16(entryOffset, le);
      const type = view.getUint16(entryOffset + 2, le);
      const valueOffset = entryOffset + 8;

      // Read value based on type (SHORT=3 or LONG=4)
      let val = 0;
      if (type === 3) {
        val = view.getUint16(valueOffset, le);
      } else if (type === 4) {
        val = view.getUint32(valueOffset, le);
      }

      if (tag === 256) width = val;   // ImageWidth
      if (tag === 257) height = val;  // ImageLength

      if (width > 0 && height > 0) break;
    }

    if (width > 0 && height > 0) return { width, height };
    return null;
  } catch {
    return null;
  }
}

// ─── Main Loader ─────────────────────────────────────────────────────────────

/**
 * Load a GeoTIFF orthophoto file with its companion .tfw and .prj files
 * and display it on the CesiumJS 3D globe as an imagery layer.
 *
 * Uses the custom `local-file://` protocol to serve the file directly to Cesium
 * without transferring the full (multi-GB) file through Electron IPC.
 */
export async function loadGeoTiffFile(
  filePath: string
): Promise<LoadResult> {
  const layerId = generateId();
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown.tif';

  const report = useViewerStore.getState().setGeotiffProgress;
  const reportConvert = useViewerStore.getState().setGeotiffConvertProgress;

  report({ progress: 0, step: '로딩 준비 중...', stepIndex: 0, fileName, fileSizeMB: '...' });
  useViewerStore.getState().setStatusMessage(`Loading ${fileName}...`);

  // ── Subscribe to IPC convert progress events (from sharp in main process) ──
  // Map sharp's 0~100 into the overall progress range 80~95
  const CONVERT_START = 80;
  const CONVERT_END = 95;
  const ipcHandler = (data: { percent: number; bytesRead?: number; totalBytes?: number }) => {
    const mapped = CONVERT_START + ((data.percent / 100) * (CONVERT_END - CONVERT_START));
    report({ progress: Math.round(mapped), step: 'TIFF→PNG 변환 중...', stepIndex: 6 });
    reportConvert(data);
  };
  window.api?.geotiff?.onConvertProgress(ipcHandler);

  try {
    const viewer = getCesiumViewer();
    if (!viewer) throw new Error('CesiumJS viewer not initialized');

    // ── Step 0: Get file size ──
    let sizeMB = '?';
    if (window.api?.file?.getFileSize) {
      const fileSize = await window.api.file.getFileSize(filePath);
      if (fileSize) {
        sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
        report({ progress: 5, step: '파일 정보 확인 중...', stepIndex: 0, fileSizeMB: sizeMB });
      }
    }

    // ── Step 1: Discover companion files ──
    report({ progress: 12, step: '보조 파일(.tfw, .prj) 검색 중...', stepIndex: 1 });
    useViewerStore.getState().setStatusMessage(`${fileName}: 보조 파일 검색 중...`);
    let siblings: Record<string, string> = {};
    if (window.api?.file) {
      siblings = await window.api.file.listSiblingFiles(filePath);
    }
    console.log('[GeoTiffLoader] Companion files:', siblings);

    // ── Step 2: Parse TIFF header for dimensions ──
    report({ progress: 22, step: 'TIFF 헤더 파싱 중 (이미지 크기 확인)...', stepIndex: 2 });

    // Phase 1: Read first 8 bytes to determine byte order and IFD offset
    let headerBuffer: ArrayBuffer | null = null;
    if (window.api?.file?.readBinaryHeader) {
      headerBuffer = await window.api.file.readBinaryHeader(filePath, 8);
    }
    if (!headerBuffer || headerBuffer.byteLength < 8) {
      throw new Error('TIFF 헤더를 읽을 수 없습니다');
    }

    const headerView = new DataView(headerBuffer);
    const bom = headerView.getUint16(0, false);
    const le = bom === 0x4949; // II = little-endian
    const magic = headerView.getUint16(2, le);

    if (magic !== 42 && magic !== 43) {
      throw new Error(`지원하지 않는 TIFF 형식입니다 (magic=${magic})`);
    }

    // For BigTIFF (magic=43), IFD offset is 8 bytes at offset 8, but we handle classic for now
    const ifdOffset = headerView.getUint32(4, le);
    console.log(`[GeoTiffLoader] TIFF byte-order=${le ? 'LE' : 'BE'}, magic=${magic}, IFD offset=${ifdOffset}`);

    // Phase 2: Read IFD entries at the actual offset (could be anywhere in the file)
    // Read enough: 2 bytes (entry count) + up to 100 entries * 12 bytes = ~1202 bytes
    const ifdReadSize = 2 + 100 * 12;
    let ifdBuffer: ArrayBuffer | null = null;
    if (window.api?.file?.readBinaryAt) {
      ifdBuffer = await window.api.file.readBinaryAt(filePath, ifdOffset, ifdReadSize);
    }
    if (!ifdBuffer || ifdBuffer.byteLength < 2) {
      throw new Error(`TIFF IFD를 읽을 수 없습니다 (offset=${ifdOffset})`);
    }

    // Parse IFD to find ImageWidth (tag 256) and ImageLength (tag 257)
    const ifdView = new DataView(ifdBuffer);
    const numEntries = ifdView.getUint16(0, le);
    let width = 0;
    let height = 0;

    for (let i = 0; i < numEntries; i++) {
      const entryOff = 2 + i * 12;
      if (entryOff + 12 > ifdBuffer.byteLength) break;

      const tag = ifdView.getUint16(entryOff, le);
      const type = ifdView.getUint16(entryOff + 2, le);
      const valueOff = entryOff + 8;

      let val = 0;
      if (type === 3) { // SHORT
        val = ifdView.getUint16(valueOff, le);
      } else if (type === 4) { // LONG
        val = ifdView.getUint32(valueOff, le);
      }

      if (tag === 256) width = val;   // ImageWidth
      if (tag === 257) height = val;  // ImageLength

      if (width > 0 && height > 0) break;
    }

    if (width === 0 || height === 0) {
      throw new Error('TIFF 헤더에서 이미지 크기를 읽을 수 없습니다');
    }
    const dims = { width, height };
    console.log(`[GeoTiffLoader] Image dimensions: ${dims.width} × ${dims.height}`);

    // ── Step 3: Parse TFW world file ──
    report({ progress: 38, step: '월드 파일(.tfw) 파싱 중...', stepIndex: 3 });
    let tfw: TfwParams | null = null;
    const tfwPath = siblings['.tfw'] || siblings['.tifw'] || siblings['.wld'];
    if (tfwPath && window.api?.file) {
      const tfwContent = await window.api.file.readText(tfwPath);
      if (tfwContent) {
        tfw = parseTfw(tfwContent);
        console.log('[GeoTiffLoader] TFW parsed:', tfw);
      }
    }

    if (!tfw) {
      throw new Error('.tfw 파일을 찾을 수 없거나 파싱에 실패했습니다. GeoTIFF와 같은 폴더에 .tfw 파일이 있는지 확인해주세요.');
    }

    // ── Step 4: Parse PRJ for CRS detection ──
    report({ progress: 50, step: '좌표계(CRS) 자동 추론 중...', stepIndex: 4 });
    let epsg: number | null = null;
    let crsName = 'Unknown';
    const prjPath = siblings['.prj'];
    if (prjPath && window.api?.file) {
      const prjContent = await window.api.file.readText(prjPath);
      if (prjContent) {
        epsg = detectEpsgFromPrj(prjContent);
        if (epsg && KOREAN_CRS[epsg]) {
          crsName = KOREAN_CRS[epsg].name;
        } else if (epsg === 4326) {
          crsName = 'WGS 84';
        } else if (epsg) {
          crsName = `EPSG:${epsg}`;
        }
        console.log(`[GeoTiffLoader] CRS detected from PRJ: EPSG:${epsg} (${crsName})`);
      }
    }

    // ── Fallback: PRJ 없거나 인식 실패 시 TFW 좌표로 자동 추론 ──
    if (!epsg) {
      const ulX = tfw.upperLeftX;
      const ulY = tfw.upperLeftY;
      const guessed = guessEpsgFromCoords(ulX, ulY);
      if (guessed) {
        epsg = guessed.epsg;
        crsName = `${guessed.name} (좌표 자동 추론)`;
        console.warn(`[GeoTiffLoader] PRJ 없음 — 좌표값으로 CRS 추정: EPSG:${epsg} (${crsName})`);
      } else {
        console.warn(`[GeoTiffLoader] CRS 추정 불가 (X=${ulX}, Y=${ulY}). WGS84 로 처리합니다.`);
      }
    }

    // ── Step 5: Calculate bounding box in source CRS ──
    report({ progress: 60, step: '바운딩 박스 계산 중...', stepIndex: 5 });
    useViewerStore.getState().setStatusMessage(`${fileName}: 좌표 변환 중...`);

    // Upper-left corner (center of upper-left pixel)
    const ulX = tfw.upperLeftX;
    const ulY = tfw.upperLeftY;
    // Lower-right corner (center of lower-right pixel)
    const lrX = ulX + tfw.scaleX * dims.width + tfw.rotX * dims.height;
    const lrY = ulY + tfw.rotY * dims.width + tfw.scaleY * dims.height;

    // Extend by half pixel to get actual image edges
    const halfPixX = Math.abs(tfw.scaleX) / 2;
    const halfPixY = Math.abs(tfw.scaleY) / 2;

    const srcWest = Math.min(ulX, lrX) - halfPixX;
    const srcEast = Math.max(ulX, lrX) + halfPixX;
    const srcSouth = Math.min(ulY, lrY) - halfPixY;
    const srcNorth = Math.max(ulY, lrY) + halfPixY;

    console.log(`[GeoTiffLoader] Source bounds: W=${srcWest}, S=${srcSouth}, E=${srcEast}, N=${srcNorth}`);

    // ── Step 6: Transform to WGS84 ──
    report({ progress: 70, step: 'WGS84 좌표 변환 중...', stepIndex: 5 });
    let west: number, south: number, east: number, north: number;

    if (epsg === 4326) {
      // Already in WGS84
      west = srcWest;
      south = srcSouth;
      east = srcEast;
      north = srcNorth;
    } else if (epsg && KOREAN_CRS[epsg]) {
      // Korean TM → WGS84
      const crs = KOREAN_CRS[epsg];
      const sw = tmInverse(srcWest, srcSouth, crs);
      const ne = tmInverse(srcEast, srcNorth, crs);
      const nw = tmInverse(srcWest, srcNorth, crs);
      const se = tmInverse(srcEast, srcSouth, crs);

      west = Math.min(sw.lon, nw.lon);
      south = Math.min(sw.lat, se.lat);
      east = Math.max(ne.lon, se.lon);
      north = Math.max(ne.lat, nw.lat);

      console.log(`[GeoTiffLoader] WGS84 bounds: W=${west}, S=${south}, E=${east}, N=${north}`);
    } else {
      // Unknown CRS — assume coordinates are in degrees (best guess)
      console.warn('[GeoTiffLoader] Unknown CRS, assuming WGS84 coordinates');
      west = srcWest;
      south = srcSouth;
      east = srcEast;
      north = srcNorth;
    }

    // Sanity check
    if (west >= east || south >= north) {
      throw new Error('좌표 변환 결과가 비정상적입니다 (영역 크기 0 이하)');
    }
    if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
      throw new Error(`좌표 변환 결과가 범위를 초과합니다: [${west}, ${south}, ${east}, ${north}]`);
    }

    // ── Step 7: Create CesiumJS imagery layer via geotiff-preview protocol ──
    // The actual progress during this step is driven by IPC events from the main process
    report({ progress: 80, step: 'TIFF→PNG 변환 중... (파일 크기에 따라 수 분 소요)', stepIndex: 6 });
    useViewerStore.getState().setStatusMessage(`${fileName}: TIFF→PNG 변환 중 (대용량 파일은 시간이 걸릴 수 있습니다)...`);

    // Build geotiff-preview:// URL — electron main uses sharp to convert TIFF→JPEG
    const encodedPath = encodeURIComponent(filePath).replace(/%2F/gi, '/').replace(/%5C/gi, '/').replace(/%3A/gi, ':');
    const previewUrl = `geotiff-preview:///${encodedPath}`;
    console.log(`[GeoTiffLoader] Using geotiff-preview URL: ${previewUrl}`);

    await addImagery({
      layerId,
      url: previewUrl,
      west, south, east, north,
    });

    addBoundingBox(`${layerId}_bbox`, `${fileName} 영역`, west, south, east, north, Color.RED, 3);

    // ── Step 8: Add to layer store ──
    report({ progress: 96, step: '레이어 등록 중...', stepIndex: 7 });
    const centerLon = (west + east) / 2;
    const centerLat = (south + north) / 2;

    useLayerStore.getState().addLayer({
      id: layerId,
      name: fileName,
      type: 'GEOTIFF',
      visible: true,
      filePath,
      cesiumId: layerId,
      center: [centerLon, centerLat, 0],
    });

    // ── Step 9: Fly to the imagery ──
    report({ progress: 100, step: '로드 완료! ✓', stepIndex: 8 });
    const latSpan = north - south;
    const lonSpan = east - west;
    const maxSpanDeg = Math.max(latSpan, lonSpan);
    // Estimate altitude from angular extent (~111km per degree)
    const flyAlt = Math.max(maxSpanDeg * 111000 * 1.5, 500);

    flyTo(centerLon, centerLat, flyAlt);

    useViewerStore.getState().setStatusMessage(
      `✓ ${fileName} 로드 완료 (${sizeMB}MB, ${dims.width}×${dims.height}px, ${crsName})`
    );

    // Brief delay so user can see 100% before modal closes
    await new Promise((r) => setTimeout(r, 800));
    window.api?.geotiff?.removeAllConvertProgress();
    useViewerStore.getState().clearGeotiffProgress();

    return { layerId, success: true };
  } catch (err: any) {
    const errorMsg = err?.message || '알 수 없는 오류';
    useViewerStore.getState().setStatusMessage(`✗ ${fileName} 실패: ${errorMsg}`);
    window.api?.geotiff?.removeAllConvertProgress();
    useViewerStore.getState().clearGeotiffProgress();
    console.error('[GeoTiffLoader] Error:', err);
  return { layerId, success: false, error: errorMsg };
  }
}

/**
 * GeoTiffFileLoader — IFileLoader implementation for GeoTIFF files.
 */
export const geoTiffFileLoader: IFileLoader = {
  supportedExtensions: ['.tif', '.tiff'],
  formatName: 'GeoTIFF 정사영상',
  async load(filePath: string, _buffer: ArrayBuffer | null): Promise<LoadResult> {
    return loadGeoTiffFile(filePath);
  },
};

