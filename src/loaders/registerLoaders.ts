/**
 * Register all file loaders with the FileFormatRegistry.
 * Call this once at application startup.
 */

import { registerLoader } from './FileFormatRegistry';
import { modelFileLoader } from './ModelLoader';
import { geoTiffFileLoader } from './GeoTiffLoader';
import { dxfFileLoader } from './DxfLoader';
import { shapefileLoader } from './ShapefileLoader';

export function registerAllLoaders(): void {
  registerLoader(modelFileLoader);
  registerLoader(geoTiffFileLoader);
  registerLoader(dxfFileLoader);
  registerLoader(shapefileLoader);
}
