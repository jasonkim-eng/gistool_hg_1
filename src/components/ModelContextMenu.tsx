import React, { useEffect, useRef } from 'react';
import { useContextMenuStore } from '../stores/useContextMenuStore';
import { useLayerStore } from '../stores/useLayerStore';
import { useSymbologyPanelStore } from '../stores/useSymbologyPanelStore';
import { unregisterModel, getModel } from '../viewers/cesium/CesiumModelRegistry';
import { getCesiumViewer } from '../viewers/cesium/CesiumViewer';
import { Cartesian3, Color, ColorBlendMode } from 'cesium';

const ModelContextMenu: React.FC = () => {
  const { visible, x, y, layerId, layerName, close } = useContextMenuStore();
  const toggleVisibility = useLayerStore((s) => s.toggleVisibility);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const layers = useLayerStore((s) => s.layers);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on any outside click or Escape
  useEffect(() => {
    if (!visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    // Delay listener to avoid immediate close from the right-click itself
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true);
      document.addEventListener('keydown', handleKey);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [visible, close]);

  if (!visible || !layerId) return null;

  const layer = layers.find((l) => l.id === layerId);
  const isVisible = layer?.visible ?? true;

  // Position adjustment to keep menu on screen
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 250),
    zIndex: 9999,
  };

  const handleToggleVisibility = () => {
    toggleVisibility(layerId);
    close();
  };

  const handleDelete = () => {
    unregisterModel(layerId, true);
    removeLayer(layerId);
    close();
  };

  const handleToggleTexture = () => {
    const model = getModel(layerId);
    if (model) {
      if ((model as any).colorBlendMode === ColorBlendMode.REPLACE) {
        // Restore texture
        (model as any).colorBlendMode = ColorBlendMode.HIGHLIGHT;
        (model as any).color = Color.WHITE;
      } else {
        // Strip texture → show as flat gray
        (model as any).colorBlendMode = ColorBlendMode.REPLACE;
        (model as any).color = Color.LIGHTGRAY;
      }
      const viewer = getCesiumViewer();
      if (viewer) viewer.scene.requestRender();
    }
    close();
  };

  const handleSymbology = () => {
    useSymbologyPanelStore.getState().open(layerId, x + 10, y + 10);
    close();
  };

  const handleZoomTo = () => {
    if (layer?.center) {
      const viewer = getCesiumViewer();
      if (viewer) {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            layer.center[0],
            layer.center[1],
            layer.center[2] + 200
          ),
          duration: 1.0,
        });
      }
    }
    close();
  };

  return (
    <div ref={menuRef} className="context-menu" style={menuStyle}>
      <div className="context-menu-header">
        {layerName || '모델'}
      </div>
      <div className="context-menu-divider" />
      <button className="context-menu-item" onClick={handleZoomTo}>
        <span className="cm-icon">🎯</span>
        <span>모델로 이동</span>
      </button>
      <button className="context-menu-item" onClick={handleToggleVisibility}>
        <span className="cm-icon">{isVisible ? '👁️' : '🚫'}</span>
        <span>{isVisible ? '시각화 비활성화' : '시각화 활성화'}</span>
      </button>
      <button className="context-menu-item" onClick={handleToggleTexture}>
        <span className="cm-icon">🎨</span>
        <span>텍스처 토글</span>
      </button>
      <button className="context-menu-item" onClick={handleSymbology}>
        <span className="cm-icon">🖌️</span>
        <span>심볼 설정</span>
      </button>
      <div className="context-menu-divider" />
      <button className="context-menu-item danger" onClick={handleDelete}>
        <span className="cm-icon">🗑️</span>
        <span>모델 삭제</span>
      </button>
    </div>
  );
};

export default ModelContextMenu;
