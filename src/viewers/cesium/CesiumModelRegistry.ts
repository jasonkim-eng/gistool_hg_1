/**
 * CesiumModelRegistry — Maps layer IDs to Cesium Model primitives.
 * Provides both forward (layerId → Model) and reverse (Model → layerId) lookups.
 */

import { Model, Color, ColorBlendMode, Cartesian3, Cartographic, Math as CesiumMath } from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import type { LayerSymbology } from '../../types/symbology';
import { useLayerStore } from '../../stores/useLayerStore';
import { useSpatialCatalogStore } from '../../stores/useSpatialCatalogStore';
import { usePerformanceStore } from '../../stores/usePerformanceStore';

/** Active highlight timer — tracks current flash animation */
let highlightTimer: ReturnType<typeof setTimeout> | null = null;
let highlightLayerId: string | null = null;

/** layerId → Cesium Model reference */
const registry = new Map<string, Model>();

/** Cesium Model → layerId (reverse lookup for picking) */
const reverseRegistry = new WeakMap<Model, string>();

/**
 * Register a Cesium Model with a layer ID.
 */
export function registerModel(layerId: string, model: Model): void {
  registry.set(layerId, model);
  reverseRegistry.set(model, layerId);
}

/**
 * Get a Cesium Model by layer ID.
 */
export function getModel(layerId: string): Model | undefined {
  return registry.get(layerId);
}

/**
 * Unregister and optionally destroy a model.
 */
export function unregisterModel(layerId: string, destroy = true): void {
  const model = registry.get(layerId);
  if (model) {
    if (destroy) {
      const viewer = getCesiumViewer();
      if (viewer) {
        viewer.scene.primitives.remove(model);
        viewer.scene.requestRender();
      }
    }
    registry.delete(layerId);
    // WeakMap auto-cleans when model is GC'd
  }
}

/**
 * Set visibility of a model by layer ID.
 */
export function setModelVisibility(layerId: string, visible: boolean): void {
  const model = registry.get(layerId);
  if (model) {
    model.show = visible;
    const viewer = getCesiumViewer();
    if (viewer) viewer.scene.requestRender();
  }
}

/**
 * Set visibility for all models in a group.
 */
export function setGroupVisibility(groupId: string, visible: boolean, layerIds: string[]): void {
  let changed = false;
  for (const id of layerIds) {
    const model = registry.get(id);
    if (model) {
      model.show = visible;
      changed = true;
    }
  }
  if (changed) {
    const viewer = getCesiumViewer();
    if (viewer) viewer.scene.requestRender();
  }
}


/**
 * REVERSE LOOKUP: Get layer ID from a Cesium Model primitive.
 * Used for 3D picking — when user clicks a model in the viewer.
 */
export function getLayerIdFromModel(model: Model): string | undefined {
  return reverseRegistry.get(model);
}

/**
 * Find the layer ID for any picked Cesium object.
 * Walks up primitive hierarchy to find the registered Model.
 */
export function findLayerIdFromPick(pickedObject: any): string | undefined {
  if (!pickedObject) return undefined;

  // Direct model pick
  if (pickedObject instanceof Model) {
    return reverseRegistry.get(pickedObject);
  }

  // Cesium wraps picks in { primitive, id, ... }
  const primitive = pickedObject.primitive || pickedObject;
  if (primitive instanceof Model) {
    return reverseRegistry.get(primitive);
  }

  // Check detail object
  if (pickedObject.detail?.model instanceof Model) {
    return reverseRegistry.get(pickedObject.detail.model);
  }

  return undefined;
}

/**
 * Get the number of registered models.
 */
export function getRegistrySize(): number {
  return registry.size;
}

/**
 * Apply symbology (color tint, opacity) to a model.
 */
export function setModelSymbology(layerId: string, symbology: LayerSymbology): void {
  const model = registry.get(layerId);
  if (!model) return;

  const isWhite = symbology.color.toUpperCase() === '#FFFFFF';
  const cesiumColor = Color.fromCssColorString(symbology.color).withAlpha(symbology.opacity);

  model.color = cesiumColor;
  model.colorBlendMode = isWhite ? ColorBlendMode.HIGHLIGHT : ColorBlendMode.MIX;
  model.colorBlendAmount = isWhite ? 0.0 : 0.5;

  const viewer = getCesiumViewer();
  if (viewer) viewer.scene.requestRender();
}

/**
 * Flash-highlight a model for identification.
 * Uses silhouette glow (orange outline) + show/hide blink.
 * Silhouette persists for 3 seconds after blinking for easy identification.
 */
