/**
 * Register all file loaders with the FileFormatRegistry.
 * Call this once at application startup.
 */

import { registerLoader } from './FileFormatRegistry';
import { modelFileLoader } from './ModelLoader';
import { geoTiffFileLoader } from './GeoTiffLoader';
import { dxfFileLoader } from './DxfLoader';
import { shapefileLoader } from './ShapefileLoader';
import { geoJsonFileLoader } from './GeoJsonLoader';
import { kmlFileLoader } from './KmlLoader';
import { lasFileLoader } from './LasLoader';

export function registerAllLoaders(): void {
  registerLoader(modelFileLoader);       // OBJ, FBX, glTF, GLB, 3DS, PLY, STL
  registerLoader(geoTiffFileLoader);     // TIF, TIFF
  registerLoader(dxfFileLoader);         // DXF
  registerLoader(shapefileLoader);       // SHP
  registerLoader(geoJsonFileLoader);     // GeoJSON
  registerLoader(kmlFileLoader);         // KML, KMZ
  registerLoader(lasFileLoader);         // LAS
}
