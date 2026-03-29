import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Layout, Model, IJsonModel, Actions } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import CesiumViewer from '../viewers/cesium/CesiumViewer';
import LayerPanel from '../panels/LayerPanel';
import FileDropZone from '../features/fileImport/FileDropZone';
import { flyToLayer } from '../loaders/ModelLoader';

const defaultLayout: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    splitterSize: 3,
    tabSetTabStripHeight: 28,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 20,
        minWidth: 200,
        children: [
          {
            type: 'tab',
            name: '레이어',
            component: 'layer-panel',
          },
        ],
      },
      {
        type: 'tabset',
        weight: 80,
        children: [
          {
            type: 'tab',
            name: '3D 뷰어',
            component: 'cesium-viewer',
          },
        ],
      },
    ],
  },
};

const DockLayout: React.FC = () => {
  const modelRef = useRef<Model>(Model.fromJson(defaultLayout));

  const handleZoomToLayer = useCallback((layerId: string) => {
    flyToLayer(layerId);
  }, []);

  const factory = useCallback((node: any) => {
    const component = node.getComponent();
    switch (component) {
      case 'cesium-viewer':
        return (
          <FileDropZone>
            <CesiumViewer />
          </FileDropZone>
        );
      case 'layer-panel':
        return <LayerPanel onZoomToLayer={handleZoomToLayer} />;
      default:
        return <div>Unknown component: {component}</div>;
    }
  }, [handleZoomToLayer]);

  return (
    <Layout
      model={modelRef.current}
      factory={factory}
    />
  );
};

export default DockLayout;
