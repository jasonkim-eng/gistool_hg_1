# GeoStudio X

Professional 3D GIS Desktop Software built with Electron + React + TypeScript + CesiumJS.

## Features

- **3D Model Viewer** — Load OBJ/FBX/glTF/GLB with textures, geo-referenced placement
- **GeoTIFF Orthophoto** — Overlay drone orthophotos with Korean CRS auto-detection (EPSG:5186, 5187, 5185, etc.)
- **Shapefile (SHP)** — Cadastral map loading with DBF attributes, color-coded by land use
- **DXF Topographic Map** — Single file or batch folder loading for 수치지형도
- **Smart Batch Loading** — Two-phase pipeline: rapid header scan + background concurrent loading for 10,000+ OBJ files
- **Layer Management** — Multi-selection, sorting (8 modes), search, virtual scrolling for large datasets
- **Symbology Control** — Per-layer color, opacity, line width, point size adjustment
- **Drag & Drop** — Drop files directly onto the 3D viewer
- **Offline-First** — Runs without internet using bundled Cesium assets

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Git**

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/jasonkim-eng/gistool_hg_1.git
cd gistool_hg_1
```

### 2. Install dependencies

```bash
npm install
```

### 3. Download Cesium static assets

The Cesium assets (~2GB) are not included in the repository. You need to copy them manually:

```bash
mkdir -p public/cesium
```

Copy the following directories from your Cesium npm package into `public/cesium/`:

```
node_modules/cesium/Build/Cesium/Workers/     → public/cesium/Workers/
node_modules/cesium/Build/Cesium/Widgets/     → public/cesium/Widgets/
node_modules/cesium/Build/Cesium/Assets/      → public/cesium/Assets/
node_modules/cesium/Build/Cesium/ThirdParty/  → public/cesium/ThirdParty/
```

Or run this command:

```bash
cp -r node_modules/cesium/Build/Cesium/Workers public/cesium/
cp -r node_modules/cesium/Build/Cesium/Widgets public/cesium/
cp -r node_modules/cesium/Build/Cesium/Assets public/cesium/
cp -r node_modules/cesium/Build/Cesium/ThirdParty public/cesium/
```

On Windows (PowerShell):

```powershell
Copy-Item -Recurse node_modules\cesium\Build\Cesium\Workers public\cesium\
Copy-Item -Recurse node_modules\cesium\Build\Cesium\Widgets public\cesium\
Copy-Item -Recurse node_modules\cesium\Build\Cesium\Assets public\cesium\
Copy-Item -Recurse node_modules\cesium\Build\Cesium\ThirdParty public\cesium\
```

### 4. Run the application

```bash
npm run dev
```

This starts the Vite dev server and launches the Electron desktop window.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server + Electron |
| `npm run build` | TypeScript check + production build |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

## Usage

### Loading Files

| Data Type | How to Load |
|-----------|-------------|
| 3D Models (OBJ/FBX/glTF/GLB) | "파일 열기" button or drag & drop |
| OBJ Folder (batch) | "OBJ 폴더" button → select folder |
| GeoTIFF Orthophoto | "정사영상" button → select .tif file |
| Shapefile (SHP) | "파일 열기" button → select .shp file |
| DXF Topographic Map | "파일 열기" button → select .dxf file |
| DXF Folder (batch) | "수치지형도" button → select folder |

### Layer Controls

- **Click** a layer to fly to it
- **Right-click** for context menu (zoom, visibility, symbology, delete)
- **Ctrl+Click** for multi-selection
- **Shift+Click** for range selection
- **Ctrl+A** to select all
- **Delete** key to remove selected layers

### Symbology

Right-click any layer → "심볼 설정" to adjust:
- Color (stroke/tint)
- Opacity (0–100%)
- Line width (DXF/SHP)
- Point size (DXF/SHP)

## Project Structure

```
src/
├── config/          # Application constants
├── components/      # UI components (modals, context menu)
├── features/        # Feature modules (drag & drop)
├── hooks/           # React hooks (Cesium sync)
├── layout/          # App layout (ribbon, status bar, dock)
├── loaders/         # File format loaders
│   ├── shared/      # Shared utilities (CRS, textures, materials)
│   ├── ModelLoader.ts
│   ├── BatchLoader.ts / BatchScanner.ts / BatchWorker.ts
│   ├── GeoTiffLoader.ts
│   ├── DxfLoader.ts / DxfBatchLoader.ts
│   ├── ShapefileLoader.ts
│   └── FileFormatRegistry.ts
├── panels/          # Side panels (layers, symbology)
├── stores/          # Zustand state management
├── types/           # TypeScript type definitions
└── viewers/cesium/  # CesiumJS viewer + adapter + registries
electron/
├── main.ts          # Electron main process
└── preload.ts       # IPC bridge
```

## Supported Korean CRS

| EPSG | Name |
|------|------|
| 5186 | Korea 2000 중부 (Central Belt) |
| 5187 | Korea 2000 동부 (East Belt) |
| 5185 | Korea 2000 서부 (West Belt) |
| 5188 | Korea 2000 동해 (East Sea) |
| 5179 | Korea 2000 통합 (Unified) |
| 2097 | 한국 중부원점 (Bessel) |
| 32652 | UTM Zone 52N |

## Tech Stack

- **Electron** — Desktop framework
- **React 19** — UI framework
- **TypeScript** — Type safety
- **CesiumJS** — 3D geospatial visualization
- **Three.js** — 3D model parsing (OBJ/FBX → glTF conversion)
- **Zustand** — Lightweight state management
- **Vite** — Build tool
- **Vitest** — Test framework
- **FlexLayout** — Dockable panel layout
