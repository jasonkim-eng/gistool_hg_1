/**
 * Shared CRS / coordinate projection utilities.
 * Extracted from GeoTiffLoader — supports all Korean TM projections
 * (GRS80 + Bessel ellipsoids) and EPSG detection from PRJ/WKT.
 */

export interface CrsEntry {
  name: string;
  lon0: number;
  lat0: number;
  fe: number;
  fn: number;
  k0: number;
  ellipsoid: 'grs80' | 'bessel';
}

export const KOREAN_CRS: Record<number, CrsEntry> = {
  5186: { name: 'Korea 2000 중부', lon0: 127.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5187: { name: 'Korea 2000 동부', lon0: 129.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5185: { name: 'Korea 2000 서부', lon0: 125.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5188: { name: 'Korea 2000 동해', lon0: 131.0, lat0: 38.0, fe: 200000, fn: 600000, k0: 1.0, ellipsoid: 'grs80' },
  5179: { name: 'Korea 2000 통합', lon0: 127.5, lat0: 38.0, fe: 1000000, fn: 2000000, k0: 0.9996, ellipsoid: 'grs80' },
  2097: { name: '한국 중부원점(Bessel)', lon0: 127.0, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5174: { name: '한국 중부원점(수정)', lon0: 127.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5175: { name: '한국 서부원점(수정)', lon0: 125.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  5176: { name: '한국 동부원점(수정)', lon0: 129.00289027778, lat0: 38.0, fe: 200000, fn: 500000, k0: 1.0, ellipsoid: 'bessel' },
  32652: { name: 'UTM Zone 52N', lon0: 129.0, lat0: 0.0, fe: 500000, fn: 0, k0: 0.9996, ellipsoid: 'grs80' },
};

const ELLIPSOIDS = {
  grs80: { a: 6378137.0, f: 1 / 298.257222101 },
  bessel: { a: 6377397.155, f: 1 / 299.1528128 },
};

/**
 * TM inverse projection: easting/northing → WGS84 lon/lat (degrees).
 */
export function tmInverse(
  easting: number,
  northing: number,
  crs: CrsEntry,
): { lon: number; lat: number } {
  const e = ELLIPSOIDS[crs.ellipsoid];
  const a = e.a;
  const f = e.f;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);

  const lon0 = crs.lon0 * Math.PI / 180;
  const lat0 = crs.lat0 * Math.PI / 180;

  const x = (easting - crs.fe) / crs.k0;
  const y = (northing - crs.fn) / crs.k0;

  const M0 = meridionalArc(lat0, a, e2);
  const Mf = M0 + y;

  const mu = Mf / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
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

/**
 * Batch TM inverse: transform arrays of eastings/northings to WGS84.
 * Pre-computes ellipsoid constants once — ~30% faster than per-point tmInverse.
 */
export function batchTmInverse(
  eastings: Float64Array,
  northings: Float64Array,
  crs: CrsEntry,
): { lons: Float64Array; lats: Float64Array } {
  const count = eastings.length;
  const lons = new Float64Array(count);
  const lats = new Float64Array(count);

  const e = ELLIPSOIDS[crs.ellipsoid];
  const a = e.a;
  const f = e.f;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);
  const lon0 = crs.lon0 * Math.PI / 180;
  const lat0 = crs.lat0 * Math.PI / 180;
  const M0 = meridionalArc(lat0, a, e2);
  const invK0 = 1 / crs.k0;
  const muDenom = a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  // Pre-compute e1 powers
  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_3 * e1;
  const c1 = 3 * e1 / 2 - 27 * e1_3 / 32;
  const c2 = 21 * e1_2 / 16 - 55 * e1_4 / 32;
  const c3 = 151 * e1_3 / 96;
  const c4 = 1097 * e1_4 / 512;
  const RAD2DEG = 180 / Math.PI;

  for (let i = 0; i < count; i++) {
    const x = (eastings[i] - crs.fe) * invK0;
    const y = (northings[i] - crs.fn) * invK0;

    const Mf = M0 + y;
    const mu = Mf / muDenom;
    const fp = mu + c1 * Math.sin(2 * mu) + c2 * Math.sin(4 * mu) + c3 * Math.sin(6 * mu) + c4 * Math.sin(8 * mu);

    const sinFp = Math.sin(fp);
    const cosFp = Math.cos(fp);
    const tanFp = sinFp / cosFp;
    const sinFp2 = sinFp * sinFp;
    const Nf = a / Math.sqrt(1 - e2 * sinFp2);
    const Rf = (a * (1 - e2)) / Math.pow(1 - e2 * sinFp2, 1.5);
    const Df = x / Nf;

    const T1 = tanFp * tanFp;
    const C1 = ep2 * cosFp * cosFp;
    const Df2 = Df * Df;
    const Df4 = Df2 * Df2;
    const Df6 = Df4 * Df2;

    lats[i] = (fp - (Nf * tanFp / Rf) *
      (Df2 / 2 -
        (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Df4 / 24 +
        (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Df6 / 720)) * RAD2DEG;

    lons[i] = (lon0 + (Df -
      (1 + 2 * T1 + C1) * Df2 * Df / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Df4 * Df / 120) / cosFp) * RAD2DEG;
  }

  return { lons, lats };
}

export function meridionalArc(lat: number, a: number, e2: number): number {
  const n = e2;
  return (
    a *
    ((1 - n / 4 - 3 * n * n / 64 - 5 * n * n * n / 256) * lat -
      (3 * n / 8 + 3 * n * n / 32 + 45 * n * n * n / 1024) * Math.sin(2 * lat) +
      (15 * n * n / 256 + 45 * n * n * n / 1024) * Math.sin(4 * lat) -
      (35 * n * n * n / 3072) * Math.sin(6 * lat))
  );
}

/**
 * Detect EPSG code from PRJ WKT string.
 */
export function detectEpsgFromPrj(prjContent: string): number | null {
  const authMatch = prjContent.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi);
  if (authMatch) {
    const last = authMatch[authMatch.length - 1];
    const code = last.match(/(\d+)/);
    if (code) {
      const epsg = parseInt(code[1], 10);
      if (KOREAN_CRS[epsg]) return epsg;
      if (epsg === 4326) return 4326;
      return epsg;
    }
  }

  const upper = prjContent.toUpperCase();
  if (upper.includes('KOREA_2000') && upper.includes('CENTRAL')) return 5186;
  if (upper.includes('KGD2002') && upper.includes('CENTRAL')) return 5186;
  if (upper.includes('KOREA_2000') && upper.includes('EAST')) return 5187;
  if (upper.includes('KOREA_2000') && upper.includes('WEST')) return 5185;
  if (upper.includes('KOREA_2000') && upper.includes('UNIFIED')) return 5179;
  if (upper.includes('KOREAN_1985') && upper.includes('CENTRAL')) return 2097;
  if (upper.includes('UTM') && upper.includes('ZONE_52N')) return 32652;

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

/**
 * Guess Korean TM EPSG from raw easting/northing coordinates.
 */
export function guessEpsgFromCoords(
  easting: number,
  northing: number,
): { epsg: number; name: string } | null {
  if (easting > 800_000 && easting < 1_200_000 &&
      northing > 1_800_000 && northing < 2_300_000) {
    return { epsg: 5179, name: KOREAN_CRS[5179].name };
  }
  if (easting > 300_000 && easting < 700_000 &&
      northing > 3_800_000 && northing < 4_300_000) {
    return { epsg: 32652, name: KOREAN_CRS[32652].name };
  }
  if (easting > 0 && easting < 600_000 &&
      northing > 280_000 && northing < 760_000) {
    if (easting < 100_000) return { epsg: 5185, name: KOREAN_CRS[5185].name };
    if (easting > 350_000) return { epsg: 5187, name: KOREAN_CRS[5187].name };
    return { epsg: 5186, name: KOREAN_CRS[5186].name };
  }
  if (easting > 0 && easting < 600_000 &&
      northing > 150_000 && northing < 650_000) {
    return { epsg: 2097, name: KOREAN_CRS[2097].name };
  }
  return null;
}