export function highlightModel(layerId: string): void {
  // Cancel any existing highlight
  if (highlightTimer) {
    clearTimeout(highlightTimer);
    if (highlightLayerId) {
      const prevModel = registry.get(highlightLayerId);
      if (prevModel) {
        prevModel.silhouetteSize = 0.0;
        prevModel.show = true;
      }
    }
    highlightTimer = null;
    highlightLayerId = null;
  }

  const m = registry.get(layerId);
  if (!m) {
    console.warn('[Highlight] Model not found in registry:', layerId, 'Registry size:', registry.size);
    return;
  }

  const model: Model = m;
  console.log('[Highlight] Starting highlight for:', layerId);
  highlightLayerId = layerId;
  const viewer = getCesiumViewer();

  // ── Phase 1: Show/hide blink (3 times) ──
  const BLINK_MS = 200;
  let step = 0;
  const blinkSteps = 6; // 3 blinks × 2

  // Set silhouette immediately (stays visible throughout)
  model.silhouetteColor = Color.ORANGE;
  model.silhouetteSize = 4.0;
  if (viewer) viewer.scene.requestRender();

  function blink() {
    if (!registry.has(layerId)) {
      highlightTimer = null;
      highlightLayerId = null;
      return;
    }

    if (step >= blinkSteps) {
      // Ensure model is visible after blinking
      model.show = true;
      if (viewer) viewer.scene.requestRender();

      // ── Phase 2: Keep silhouette for 3 more seconds, then fade ──
      highlightTimer = setTimeout(() => {
        if (registry.has(layerId)) {
          model.silhouetteSize = 0.0;
          if (viewer) viewer.scene.requestRender();
        }
        highlightTimer = null;
        highlightLayerId = null;
      }, 3000);
      return;
    }

    // Toggle show/hide for blink effect
    model.show = step % 2 === 0;
    if (viewer) viewer.scene.requestRender();

    step++;
    highlightTimer = setTimeout(blink, BLINK_MS);
  }

  blink();
}

// ═══ Distance-Based Culling with GPU Memory Unloading ═══

const CULL_DEBOUNCE_MS = 800;
let cullTimer: ReturnType<typeof setTimeout> | null = null;
let cullListenerActive = false;

/**
 * Start distance-based model culling with actual GPU memory unloading.
 * - Nearest maxVisibleModels: visible
 * - Up to maxGpuModels: hidden (warm GPU cache)
 * - Beyond maxGpuModels: destroyed (freed from GPU, can be re-loaded from GLB cache)
 */
export function startDistanceCulling(): void {
  const viewer = getCesiumViewer();
  if (!viewer || cullListenerActive) return;

  const onCameraChange = () => {
    if (cullTimer) clearTimeout(cullTimer);
    cullTimer = setTimeout(() => performCull(), CULL_DEBOUNCE_MS);
  };

  viewer.camera.changed.addEventListener(onCameraChange);
  viewer.camera.moveEnd.addEventListener(onCameraChange);
  cullListenerActive = true;
}

function performCull(): void {
  const viewer = getCesiumViewer();
  const { maxVisibleModels, maxGpuModels } = usePerformanceStore.getState();
  if (!viewer || registry.size <= maxVisibleModels) return;

  const cameraPos = viewer.camera.positionWC;
  const layers = useLayerStore.getState().layers;

  const distances: { layerId: string; dist: number }[] = [];
  for (const [layerId, model] of registry) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;

    const modelPos = model.modelMatrix
      ? Cartesian3.fromElements(
          model.modelMatrix[12],
          model.modelMatrix[13],
          model.modelMatrix[14],
        )
      : cameraPos;

    distances.push({ layerId, dist: Cartesian3.distance(cameraPos, modelPos) });
  }

  distances.sort((a, b) => a.dist - b.dist);

  let changed = false;
  const toDestroy: string[] = [];

  for (let i = 0; i < distances.length; i++) {
    const { layerId } = distances[i];
    const model = registry.get(layerId);
    if (!model) continue;

    if (i < maxVisibleModels) {
      // Inner ring: visible
      if (!model.show) { model.show = true; changed = true; }
    } else if (i < maxGpuModels) {
      // Middle ring: hidden but kept in GPU
      if (model.show) { model.show = false; changed = true; }
    } else {
      // Outer ring: destroy to free GPU memory
      toDestroy.push(layerId);
    }
  }

  // Destroy distant models and reset catalog status for re-loading
  if (toDestroy.length > 0) {
    for (const layerId of toDestroy) {
      const model = registry.get(layerId);
      if (model) {
        viewer.scene.primitives.remove(model);
        registry.delete(layerId);
        // Reset catalog entry so ViewDependentLoader can re-load it
        useSpatialCatalogStore.getState().markUnloaded(layerId);
      }
    }
    changed = true;
    console.log(`[CullEngine] Destroyed ${toDestroy.length} distant models (GPU memory freed)`);
  }

  if (changed) viewer.scene.requestRender();
}
