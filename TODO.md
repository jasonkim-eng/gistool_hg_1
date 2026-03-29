# MT_GIS_HG — Development Roadmap

**Current version:** v0.1.0 (Initial build with minimal functions)

---

## v0.2.0 — Format Support Expansion

### 3DS Loading
- [ ] Implement 3DS binary parser (or use Three.js TDSLoader)
- [ ] Handle 3DS material/texture mapping
- [ ] Coordinate system conversion (3DS uses Z-up like OBJ)
- [ ] Register with FileFormatRegistry (.3ds extension)
- [ ] Add to drag-and-drop supported formats
- [ ] Test with sample 3DS files from Korean survey data

### Mesh Loading (PLY / STL / LAS/LAZ Point Cloud)
- [ ] PLY loader — triangle mesh + vertex colors (common in photogrammetry)
- [ ] STL loader — surface mesh (common in 3D printing / terrain models)
- [ ] LAS/LAZ point cloud loader — drone survey output
  - [ ] Parse LAS 1.2/1.4 binary header + point records
  - [ ] Color by elevation / classification / RGB
  - [ ] Use Cesium PointPrimitiveCollection for rendering
  - [ ] Octree-based LOD for large point clouds (10M+ points)
- [ ] Register all with FileFormatRegistry

### Additional Vector Formats
- [ ] GeoJSON loader (common web interchange format)
- [ ] KML/KMZ loader (Google Earth format)
- [ ] GPX loader (GPS track data)

---

## v0.3.0 — Performance Improvements

### Rendering Performance
- [ ] Implement LOD (Level of Detail) for 3D models based on camera distance
- [ ] Tile-based loading for large DXF/SHP datasets (spatial index → load visible tiles only)
- [ ] Web Worker offloading for coordinate transformation (TM inverse is CPU-heavy at 100k+ points)
- [ ] Texture atlas for batch OBJ models (reduce GPU texture switches)
- [ ] Geometry instancing for repeated models (e.g., trees, poles)

### Memory Management
- [ ] Implement layer unloading (remove GPU resources when layer hidden for X minutes)
- [ ] Streaming SHP/DXF parser (process chunks instead of loading entire file)
- [ ] Blob URL lifecycle tracking (prevent leaks on layer delete)
- [ ] Memory usage monitoring in status bar

### Loading Speed
- [ ] Parallel file I/O in Electron main process (worker_threads for readBinary)
- [ ] Binary glTF caching (skip Three.js → GLB conversion for reloaded files)
- [ ] Incremental DXF rendering (show partial results while parsing continues)
- [ ] Pre-computed spatial index for SHP files (.shx utilization)

---

## v0.4.0 — Editing Mode (Major Feature)

### Phase 1: Planning & Architecture
- [ ] Define editing data model (what is an "edit operation"?)
- [ ] Design undo/redo system (command pattern with operation stack)
- [ ] Plan edit session lifecycle (start → edit → save/discard)
- [ ] Define supported edit operations per layer type
- [ ] Design conflict resolution for multi-layer edits

### Phase 2: Selection & Picking
- [ ] Implement precise vertex/edge/face picking for 3D models
- [ ] Implement feature picking for DXF/SHP entities
- [ ] Multi-select with rubber band rectangle
- [ ] Selection highlight (different from current layer highlight)
- [ ] Property inspector panel for selected features

### Phase 3: Geometry Editing — Vector (DXF/SHP)
- [ ] Move vertex (drag point to new position)
- [ ] Add vertex to polyline/polygon edge
- [ ] Delete vertex from polyline/polygon
- [ ] Move entire feature (translate)
- [ ] Rotate feature
- [ ] Scale feature
- [ ] Split polyline at point
- [ ] Merge adjacent polygons
- [ ] Create new point/polyline/polygon from scratch (drawing mode)
- [ ] Snap to existing vertices/edges/grid

