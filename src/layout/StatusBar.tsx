import React from 'react';
import { useViewerStore } from '../stores/useViewerStore';
import { useBatchStore } from '../stores/useBatchStore';
import { useSpatialCatalogStore } from '../stores/useSpatialCatalogStore';
import { cancelBatch } from '../loaders/BatchLoader';

const StatusBar: React.FC = () => {
  const cursorPosition = useViewerStore((s) => s.cursorPosition);
  const epsg = useViewerStore((s) => s.epsg);
  const fps = useViewerStore((s) => s.fps);
  const statusMessage = useViewerStore((s) => s.statusMessage);

  // Batch loading state
  const batchRunning = useBatchStore((s) => s.isRunning);
  const batchTotal = useBatchStore((s) => s.totalFiles);
  const batchLoaded = useBatchStore((s) => s.loadedFiles);
  const batchFailed = useBatchStore((s) => s.failedFiles);
  const batchCurrent = useBatchStore((s) => s.currentFile);

  // Spatial catalog state
  const catalogEntries = useSpatialCatalogStore((s) => s.entries);
  const isScanning = useSpatialCatalogStore((s) => s.isScanning);
  const isViewLoading = useSpatialCatalogStore((s) => s.isViewLoading);

  const formatCoord = (val: number, decimals: number = 6) => val.toFixed(decimals);
  const processed = batchLoaded + batchFailed;
  const progress = batchTotal > 0 ? (processed / batchTotal) * 100 : 0;

  // Compute catalog stats
  const catalogTotal = catalogEntries.length;
  const catalogLoaded = catalogEntries.filter((e) => e.status === 'loaded').length;
  const catalogLoading = catalogEntries.filter((e) => e.status === 'loading').length;
  const showCatalogStats = catalogTotal > 0 && (isScanning || isViewLoading);

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {batchRunning && !isViewLoading ? (
          <div className="batch-progress-container">
            <div className="batch-progress-bar">
              <div
                className="batch-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="batch-progress-text">
              {processed.toLocaleString()}/{batchTotal.toLocaleString()} 로딩 중
              {batchFailed > 0 && <span className="batch-failed"> ({batchFailed} 실패)</span>}
              {batchCurrent && <span className="batch-current"> — {batchCurrent}</span>}
            </span>
            <button
              className="batch-cancel-btn"
              onClick={cancelBatch}
              title="일괄 로딩 취소"
            >
              ✕
            </button>
          </div>
        ) : showCatalogStats ? (
          <div className="batch-progress-container">
            <div className="batch-progress-bar">
              <div
                className="batch-progress-fill"
                style={{ width: `${catalogTotal > 0 ? (catalogLoaded / catalogTotal) * 100 : 0}%` }}
              />
            </div>
            <span className="batch-progress-text">
              {isScanning ? '⚡ 스캔 중' : '📊'}{' '}
              {catalogLoaded.toLocaleString()}/{catalogTotal.toLocaleString()} 로딩됨
              {catalogLoading > 0 && <span className="batch-current"> ({catalogLoading} 진행중)</span>}
            </span>
            <button
              className="batch-cancel-btn"
              onClick={cancelBatch}
              title="시야 기반 로딩 중지"
            >
              ✕
            </button>
          </div>
        ) : (
          <span>{statusMessage}</span>
        )}
      </div>
      <div className="statusbar-center">
        {cursorPosition ? (
          <div className="statusbar-coord">
            <span>X:</span> {formatCoord(cursorPosition.lon)}°
            &nbsp;&nbsp;
            <span>Y:</span> {formatCoord(cursorPosition.lat)}°
            &nbsp;&nbsp;
            <span>Z:</span> {formatCoord(cursorPosition.alt, 1)}m
          </div>
        ) : (
          <span style={{ opacity: 0.4 }}>— 좌표 없음 —</span>
        )}
        <span className="statusbar-badge epsg">{epsg}</span>
      </div>
      <div className="statusbar-right">
        <span className="statusbar-badge fps">{fps} FPS</span>
      </div>
    </div>
  );
};

export default StatusBar;
