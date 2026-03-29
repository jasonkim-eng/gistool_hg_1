/**
 * ScanProgressModal — Full-screen blocking overlay during Phase 1 header scan.
 * Prevents user interaction with the 3D viewer while indexing is in progress.
 */

import React from 'react';
import { useSpatialCatalogStore } from '../stores/useSpatialCatalogStore';
import { useBatchStore } from '../stores/useBatchStore';

const ScanProgressModal: React.FC = () => {
  const isScanning = useSpatialCatalogStore((s) => s.isScanning);
  const entries = useSpatialCatalogStore((s) => s.entries);
  const batchTotal = useBatchStore((s) => s.totalFiles);
  const folderName = useBatchStore((s) => s.folderName);

  if (!isScanning) return null;

  const scanned = entries.length;
  const progress = batchTotal > 0 ? (scanned / batchTotal) * 100 : 0;
  const withCoords = entries.filter((e) => e.center !== null).length;

  return (
    <div className="scan-modal-overlay">
      <div className="scan-modal">
        <div className="scan-modal-icon">⚡</div>
        <div className="scan-modal-title">공간 데이터 인덱싱</div>
        <div className="scan-modal-subtitle">
          {folderName && <strong>{folderName}</strong>}
          {' '}— {batchTotal.toLocaleString()}개 파일 스캔 중
        </div>

        <div className="scan-modal-progress-bar">
          <div
            className="scan-modal-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="scan-modal-stats">
          <div className="scan-stat">
            <span className="scan-stat-value">{scanned.toLocaleString()}</span>
            <span className="scan-stat-label">스캔됨</span>
          </div>
          <div className="scan-stat">
            <span className="scan-stat-value">{withCoords.toLocaleString()}</span>
            <span className="scan-stat-label">좌표 확인</span>
          </div>
          <div className="scan-stat">
            <span className="scan-stat-value">{batchTotal.toLocaleString()}</span>
            <span className="scan-stat-label">전체</span>
          </div>
        </div>

        <div className="scan-modal-hint">
          좌표 정보를 분석하여 최적의 로딩 순서를 결정합니다
        </div>

        <div className="scan-modal-spinner" />
      </div>
    </div>
  );
};

export default ScanProgressModal;
