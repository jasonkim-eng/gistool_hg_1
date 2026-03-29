/**
 * GeoTiffProgressModal — 정사영상 로딩 진행 모달
 *
 * 두 겹의 progress bar를 통해 실제 파일 처리 진행률을 표시:
 * 1. 전체 단계(step) progress bar — 0~100% (로딩 전 구간)
 * 2. TIFF→PNG 변환 구간(Step 7) 진행 시: 세부 변환 sub-bar + 파일 바이트 처리량
 */

import React from 'react';
import { useViewerStore } from '../stores/useViewerStore';

/** 전체 로딩 단계 정의 */
const STEPS = [
  { index: 0, label: '파일 정보 확인',       icon: '📋' },
  { index: 1, label: '보조 파일 검색 (.tfw, .prj)', icon: '🔍' },
  { index: 2, label: 'TIFF 헤더 파싱',       icon: '🔬' },
  { index: 3, label: '월드 파일 파싱',        icon: '🌐' },
  { index: 4, label: '좌표계 자동 추론',      icon: '📐' },
  { index: 5, label: 'WGS84 좌표 변환',      icon: '🗺️' },
  { index: 6, label: 'TIFF → PNG 변환',      icon: '🔁' },
  { index: 7, label: '레이어 등록',           icon: '📌' },
  { index: 8, label: '완료',                  icon: '✅' },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const GeoTiffProgressModal: React.FC = () => {
  const isLoading        = useViewerStore((s) => s.geotiffLoading);
  const progress         = useViewerStore((s) => s.geotiffProgress);
  const step             = useViewerStore((s) => s.geotiffStep);
  const currentStep      = useViewerStore((s) => s.geotiffCurrentStep);
  const fileName         = useViewerStore((s) => s.geotiffFileName);
  const fileSizeMB       = useViewerStore((s) => s.geotiffFileSizeMB);
  const convertProgress  = useViewerStore((s) => s.geotiffConvertProgress);
  const bytesRead        = useViewerStore((s) => s.geotiffBytesRead);
  const totalBytes       = useViewerStore((s) => s.geotiffTotalBytes);

  if (!isLoading) return null;

  const isConverting = currentStep === 6;
  const isDone       = progress >= 100;

  return (
    <div className="geotiff-modal-overlay">
      <div className="geotiff-modal">

        {/* 헤더 */}
        <div className="geotiff-modal-header">
          <div className="geotiff-modal-icon">🗺️</div>
          <div>
            <div className="geotiff-modal-title">정사영상 로딩 중</div>
            <div className="geotiff-modal-subtitle">
              <strong>{fileName}</strong>
              {fileSizeMB && fileSizeMB !== '...' && (
                <span className="geotiff-modal-size"> — {fileSizeMB} MB</span>
              )}
            </div>
          </div>
        </div>

        {/* 전체 progress */}
        <div className="geotiff-progress-section">
          <div className="geotiff-progress-header">
            <span className="geotiff-progress-label">전체 진행률</span>
            <span className="geotiff-progress-pct">{Math.round(progress)}%</span>
          </div>
          <div className="geotiff-modal-progress-bar">
            <div
              className="geotiff-modal-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 변환 세부 progress (Step 7 활성화 시) */}
        {isConverting && totalBytes > 0 && (
          <div className="geotiff-progress-section geotiff-convert-section">
            <div className="geotiff-progress-header">
              <span className="geotiff-progress-label geotiff-convert-label">
                🔁 TIFF → PNG 변환
              </span>
              <span className="geotiff-progress-pct">{Math.round(convertProgress)}%</span>
            </div>
            <div className="geotiff-modal-progress-bar geotiff-sub-bar">
              <div
                className="geotiff-modal-progress-fill geotiff-convert-fill"
                style={{ width: `${convertProgress}%` }}
              />
            </div>
            <div className="geotiff-bytes-info">
              <span>{formatBytes(bytesRead)}</span>
              <span className="geotiff-bytes-sep">/</span>
              <span>{formatBytes(totalBytes)}</span>
              <span className="geotiff-bytes-phase">{getConvertPhaseLabel(convertProgress)}</span>
            </div>
          </div>
        )}

        {/* 단계 목록 */}
        <div className="geotiff-steps-list">
          {STEPS.map((s) => {
            const status =
              s.index < currentStep ? 'done'
              : s.index === currentStep ? 'active'
              : 'pending';
            return (
              <div key={s.index} className={`geotiff-step-item geotiff-step-${status}`}>
                <div className="geotiff-step-icon">
                  {status === 'done' ? '✓' : status === 'active' ? <span className="geotiff-step-spinner" /> : s.icon}
                </div>
                <div className="geotiff-step-label">{s.label}</div>
                {status === 'active' && isConverting && totalBytes > 0 && (
                  <div className="geotiff-step-sub">{Math.round(convertProgress)}%</div>
                )}
              </div>
            );
          })}
        </div>

        {/* 현재 작업 메시지 */}
        <div className="geotiff-modal-step">{step}</div>

        {!isDone && <div className="geotiff-modal-spinner" />}
      </div>
    </div>
  );
};

/** 변환 진행률 구간별 설명 */
function getConvertPhaseLabel(pct: number): string {
  if (pct < 10) return '⚙ 파일 열기';
  if (pct < 25) return '📖 메타데이터 읽기';
  if (pct < 70) return '🔓 픽셀 디코딩 중';
  if (pct < 85) return '🎨 투명도 처리 중';
  if (pct < 100) return '💾 PNG 인코딩 중';
  return '✓ 변환 완료';
}

export default GeoTiffProgressModal;
