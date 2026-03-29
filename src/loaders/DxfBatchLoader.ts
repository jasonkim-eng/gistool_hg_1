/**
 * DxfBatchLoader — Opens a folder of DXF topographic map files
 * and loads them sequentially with progress tracking.
 */

import { loadDxfFile } from './DxfLoader';
import { useLayerStore } from '../stores/useLayerStore';
import { useViewerStore } from '../stores/useViewerStore';

/**
 * Open a folder dialog, scan for .dxf files, and load them sequentially.
 */
export async function openDxfFolderAndLoad(): Promise<void> {
  if (!window.api?.file) {
    console.warn('[DxfBatchLoader] Electron IPC not available');
    return;
  }

  const folderPath = await window.api.file.openFolderDialog();
  if (!folderPath) return;

  useViewerStore.getState().setStatusMessage('DXF 폴더 스캔 중...');

  // Scan for DXF files
  const dxfFiles: string[] = await window.api.file.scanFolder(folderPath, '.dxf');

  if (dxfFiles.length === 0) {
    useViewerStore.getState().setStatusMessage('DXF 파일을 찾을 수 없습니다');
    return;
  }

  const folderName = folderPath.split(/[/\\]/).pop() || '수치지형도';
  const groupId = `dxf_group_${Date.now()}`;

  // Create group layer
  useLayerStore.getState().addLayer({
    id: groupId,
    name: `📁 ${folderName} (0/${dxfFiles.length})`,
    type: 'DXF',
    visible: true,
    filePath: folderPath,
    groupId: undefined,
  });

  console.log(`[DxfBatchLoader] Loading ${dxfFiles.length} DXF files from ${folderName}`);

  let loaded = 0;
  let failed = 0;

  for (const dxfPath of dxfFiles) {
    const fileName = dxfPath.split(/[/\\]/).pop() || '';
    useViewerStore.getState().setStatusMessage(
      `수치지형도 로딩 중: ${loaded + 1}/${dxfFiles.length} — ${fileName}`,
    );

    try {
      const result = await loadDxfFile(dxfPath);

      // Re-parent the loaded DXF layer under the group
      if (result.success) {
        useLayerStore.getState().updateLayer(result.layerId, { groupId });
        loaded++;
      } else {
        failed++;
      }
    } catch (err: any) {
      console.warn(`[DxfBatchLoader] Failed: ${fileName}`, err?.message);
      failed++;
    }

    useLayerStore.getState().updateLayer(groupId, {
      name: `📁 ${folderName} (${loaded}/${dxfFiles.length})`,
    });
  }

  const msg = `✓ 수치지형도 완료: ${loaded}/${dxfFiles.length} (${failed} 실패)`;
  useViewerStore.getState().setStatusMessage(msg);
  console.log(`[DxfBatchLoader] ${msg}`);
}
