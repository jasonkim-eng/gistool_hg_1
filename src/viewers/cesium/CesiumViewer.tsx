import React, { useRef, useEffect } from 'react';
import {
  Viewer,
  Cartesian3,
  Math as CesiumMath,
  Cartographic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  SceneMode,
  Color,
  Cartesian2,
  TileMapServiceImageryProvider,
  EllipsoidTerrainProvider,
  ImageryLayer,
  buildModuleUrl,
  OpenStreetMapImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useViewerStore } from '../../stores/useViewerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { useContextMenuStore } from '../../stores/useContextMenuStore';
import { findLayerIdFromPick, startDistanceCulling } from './CesiumModelRegistry';
import { DEFAULT_GEO } from '../../config/defaults';

// Singleton viewer reference accessible from outside React
let viewerInstance: Viewer | null = null;
export function getCesiumViewer(): Viewer | null {
  return viewerInstance;
}

const CesiumViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const setCursorPosition = useViewerStore((s) => s.setCursorPosition);
  const setFps = useViewerStore((s) => s.setFps);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let viewer: Viewer;

    const initViewer = async () => {
      // ── Use Cesium's bundled NaturalEarthII TMS tiles (fully offline) ──
      const naturalEarthProvider = await TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl('Assets/Textures/NaturalEarthII'),
      );
      const baseLayer = new ImageryLayer(naturalEarthProvider);

      // ── Air-gapped CesiumJS initialization (VIW-311) ──
      viewer = new Viewer(containerRef.current!, {
        // Disable all widgets that require internet
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneModePicker: false,
        projectionPicker: false,

        // ★ Fully offline fallback: NaturalEarthII local tiles
        baseLayer: baseLayer,

        // ★ Ellipsoid terrain (no Ion terrain fetch)
        terrainProvider: new EllipsoidTerrainProvider(),

        // Performance — request-render mode enabled below
        targetFrameRate: 30,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,

        // Scene
        sceneMode: SceneMode.SCENE3D,
        orderIndependentTranslucency: false,
        contextOptions: {
          webgl: {
            alpha: false,
            antialias: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
          },
        },
      });

      // ── Add OpenStreetMap as high-resolution overlay (zoom levels 0-19) ──
      const osmProvider = new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      });
      viewer.imageryLayers.addImageryProvider(osmProvider);

      // Remove default credit display clutter
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

      // Globe styling
      viewer.scene.globe.enableLighting = false;
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.baseColor = Color.fromCssColorString('#1a2744');

      // Logarithmic depth buffer to prevent Z-fighting (STR-332)
      viewer.scene.logarithmicDepthBuffer = true;

      // ── Low-spec GPU optimizations ──
      viewer.scene.postProcessStages.fxaa.enabled = false;
      viewer.scene.highDynamicRange = false;
      viewer.scene.globe.tileCacheSize = 50;
      viewer.scene.globe.maximumScreenSpaceError = 4;
      viewer.resolutionScale = 0.85;

      // Suppress rendering errors gracefully
      viewer.scene.renderError.addEventListener((_scene: any, error: any) => {
        console.warn('CesiumJS render warning (suppressed):', error?.message || error);
      });

      // Default camera: Korea
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(DEFAULT_GEO.CAMERA_LON, DEFAULT_GEO.CAMERA_LAT, DEFAULT_GEO.CAMERA_ALT),
        duration: 0,
      });

      // ── Mouse move → 3D coordinates (throttled to 20fps for performance) ──
      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      let lastMoveTime = 0;
      const MOUSE_THROTTLE_MS = 50;
      handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
        const now = performance.now();
        if (now - lastMoveTime < MOUSE_THROTTLE_MS) return;
        lastMoveTime = now;

        const ray = viewer.camera.getPickRay(movement.endPosition);
        if (ray) {
          const globePos = viewer.scene.globe.pick(ray, viewer.scene);
          if (defined(globePos)) {
            const carto = Cartographic.fromCartesian(globePos);
            setCursorPosition({
              lon: CesiumMath.toDegrees(carto.longitude),
              lat: CesiumMath.toDegrees(carto.latitude),
              alt: carto.height,
            });
          } else {
            setCursorPosition(null);
          }
        }
        viewer.scene.requestRender();
      }, ScreenSpaceEventType.MOUSE_MOVE);

      // ── LEFT_CLICK: Pick model → select in layer panel ──
      handler.setInputAction((click: { position: Cartesian2 }) => {
        viewer.scene.requestRender();

        // Close any open context menu
        useContextMenuStore.getState().close();

        const picked = viewer.scene.pick(click.position);
        if (picked) {
          const layerId = findLayerIdFromPick(picked);
          if (layerId) {
            useLayerStore.getState().setActiveLayer(layerId);
            useLayerStore.getState().setSelection([layerId]);
            console.log('[Viewer] Model picked:', layerId);
            return;
          }
        }
        // Click on empty space → deselect
        useLayerStore.getState().setActiveLayer(null);
        useLayerStore.getState().clearSelection();
      }, ScreenSpaceEventType.LEFT_CLICK);

      // ── RIGHT_CLICK: Pick model → context menu ──
      handler.setInputAction((click: { position: Cartesian2 }) => {
        viewer.scene.requestRender();

        const picked = viewer.scene.pick(click.position);
        if (picked) {
          const layerId = findLayerIdFromPick(picked);
          if (layerId) {
            const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
            const canvasRect = viewer.scene.canvas.getBoundingClientRect();
            const screenX = canvasRect.left + click.position.x;
            const screenY = canvasRect.top + click.position.y;
            useContextMenuStore.getState().open(
              screenX, screenY, layerId, layer?.name || 'Model'
            );
            useLayerStore.getState().setActiveLayer(layerId);
          }
        }
      }, ScreenSpaceEventType.RIGHT_CLICK);

      // Prevent default browser context menu on the Cesium canvas
      viewer.scene.canvas.addEventListener('contextmenu', (e: Event) => {
        e.preventDefault();
      });

      // Request render on user interaction
      handler.setInputAction(() => viewer.scene.requestRender(), ScreenSpaceEventType.LEFT_DOWN);
      handler.setInputAction(() => viewer.scene.requestRender(), ScreenSpaceEventType.LEFT_UP);
      handler.setInputAction(() => viewer.scene.requestRender(), ScreenSpaceEventType.WHEEL);
      handler.setInputAction(() => viewer.scene.requestRender(), ScreenSpaceEventType.RIGHT_DOWN);
      handler.setInputAction(() => viewer.scene.requestRender(), ScreenSpaceEventType.MIDDLE_DOWN);

      // ── FPS counter (frame-based, not timer-based) ──
      let frameCount = 0;
      let fpsLastTime = performance.now();

      const postRenderListener = () => {
        frameCount++;
        const now = performance.now();
        const elapsed = now - fpsLastTime;
        if (elapsed >= 1000) {
          const fps = Math.round((frameCount * 1000) / elapsed);
          setFps(fps);
          frameCount = 0;
          fpsLastTime = now;
        }
      };
      viewer.scene.postRender.addEventListener(postRenderListener);

      viewerRef.current = viewer;
      viewerInstance = viewer;

      // Start distance-based model culling for 10k+ OBJ scenes
      startDistanceCulling();

      // Store cleanup references
      (viewer as any).__cleanup = { postRenderListener, handler };
    };

    initViewer().catch(console.error);

    return () => {
      if (viewerRef.current) {
        const cleanup = (viewerRef.current as any).__cleanup;
        if (cleanup) {
          if (cleanup.postRenderListener) {
            viewerRef.current.scene.postRender.removeEventListener(cleanup.postRenderListener);
          }
          cleanup.handler.destroy();
        }
        if (!viewerRef.current.isDestroyed()) {
          viewerRef.current.destroy();
        }
      }
      viewerRef.current = null;
      viewerInstance = null;
    };
  }, []);

  return <div ref={containerRef} className="cesium-container" />;
};

export default CesiumViewer;
