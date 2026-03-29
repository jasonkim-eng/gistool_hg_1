/**
 * DxfBatchLoader — Opens a folder of DXF topographic map files
 * and loads them concurrently (2 at a time) with progress tracking.
 */

import { loadDxfFile } from './DxfLoader';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';

const MAX_CONCURRENT_DXF = 2;

/**
 * Open a folder dialog, scan for .dxf files, and load them concurrently.
 */
export async function openDxfFolderAndLoad(): Promise<void> {
  if (!window.api?.file) {
    console.warn('[DxfBatchLoader] Electron IPC not available');
    return;
  }

  const folderPath = await window.api.file.openFolderDialog();
  if (!folderPath) return;

  useViewerStore.getState().setStatusMessage('DXF 폴더 스캔 중...');

  const dxfFiles: string[] = await window.api.file.scanFolder(folderPath, '.dxf');

  if (dxfFiles.length === 0) {
    useViewerStore.getState().setStatusMessage('DXF 파일을 찾을 수 없습니다');
    return;
  }

  const folderName = folderPath.split(/[/\\]/).pop() || '수치지형도';
  const groupId = `dxf_group_${Date.now()}`;

  useLayerStore.getState().addLayer({
    id: groupId,
    name: `📁 ${folderName} (0/${dxfFiles.length})`,
    type: 'DXF',
    visible: true,
    filePath: folderPath,
    groupId: undefined,
  });

  console.log(`[DxfBatchLoader] Loading ${dxfFiles.length} DXF files (${MAX_CONCURRENT_DXF} concurrent)`);

  let loaded = 0;
  let failed = 0;
  const queue = [...dxfFiles];

  const updateStatus = () => {
    useViewerStore.getState().setStatusMessage(
      `수치지형도 로딩 중: ${loaded + failed}/${dxfFiles.length} (${loaded} 완료, ${failed} 실패)`,
    );
    useLayerStore.getState().updateLayer(groupId, {
      name: `📁 ${folderName} (${loaded}/${dxfFiles.length})`,
    });
  };

  // Worker function: pull from queue and load
  const worker = async () => {
    while (queue.length > 0) {
      const dxfPath = queue.shift()!;
      try {
        const result = await loadDxfFile(dxfPath);
        if (result.success) {
          useLayerStore.getState().updateLayer(result.layerId, { groupId });
          loaded++;
        } else {
          failed++;
        }
      } catch (err: any) {
        const fileName = dxfPath.split(/[/\\]/).pop() || '';
        console.warn(`[DxfBatchLoader] Failed: ${fileName}`, err?.message);
        failed++;
      }
      updateStatus();
    }
  };

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT_DXF, dxfFiles.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const msg = `✓ 수치지형도 완료: ${loaded}/${dxfFiles.length} (${failed} 실패)`;
  useViewerStore.getState().setStatusMessage(msg);
  console.log(`[DxfBatchLoader] ${msg}`);
}
