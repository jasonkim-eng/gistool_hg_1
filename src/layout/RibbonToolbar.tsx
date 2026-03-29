import React, { useState } from 'react';

interface RibbonToolbarProps {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenDxfFolder: () => void;
  onOpenGeoTiff: () => void;
  onResetCamera: () => void;
}

const tabs = ['홈', '3D 뷰어'];

const RibbonToolbar: React.FC<RibbonToolbarProps> = ({ onOpenFile, onOpenFolder, onOpenDxfFolder, onOpenGeoTiff, onResetCamera }) => {
  const [activeTab, setActiveTab] = useState('홈');

  return (
    <div className="ribbon">
      {/* Tab bar */}
      <div className="ribbon-tabs">
        {tabs.map((tab) => (
          <div
            key={tab}
            className={`ribbon-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="ribbon-content">
        {activeTab === '홈' && (
          <>
            <div className="ribbon-group">
              <button className="ribbon-btn" onClick={onOpenFile} title="3D 모델 / SHP / DXF 파일 열기">
                <span className="icon">📂</span>
                <span className="label">파일 열기</span>
              </button>
              <button className="ribbon-btn" onClick={onOpenFolder} title="OBJ 폴더 일괄 로딩">
                <span className="icon">📁</span>
                <span className="label">OBJ 폴더</span>
              </button>
              <button className="ribbon-btn" onClick={onOpenDxfFolder} title="수치지형도 DXF 폴더 일괄 로딩">
                <span className="icon">📐</span>
                <span className="label">수치지형도</span>
              </button>
              <button className="ribbon-btn" onClick={onOpenGeoTiff} title="GeoTIFF 실감정사영상 로딩">
                <span className="icon">🗺️</span>
                <span className="label">정사영상</span>
              </button>
            </div>
            <div className="ribbon-group">
              <button className="ribbon-btn" onClick={onResetCamera} title="카메라 초기 위치로 이동">
                <span className="icon">🌏</span>
                <span className="label">지구 보기</span>
              </button>
            </div>
          </>
        )}
        {activeTab === '3D 뷰어' && (
          <>
            <div className="ribbon-group">
              <button className="ribbon-btn" onClick={onResetCamera} title="카메라 리셋">
                <span className="icon">🎯</span>
                <span className="label">카메라 리셋</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RibbonToolbar;
