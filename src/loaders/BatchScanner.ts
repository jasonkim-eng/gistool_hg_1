/**
 * BatchScanner — Phase 1 of the smart batch loading pipeline.
 * Performs rapid header scanning to extract WGS84 coordinates
 * from OBJ files without any 3D parsing.
 */

import { parseWGS84OriginFast } from './shared';
import { useViewerStore } from '../stores/useViewerStore';
import { useSpatialCatalogStore, type CatalogEntry } from '../stores/useSpatialCatalogStore';
import { BATCH } from '../config/defaults';

/**
 * Scan OBJ file headers to build a spatial catalog.
 * Returns the catalog entries with WGS84 coordinates (if found).
 */
export async function scanHeaders(
  objFiles: string[],
  signal: AbortSignal,
): Promise<CatalogEntry[]> {
  useSpatialCatalogStore.getState().setScanning(true);

  const catalogEntries: CatalogEntry[] = [];

  for (let i = 0; i < objFiles.length; i += BATCH.HEADER_SCAN_BATCH) {
    if (signal.aborted) break;

    const batch = objFiles.slice(i, i + BATCH.HEADER_SCAN_BATCH);
    const headers = await window.api.file.readHeaders(batch, BATCH.HEADER_BYTES);

    for (let j = 0; j < batch.length; j++) {
      const filePath = batch[j];
      const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
      const header = headers[j];
      let center: [number, number, number] | null = null;

      if (header) {
        const geoRef = parseWGS84OriginFast(header);
        if (geoRef) {
          center = [geoRef.lon, geoRef.lat, geoRef.alt];
        }
      }

      catalogEntries.push({
        filePath,
        fileName,
        center,
        status: 'pending',
      });
    }

    const scanned = Math.min(i + BATCH.HEADER_SCAN_BATCH, objFiles.length);
    useViewerStore.getState().setStatusMessage(
      `⚡ 헤더 스캔: ${scanned}/${objFiles.length}`,
    );
  }

  useSpatialCatalogStore.getState().setScanning(false);
  return catalogEntries;
}
