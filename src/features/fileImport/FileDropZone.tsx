import React, { useState, useCallback, useRef } from 'react';
import { isExtensionSupported, getLoaderForExtension } from '../../loaders/FileFormatRegistry';

interface FileDropZoneProps {
  children: React.ReactNode;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files);

    const modelFiles = files.filter((f) => {
      const ext = getExtension(f.name);
      return isExtensionSupported(ext);
    });

    for (const file of modelFiles) {
      const ext = getExtension(file.name);
      const loader = getLoaderForExtension(ext);
      if (!loader) continue;

      const filePath = (file as any).path;
      if (filePath && window.api?.file) {
        const buffer = await window.api.file.readBinary(filePath);
        await loader.load(filePath, buffer);
      } else {
        const buffer = await file.arrayBuffer();
        await loader.load(file.name, buffer);
      }
    }
  }, []);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {children}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <span className="icon">📁</span>
            <span className="text">3D 모델 파일을 드롭하세요</span>
            <span className="subtext">OBJ, FBX, glTF, GLB, DXF, GeoTIFF 지원</span>
          </div>
        </div>
      )}
    </div>
  );
};

function getExtension(filename: string): string {
  return ('.' + filename.split('.').pop()?.toLowerCase()) || '';
}

export default FileDropZone;
