import React, { useEffect, useState, useRef } from 'react';
import { useLayerStore } from '../stores/useLayerStore';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { getModel } from '../viewers/cesium/CesiumModelRegistry';
import { Cartesian3, Cartesian2, Matrix4, BoundingSphere } from 'cesium';

/**
 * ModelSelectionIndicator — renders a pulsing CSS ring overlay
 * at the selected model's screen position.
 * This is model-property-independent (no color/silhouette changes needed).
 */
const ModelSelectionIndicator: React.FC = () => {
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!activeLayerId) {
      setScreenPos(null);
      return;
    }

    const viewer = getCesiumViewer();
    const model = getModel(activeLayerId);

    if (!viewer || !model) {
      setScreenPos(null);
      return;
    }

    // Get model center position from its model matrix
    const modelCenter = Matrix4.getTranslation(
      model.modelMatrix,
      new Cartesian3()
    );

    let active = true;

    function updatePosition() {
      if (!active || !viewer) return;

      const canvasPos = viewer.scene.cartesianToCanvasCoordinates(
        modelCenter,
        new Cartesian2()
      );

      if (canvasPos) {
        // Convert canvas coords to window coords (accounting for canvas position)
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        setScreenPos({
          x: rect.left + canvasPos.x,
          y: rect.top + canvasPos.y,
        });
      } else {
        setScreenPos(null);
      }

      animFrameRef.current = requestAnimationFrame(updatePosition);
    }

    // Start tracking
    updatePosition();

    // Also update on camera change
    const removeListener = viewer.scene.postRender.addEventListener(() => {
      if (!active) return;
      const canvasPos = viewer.scene.cartesianToCanvasCoordinates(
        modelCenter,
        new Cartesian2()
      );
      if (canvasPos) {
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        setScreenPos({
          x: rect.left + canvasPos.x,
          y: rect.top + canvasPos.y,
        });
      } else {
        setScreenPos(null);
      }
    });

    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
      removeListener();
      setScreenPos(null);
    };
  }, [activeLayerId]);

  if (!screenPos) return null;

  return (
    <div
      className="model-selection-indicator"
      style={{
        left: screenPos.x,
        top: screenPos.y,
      }}
    >
      <div className="indicator-ring ring-1" />
      <div className="indicator-ring ring-2" />
      <div className="indicator-dot" />
    </div>
  );
};

export default ModelSelectionIndicator;
