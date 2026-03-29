/**
 * CesiumModelRegistry — Maps layer IDs to Cesium Model primitives.
 * Provides both forward (layerId → Model) and reverse (Model → layerId) lookups.
 */

import { Model, Color, ColorBlendMode } from 'cesium';
import { getCesiumViewer } from './CesiumViewer';
import type { LayerSymbology } from '../../types/symbology';

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
