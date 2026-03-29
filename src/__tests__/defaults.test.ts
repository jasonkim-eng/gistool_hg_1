import { describe, it, expect } from 'vitest';
import { BATCH, VIEW_LOADING, DEFAULT_GEO, MODEL_DEFAULTS, LAYER_PANEL } from '../config/defaults';

describe('config/defaults', () => {
  it('BATCH.MAX_CONCURRENT should be between 4 and 16', () => {
    expect(BATCH.MAX_CONCURRENT).toBeGreaterThanOrEqual(4);
    expect(BATCH.MAX_CONCURRENT).toBeLessThanOrEqual(16);
  });

  it('DEFAULT_GEO should have valid WGS84 coordinates', () => {
    expect(DEFAULT_GEO.CAMERA_LON).toBeGreaterThanOrEqual(-180);
    expect(DEFAULT_GEO.CAMERA_LON).toBeLessThanOrEqual(180);
    expect(DEFAULT_GEO.CAMERA_LAT).toBeGreaterThanOrEqual(-90);
    expect(DEFAULT_GEO.CAMERA_LAT).toBeLessThanOrEqual(90);
    expect(DEFAULT_GEO.CAMERA_ALT).toBeGreaterThan(0);
  });

  it('MODEL_DEFAULTS should have reasonable material values', () => {
    expect(MODEL_DEFAULTS.DEFAULT_METALNESS).toBeGreaterThanOrEqual(0);
    expect(MODEL_DEFAULTS.DEFAULT_METALNESS).toBeLessThanOrEqual(1);
    expect(MODEL_DEFAULTS.DEFAULT_ROUGHNESS).toBeGreaterThanOrEqual(0);
    expect(MODEL_DEFAULTS.DEFAULT_ROUGHNESS).toBeLessThanOrEqual(1);
  });

  it('VIEW_LOADING.CAMERA_DEBOUNCE_MS should be positive', () => {
    expect(VIEW_LOADING.CAMERA_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  it('LAYER_PANEL.MAX_RENDERED should be positive', () => {
    expect(LAYER_PANEL.MAX_RENDERED).toBeGreaterThan(0);
  });
});
