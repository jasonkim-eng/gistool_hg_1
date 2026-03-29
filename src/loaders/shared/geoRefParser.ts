/**
 * Geo-reference parsing utilities shared across loaders.
 * Extracts WGS84 coordinates from OBJ file headers.
 */

export interface GeoReference {
  lat: number;
  lon: number;
  alt: number;
}

/**
 * Parse `# WGS84 Origin: lat lon alt` from OBJ header comments.
 * Scans only comment lines at the top of the file (before first vertex).
 */
export function parseWGS84Origin(objText: string): GeoReference | null {
  const lines = objText.split('\n');
  for (const line of lines) {
    if (line.startsWith('v ')) break;
    const match = line.match(/WGS84\s+Origin:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
    if (match) {
      return {
        lat: parseFloat(match[1]),
        lon: parseFloat(match[2]),
        alt: parseFloat(match[3]),
      };
    }
  }
  return null;
}

/**
 * Fast variant — only scans first N bytes of text (for header-only reads).
 */
export function parseWGS84OriginFast(
  text: string,
  maxBytes = 2048,
): GeoReference | null {
  const header = text.substring(0, maxBytes);
  const match = header.match(/WGS84\s+Origin:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lon: parseFloat(match[2]),
      alt: parseFloat(match[3]),
    };
  }
  return null;
}
