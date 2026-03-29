import React, { useCallback } from 'react';
import { usePerformanceStore, PERFORMANCE_DEFAULTS } from '../stores/usePerformanceStore';

const PerformanceSettingsPanel: React.FC = () => {
  const {
    isOpen, close, update, reset,
    viewDependentLoading, maxVisibleModels, maxGpuModels,
    tileSizeDeg, viewportDebounceMs, viewDependentThreshold,
  } = usePerformanceStore();

  const handleChange = useCallback((field: string, value: number | boolean) => {
    update({ [field]: value });
  }, [update]);

  if (!isOpen) return null;

  const tileMeters = Math.round(tileSizeDeg * 111000);

  return (
    <div className="perf-overlay" onClick={close}>
      <div className="perf-panel" onClick={(e) => e.stopPropagation()}>
        <div className="perf-header">
          <span>성능 설정</span>
          <button className="perf-close" onClick={close}>✕</button>
        </div>

        {/* View-Dependent Loading */}
        <div className="perf-section">
          <div className="perf-section-title">시야 기반 로딩 (OBJ)</div>

          <div className="perf-row">
            <label className="perf-label">시야 기반 로딩</label>
            <div className="perf-control">
              <input
                type="checkbox"
                checked={viewDependentLoading}
                onChange={(e) => handleChange('viewDependentLoading', e.target.checked)}
              />
              <span className="perf-hint">{viewDependentLoading ? '활성화' : '비활성화 (전체 로딩)'}</span>
            </div>
          </div>

          <div className="perf-row">
            <label className="perf-label">활성화 기준 (파일 수)</label>
            <div className="perf-control">
              <input
                type="range" min="100" max="5000" step="100"
                value={viewDependentThreshold}
                onChange={(e) => handleChange('viewDependentThreshold', parseInt(e.target.value))}
                className="perf-slider"
              />
              <span className="perf-value">{viewDependentThreshold}</span>
            </div>
          </div>

          <div className="perf-row">
            <label className="perf-label">최대 표시 모델</label>
            <div className="perf-control">
              <input
                type="range" min="50" max="1000" step="50"
                value={maxVisibleModels}
                onChange={(e) => handleChange('maxVisibleModels', parseInt(e.target.value))}
                className="perf-slider"
              />
              <span className="perf-value">{maxVisibleModels}</span>
            </div>
          </div>

          <div className="perf-row">
            <label className="perf-label">최대 GPU 모델</label>
            <div className="perf-control">
              <input
                type="range" min="100" max="2000" step="100"
                value={maxGpuModels}
                onChange={(e) => handleChange('maxGpuModels', parseInt(e.target.value))}
                className="perf-slider"
              />
              <span className="perf-value">{maxGpuModels}</span>
            </div>
          </div>
        </div>

        {/* Vector Tiling */}
        <div className="perf-section">
          <div className="perf-section-title">벡터 타일링 (DXF/SHP)</div>

          <div className="perf-row">
            <label className="perf-label">타일 크기</label>
            <div className="perf-control">
              <input
                type="range" min="0.001" max="0.02" step="0.001"
                value={tileSizeDeg}
                onChange={(e) => handleChange('tileSizeDeg', parseFloat(e.target.value))}
                className="perf-slider"
              />
              <span className="perf-value">~{tileMeters}m</span>
            </div>
          </div>

          <div className="perf-row">
            <label className="perf-label">뷰포트 갱신 주기</label>
            <div className="perf-control">
              <input
                type="range" min="50" max="1000" step="50"
                value={viewportDebounceMs}
                onChange={(e) => handleChange('viewportDebounceMs', parseInt(e.target.value))}
                className="perf-slider"
              />
              <span className="perf-value">{viewportDebounceMs}ms</span>
            </div>
          </div>
        </div>

        <div className="perf-footer">
          <button className="perf-reset-btn" onClick={reset}>기본값 복원</button>
        </div>
      </div>
    </div>
  );
};

export default PerformanceSettingsPanel;
