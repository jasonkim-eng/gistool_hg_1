import React, { useCallback } from 'react';
import RibbonToolbar from './layout/RibbonToolbar';
import DockLayout from './layout/DockLayout';
import StatusBar from './layout/StatusBar';
import ModelContextMenu from './components/ModelContextMenu';
import ModelSelectionIndicator from './components/ModelSelectionIndicator';
import ScanProgressModal from './components/ScanProgressModal';
import GeoTiffProgressModal from './components/GeoTiffProgressModal';
import SymbologyPopover from './panels/SymbologyPopover';
import { flyTo } from './viewers/cesium/CesiumAdapter';
import { getLoaderForExtension, getDialogFilters } from './loaders/FileFormatRegistry';
import { registerAllLoaders } from './loaders/registerLoaders';
import { openFolderAndLoad } from './loaders/BatchLoader';
import { openDxfFolderAndLoad } from './loaders/DxfBatchLoader';
import { loadGeoTiffFile } from './loaders/GeoTiffLoader';
import { useCesiumSync } from './hooks/useCesiumSync';
import { DEFAULT_GEO } from './config/defaults';

// Register all file format loaders at module load time
registerAllLoaders();

/** Extensions where the loader reads the file itself (no buffer needed from caller) */
const SELF_READING_EXTENSIONS = new Set(['.tif', '.tiff', '.dxf', '.shp']);

const App: React.FC = () => {
  useCesiumSync();

  const handleOpenFile = useCallback(async () => {
    if (!window.api?.file) {
      console.warn('File API not available (not running in Electron)');
      return;
    }

    const paths = await window.api.file.openDialog({
      filters: getDialogFilters(),
    });

    if (!paths || paths.length === 0) return;

    for (const filePath of paths) {
      const info = await window.api.file.getInfo(filePath);
      if (!info) continue;

      const loader = getLoaderForExtension(info.ext);
      if (!loader) {
        console.warn(`No loader registered for extension: ${info.ext}`);
        continue;
      }

      const needsBuffer = !SELF_READING_EXTENSIONS.has(info.ext.toLowerCase());
      const buffer = needsBuffer ? await window.api.file.readBinary(filePath) : null;
      if (needsBuffer && !buffer) continue;

      await loader.load(filePath, buffer);
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    await openFolderAndLoad();
  }, []);

  const handleOpenDxfFolder = useCallback(async () => {
    await openDxfFolderAndLoad();
  }, []);

  const handleResetCamera = useCallback(() => {
    flyTo(DEFAULT_GEO.CAMERA_LON, DEFAULT_GEO.CAMERA_LAT, DEFAULT_GEO.CAMERA_ALT);
  }, []);

  const handleOpenGeoTiff = useCallback(async () => {
    if (!window.api?.file) {
      console.warn('File API not available (not running in Electron)');
      return;
    }

    const paths = await window.api.file.openDialog({
      filters: [
        { name: 'GeoTIFF 정사영상', extensions: ['tif', 'tiff'] },
      ],
    });

    if (!paths || paths.length === 0) return;

    for (const filePath of paths) {
      await loadGeoTiffFile(filePath);
    }
  }, []);

  return (
    <div className="app-container">
      <RibbonToolbar
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onOpenDxfFolder={handleOpenDxfFolder}
        onOpenGeoTiff={handleOpenGeoTiff}
        onResetCamera={handleResetCamera}
      />
      <div className="app-body">
        <DockLayout />
      </div>
      <StatusBar />
      <ScanProgressModal />
      <GeoTiffProgressModal />
      <ModelContextMenu />
      <SymbologyPopover />
      <ModelSelectionIndicator />
    </div>
  );
};

export default App;
