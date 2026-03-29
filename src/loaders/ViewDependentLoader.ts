/**
 * ViewDependentLoader — Camera-aware progressive loading engine.
 *
 * Phase 2 of the smart loading pipeline:
 * Listens to Cesium camera changes and triggers loading of OBJ files
 * that are near the current viewport, starting with the closest.
 */

import {
  Cartographic,
  Math as CesiumMath,
  Cartesian3,
  type Viewer,
} from 'cesium';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { useSpatialCatalogStore, type CatalogEntry } from '../stores/useSpatialCatalogStore';
import { loadCatalogEntries } from './BatchLoader';
import { VIEW_LOADING } from '../config/defaults';

// ── State ──
let removeListener: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeLoadCount = 0;

/**
 * Start listening to camera changes and loading nearby objects.
 */
export function startViewDependentLoading(): void {
  const viewer = getCesiumViewer();
  if (!viewer || removeListener) return;

  useSpatialCatalogStore.getState().setViewLoading(true);
  console.log('[ViewDependentLoader] Started');

  const handler = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onCameraChanged(viewer), VIEW_LOADING.CAMERA_DEBOUNCE_MS);
  };

  viewer.camera.changed.addEventListener(handler);
  viewer.camera.moveEnd.addEventListener(handler);

  removeListener = () => {
    viewer.camera.changed.removeEventListener(handler);
    viewer.camera.moveEnd.removeEventListener(handler);
  };

  // Trigger initial load for current view
  setTimeout(() => onCameraChanged(viewer), 200);
}

/**
 * Stop view-dependent loading.
 */
export function stopViewDependentLoading(): void {
  if (removeListener) {
    removeListener();
    removeListener = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  useSpatialCatalogStore.getState().setViewLoading(false);
  activeLoadCount = 0;
  console.log('[ViewDependentLoader] Stopped');
}

/**
 * Get the current camera center in WGS84 degrees.
 */
function getCameraCenter(viewer: Viewer): { lon: number; lat: number } | null {
  try {
    const carto = Cartographic.fromCartesian(viewer.camera.positionWC);
    return {
      lon: CesiumMath.toDegrees(carto.longitude),
      lat: CesiumMath.toDegrees(carto.latitude),
    };
  } catch {
    return null;
  }
}

/**
 * Get the viewport bounding rectangle in degrees.
 */
function getViewportBounds(viewer: Viewer): {
  west: number; south: number; east: number; north: number;
} | null {
  const canvas = viewer.scene.canvas;
  const corners = [
    new Cartographic(),
    new Cartographic(),
    new Cartographic(),
    new Cartographic(),
  ];

  const picks = [
    { x: 0, y: 0 },
    { x: canvas.clientWidth, y: 0 },
    { x: 0, y: canvas.clientHeight },
    { x: canvas.clientWidth, y: canvas.clientHeight },
  ];

  let validCount = 0;
  let west = 180, east = -180, south = 90, north = -90;

  for (let i = 0; i < 4; i++) {
    const ray = viewer.camera.getPickRay(picks[i] as any);
    if (!ray) continue;
    const hit = viewer.scene.globe.pick(ray, viewer.scene);
    if (!hit) continue;

    const carto = Cartographic.fromCartesian(hit);
    const lon = CesiumMath.toDegrees(carto.longitude);
    const lat = CesiumMath.toDegrees(carto.latitude);
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    validCount++;
  }

  if (validCount < 2) return null;

  // Expand bounds by margin factor for pre-loading
  const dLon = (east - west) * (VIEW_LOADING.VIEW_MARGIN_FACTOR - 1) / 2;
  const dLat = (north - south) * (VIEW_LOADING.VIEW_MARGIN_FACTOR - 1) / 2;
  return {
    west: west - dLon,
    south: south - dLat,
    east: east + dLon,
    north: north + dLat,
  };
}

/**
 * Camera change handler — find and load nearby unloaded objects.
 */
async function onCameraChanged(viewer: Viewer): Promise<void> {
  if (activeLoadCount >= VIEW_LOADING.MAX_CONCURRENT) return;

  const store = useSpatialCatalogStore.getState();
  if (!store.isViewLoading) return;

  const center = getCameraCenter(viewer);
  if (!center) return;

  // Get nearest unloaded entries
  const available = VIEW_LOADING.LOAD_BATCH_SIZE - activeLoadCount;
  if (available <= 0) return;

  let candidates = store.getNearestUnloaded(center.lon, center.lat, available);

  // Optionally filter by viewport bounds (if camera is close enough to ground)
  const bounds = getViewportBounds(viewer);
  if (bounds) {
    const inView = candidates.filter((e) => {
      if (!e.center) return false;
      const [lon, lat] = e.center;
      return lon >= bounds.west && lon <= bounds.east &&
             lat >= bounds.south && lat <= bounds.north;
    });
    // If we have items in view, prioritize those; otherwise load nearest anyway
    if (inView.length > 0) {
      candidates = inView;
    }
  }

  if (candidates.length === 0) {
    // Check if all entries are loaded
    const stats = store.getStats();
    if (stats.pending === 0 && stats.loading === 0) {
      console.log('[ViewDependentLoader] All entries loaded, stopping');
      stopViewDependentLoading();
    }
    return;
  }

  activeLoadCount += candidates.length;
  console.log(`[ViewDependentLoader] Loading ${candidates.length} nearby objects (${activeLoadCount} active)`);

  try {
    await loadCatalogEntries(candidates);
  } finally {
    activeLoadCount = Math.max(0, activeLoadCount - candidates.length);
  }
}
