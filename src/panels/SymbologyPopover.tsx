import React, { useEffect, useRef, useCallback } from 'react';
import { useSymbologyPanelStore } from '../stores/useSymbologyPanelStore';
import { useLayerStore } from '../stores/useLayerStore';
import { getDefaultSymbology } from '../types/symbology';

const SymbologyPopover: React.FC = () => {
  const { isOpen, layerId, anchorX, anchorY, close } = useSymbologyPanelStore();
  const layers = useLayerStore((s) => s.layers);
  const updateSymbology = useLayerStore((s) => s.updateSymbology);
  const popoverRef = useRef<HTMLDivElement>(null);

  const layer = layerId ? layers.find((l) => l.id === layerId) : null;
  const symbology = layer?.symbology || (layer ? getDefaultSymbology(layer.type) : null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true);
      document.addEventListener('keydown', handleKey);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, close]);

  const handleChange = useCallback(
    (field: string, value: string | number) => {
      if (!layerId) return;
      updateSymbology(layerId, { [field]: value });
    },
    [layerId, updateSymbology],
  );

  const handleReset = useCallback(() => {
    if (!layerId || !layer) return;
    const defaults = getDefaultSymbology(layer.type);
    updateSymbology(layerId, defaults);
  }, [layerId, layer, updateSymbology]);

  if (!isOpen || !layerId || !layer || !symbology) return null;

  const isVector = layer.type === 'DXF' || layer.type === 'SHP';
  const isModel = ['OBJ', 'FBX', 'GLTF', 'GLB'].includes(layer.type);
  const isImagery = layer.type === 'GEOTIFF';

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchorX, window.innerWidth - 280),
    top: Math.min(anchorY, window.innerHeight - 350),
    zIndex: 10000,
  };

  return (
    <div ref={popoverRef} className="symbology-popover" style={style}>
      <div className="symbology-header">
        심볼 설정
        <span className="symbology-layer-name">{layer.name}</span>
      </div>

      {/* Color */}
      {(isVector || isModel) && (
        <div className="symbology-row">
          <label className="symbology-label">색상</label>
          <div className="symbology-control">
            <input
              type="color"
              value={symbology.color}
              onChange={(e) => handleChange('color', e.target.value)}
              className="symbology-color-input"
            />
            <span className="symbology-value">{symbology.color}</span>
          </div>
        </div>
      )}

      {/* Opacity */}
      <div className="symbology-row">
        <label className="symbology-label">투명도</label>
        <div className="symbology-control">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={symbology.opacity}
            onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
            className="symbology-slider"
          />
          <span className="symbology-value">{Math.round(symbology.opacity * 100)}%</span>
        </div>
      </div>

      {/* Line Width (DXF/SHP only) */}
      {isVector && (
        <div className="symbology-row">
          <label className="symbology-label">선 두께</label>
          <div className="symbology-control">
            <input
              type="range"
              min="0.5"
              max="10"
              step="0.5"
              value={symbology.lineWidth}
              onChange={(e) => handleChange('lineWidth', parseFloat(e.target.value))}
              className="symbology-slider"
            />
            <span className="symbology-value">{symbology.lineWidth}px</span>
          </div>
        </div>
      )}

      {/* Point Size (DXF/SHP only) */}
      {isVector && (
        <div className="symbology-row">
          <label className="symbology-label">점 크기</label>
          <div className="symbology-control">
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={symbology.pointSize}
              onChange={(e) => handleChange('pointSize', parseFloat(e.target.value))}
              className="symbology-slider"
            />
            <span className="symbology-value">{symbology.pointSize}px</span>
          </div>
        </div>
      )}

      {/* Reset */}
      <div className="symbology-footer">
        <button className="symbology-reset-btn" onClick={handleReset}>
          초기화
        </button>
      </div>
    </div>
  );
};

export default SymbologyPopover;