### Phase 4: Geometry Editing — 3D Models
- [ ] Move model (translate X/Y/Z)
- [ ] Rotate model (heading/pitch/roll)
- [ ] Scale model (uniform and non-uniform)
- [ ] Transform gizmo (3-axis drag handles)
- [ ] Elevation adjustment (place on terrain surface)
- [ ] Clone/duplicate model

### Phase 5: Attribute Editing
- [ ] Edit DBF attributes for SHP features
- [ ] Edit DXF entity properties (layer, color, line type)
- [ ] Attribute table view (spreadsheet-like grid for bulk edits)
- [ ] Find & replace in attributes
- [ ] Calculate field values (field calculator)

### Phase 6: Persistence
- [ ] Save edited SHP back to .shp/.dbf files
- [ ] Save edited DXF back to .dxf file
- [ ] Export modified 3D model positions to CSV/JSON
- [ ] Auto-save edit session (crash recovery)
- [ ] Edit log / changelog per layer

### Phase 7: Drawing Tools
- [ ] Point drawing tool
- [ ] Polyline drawing tool (click-click-doubleclick)
- [ ] Polygon drawing tool (click to add vertices, close on first vertex)
- [ ] Rectangle drawing tool
- [ ] Circle drawing tool
- [ ] Freehand drawing tool
- [ ] Measurement tools (distance, area, elevation profile)
- [ ] Drawing style presets (line color, width, fill)

---

## v0.5.0 — UI/UX Improvements

### Layer Panel
- [ ] Drag-and-drop layer reordering
- [ ] Layer grouping (user-defined groups, not just batch groups)
- [ ] Layer property dialog (CRS info, bounds, feature count, file size)
- [ ] Thumbnail preview for layers
- [ ] Layer opacity slider inline (without opening symbology)

### 3D Viewer
- [ ] Terrain provider selection (flat/ellipsoid/Cesium World Terrain)
- [ ] Multiple base map providers (OSM, satellite, hybrid, topo)
- [ ] Compass / navigation cube widget
- [ ] Scale bar
- [ ] Coordinate display format toggle (DD / DMS / UTM)
- [ ] Bookmarks / saved camera positions
- [ ] Screenshot / export view to PNG

### Symbology Advanced
- [ ] Classification-based coloring (color by attribute value ranges)
- [ ] Graduated symbol sizes
- [ ] Label display for features (JIBUN for cadastral, layer name for DXF)
- [ ] Line style patterns (dash, dot, dash-dot)
- [ ] Polygon fill patterns (solid, hatch, transparent)
- [ ] Save/load symbology presets

### General UI
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcut customization
- [ ] Localization (Korean / English toggle)
- [ ] Recent files list
- [ ] Preferences dialog

---

## v1.0.0 — Production Release

### Stability
- [ ] Comprehensive error handling for all file formats
- [ ] Graceful degradation for corrupted files
- [ ] Memory limit protection (warn before OOM)
- [ ] Crash reporting
- [ ] Full test coverage for loaders and stores

### Distribution
- [ ] Windows NSIS installer with code signing
- [ ] Auto-update mechanism (electron-updater)
- [ ] Application icon and branding
- [ ] Splash screen
- [ ] User manual / help documentation

### Data Interop
- [ ] Export to GeoJSON
- [ ] Export to KML
- [ ] Export to Shapefile
- [ ] Print / PDF layout composer
- [ ] WMS/WMTS layer support (online map services)
- [ ] Coordinate system transformation on export

---

## Backlog (Priority TBD)

- [ ] Collaborative editing (multi-user via WebSocket)
- [ ] Plugin system for custom loaders/tools
- [ ] Python scripting console
- [ ] Database connection (PostGIS, SpatiaLite)
- [ ] Raster analysis tools (NDVI, hillshade, slope)
- [ ] 3D terrain analysis (viewshed, line of sight)
- [ ] BIM/IFC model support
- [ ] Cesium 3D Tiles support
- [ ] Video overlay on globe (drone footage georeferencing)
- [ ] AR/VR mode
