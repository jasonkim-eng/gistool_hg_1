import { describe, it, expect } from 'vitest';
import { parseWGS84Origin, parseWGS84OriginFast } from '../loaders/shared/geoRefParser';

describe('parseWGS84Origin', () => {
  it('should parse WGS84 Origin from OBJ header comments', () => {
    const objText = `# Some comment
# WGS84 Origin: 37.5 127.0 150.5
v 0.0 0.0 0.0
v 1.0 0.0 0.0`;

    const result = parseWGS84Origin(objText);
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(37.5);
    expect(result!.lon).toBe(127.0);
    expect(result!.alt).toBe(150.5);
  });

  it('should return null when no WGS84 Origin is present', () => {
    const objText = `# No geo reference here
v 0.0 0.0 0.0`;

    const result = parseWGS84Origin(objText);
    expect(result).toBeNull();
  });

  it('should stop scanning at first vertex line', () => {
    const objText = `v 0.0 0.0 0.0
# WGS84 Origin: 37.5 127.0 150.5`;

    const result = parseWGS84Origin(objText);
    expect(result).toBeNull();
  });

  it('should handle negative coordinates', () => {
    const objText = `# WGS84 Origin: -33.868 151.209 -5.2
v 0.0 0.0 0.0`;

    const result = parseWGS84Origin(objText);
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(-33.868);
    expect(result!.lon).toBe(151.209);
    expect(result!.alt).toBe(-5.2);
  });

  it('should be case insensitive', () => {
    const objText = `# wgs84 origin: 37.5 127.0 0.0
v 0.0 0.0 0.0`;

    const result = parseWGS84Origin(objText);
    expect(result).not.toBeNull();
  });
});

describe('parseWGS84OriginFast', () => {
  it('should parse from first N bytes of text', () => {
    const text = `# WGS84 Origin: 37.5 127.0 100.0\n` + 'x'.repeat(5000);

    const result = parseWGS84OriginFast(text, 2048);
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(37.5);
  });

  it('should miss origin if beyond maxBytes', () => {
    const text = 'x'.repeat(3000) + `\n# WGS84 Origin: 37.5 127.0 100.0`;

    const result = parseWGS84OriginFast(text, 2048);
    expect(result).toBeNull();
  });
});
