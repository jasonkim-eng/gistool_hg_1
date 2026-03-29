/**
 * Application-wide configuration constants.
 * Centralizes magic numbers previously scattered across loaders and viewers.
 */

// ── Hardware Detection ──
export const CPU_CORES =
  typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 8) : 8;

// ── Batch Loading ──
export const BATCH = {
  MAX_CONCURRENT: Math.min(16, Math.max(4, Math.floor(CPU_CORES * 0.8))),
  RENDER_FLUSH_INTERVAL: 10,
  LAYER_FLUSH_INTERVAL: 10,
  HEADER_SCAN_BATCH: 100,
  HEADER_BYTES: 2048,
  TEXTURE_TIMEOUT_MS: 1500,
} as const;

// ── View-Dependent Loading ──
export const VIEW_LOADING = {
  CAMERA_DEBOUNCE_MS: 500,
  MAX_CONCURRENT: 4,
  VIEW_MARGIN_FACTOR: 1.5,
  LOAD_BATCH_SIZE: 10,
} as const;

// ── Default Geo Coordinates (Korea center) ──
export const DEFAULT_GEO = {
  /** Default placement longitude for models without geo-reference */
  MODEL_LON: 127.0,
  /** Default placement latitude for models without geo-reference */
  MODEL_LAT: 37.5,
  /** Default altitude */
  MODEL_ALT: 0,
  /** Initial camera position — Korea overview */
  CAMERA_LON: 127.0,
  CAMERA_LAT: 36.5,
  CAMERA_ALT: 2_000_000,
  /** Camera fly duration in seconds */
  FLY_DURATION: 1.5,
  /** Altitude offset when flying to a model */
  FLY_OFFSET_ALT: 500,
} as const;

// ── 3D Model Defaults ──
export const MODEL_DEFAULTS = {
  MINIMUM_PIXEL_SIZE: 32,
  MAXIMUM_SCALE: 50_000,
  DEFAULT_MATERIAL_COLOR: 0xcccccc,
  DEFAULT_METALNESS: 0.1,
  DEFAULT_ROUGHNESS: 0.8,
} as const;

// ── Layer Panel ──
export const LAYER_PANEL = {
  MAX_RENDERED: 500,
} as const;

// ── Supported File Extensions ──
export const SUPPORTED_MODEL_EXTENSIONS = ['.obj', '.fbx', '.gltf', '.glb'] as const;
export const SUPPORTED_GEOTIFF_EXTENSIONS = ['.tif', '.tiff'] as const;
export const SUPPORTED_DXF_EXTENSIONS = ['.dxf'] as const;
export const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_MODEL_EXTENSIONS,
  ...SUPPORTED_GEOTIFF_EXTENSIONS,
  ...SUPPORTED_DXF_EXTENSIONS,
] as const;

export type SupportedModelExt = (typeof SUPPORTED_MODEL_EXTENSIONS)[number];
export type SupportedGeoTiffExt = (typeof SUPPORTED_GEOTIFF_EXTENSIONS)[number];
export type SupportedDxfExt = (typeof SUPPORTED_DXF_EXTENSIONS)[number];
