import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { List as VirtualList } from 'react-window';
import { useLayerStore, type LayerItem } from '../stores/useLayerStore';
import { useContextMenuStore } from '../stores/useContextMenuStore';
import { unregisterModel, highlightModel } from '../viewers/cesium/CesiumModelRegistry';
import { removeImagery } from '../viewers/cesium/CesiumImageryRegistry';
import { removeDxfEntities } from '../loaders/DxfLoader';
import { removeShpEntities } from '../loaders/ShapefileLoader';
import { LAYER_PANEL } from '../config/defaults';

const VIRTUAL_THRESHOLD = 200;
const VIRTUAL_ITEM_HEIGHT = 28;

interface LayerPanelProps {
  onZoomToLayer: (layerId: string) => void;
}

const typeIcons: Record<string, string> = {
  OBJ: '🔷', FBX: '🔶', GLTF: '🟢', GLB: '🟢', GEOTIFF: '🗺️', DXF: '📐', SHP: '📊',
};

type SortMode = 'default' | 'name-asc' | 'name-desc' | 'visible-first' | 'hidden-first' | 'coord-x' | 'coord-y' | 'coord-z';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: '기본 순서' },
  { value: 'name-asc', label: '이름 오름차순 (A→Z)' },
  { value: 'name-desc', label: '이름 내림차순 (Z→A)' },
  { value: 'visible-first', label: '표시된 항목 우선' },
  { value: 'hidden-first', label: '숨겨진 항목 우선' },
  { value: 'coord-x', label: '📍 X좌표 (경도) 오름차순' },
  { value: 'coord-y', label: '📍 Y좌표 (위도) 오름차순' },
  { value: 'coord-z', label: '📍 Z좌표 (고도) 오름차순' },
];

function getCoord(item: LayerItem, axis: 0 | 1 | 2): number {
  return item.center?.[axis] ?? Infinity;
}

function sortLayers(items: LayerItem[], mode: SortMode): LayerItem[] {
  if (mode === 'default') return items;
  const sorted = [...items];
  switch (mode) {
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name, 'ko'));
      break;
    case 'visible-first':
      sorted.sort((a, b) => (a.visible === b.visible ? 0 : a.visible ? -1 : 1));
      break;
    case 'hidden-first':
      sorted.sort((a, b) => (a.visible === b.visible ? 0 : a.visible ? 1 : -1));
      break;
    case 'coord-x':
      sorted.sort((a, b) => getCoord(a, 0) - getCoord(b, 0));
      break;
    case 'coord-y':
      sorted.sort((a, b) => getCoord(a, 1) - getCoord(b, 1));
      break;
    case 'coord-z':
      sorted.sort((a, b) => getCoord(a, 2) - getCoord(b, 2));
      break;
  }
  return sorted;
}

/** Virtual row component for react-window v2.
 *  v2 spreads rowProps + { index, style } into the component props. */
interface VirtualChildRowProps {
  index: number;
  style: React.CSSProperties;
  sortedChildren: LayerItem[];
  activeLayerId: string | null;
  selectedLayerIds: Set<string>;
  handleItemClick: (id: string, e: React.MouseEvent) => void;
  onZoomToLayer: (id: string) => void;
  handleContextMenu: (id: string, name: string, e: React.MouseEvent) => void;
  toggleVisibility: (id: string) => void;
  [key: string]: any;
}

const VirtualChildRow: React.FC<VirtualChildRowProps> = ({
  index, style,
  sortedChildren, activeLayerId, selectedLayerIds,
  handleItemClick, onZoomToLayer, handleContextMenu, toggleVisibility,
}) => {
  const child = sortedChildren[index];
  if (!child) return null;
  const isChildSelected = selectedLayerIds.has(child.id);
  return (
    <div
      style={style}
      className={`layer-item child ${activeLayerId === child.id ? 'active' : ''} ${isChildSelected ? 'selected' : ''}`}
      data-layer-id={child.id}
      onClick={(e) => handleItemClick(child.id, e)}
      onDoubleClick={() => onZoomToLayer(child.id)}
      onContextMenu={(e) => handleContextMenu(child.id, child.name, e)}
      title="클릭: 이동 | Shift+클릭: 범위 선택 | 우클릭: 메뉴"
    >
      <input
        type="checkbox"
        checked={child.visible}
        onChange={(e) => { e.stopPropagation(); toggleVisibility(child.id); }}
      />
      <span className="layer-item-icon">{typeIcons[child.type] || '📄'}</span>
      <span className="layer-item-name">{child.name}</span>
    </div>
  );
};

const LayerPanel: React.FC<LayerPanelProps> = ({ onZoomToLayer }) => {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const collapsedGroups = useLayerStore((s) => s.collapsedGroups);
  const toggleVisibility = useLayerStore((s) => s.toggleVisibility);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const toggleGroupCollapse = useLayerStore((s) => s.toggleGroupCollapse);
  const toggleGroupVisibility = useLayerStore((s) => s.toggleGroupVisibility);
  const selectAll = useLayerStore((s) => s.selectAll);
  const clearSelection = useLayerStore((s) => s.clearSelection);
  const toggleSelection = useLayerStore((s) => s.toggleSelection);
  const removeLayers = useLayerStore((s) => s.removeLayers);

  const [searchText, setSearchText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Track last clicked item for Shift+Click range selection
  const lastClickedIdRef = useRef<string | null>(null);

  // ── Keyboard Shortcuts ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!panelRef.current?.contains(document.activeElement) &&
        document.activeElement !== panelRef.current) return;

    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }

    if (e.key === 'Delete') {
      if (selectedLayerIds.size > 0) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      } else if (activeLayerId) {
        e.preventDefault();
        useLayerStore.getState().setSelection([activeLayerId]);
        setShowDeleteConfirm(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      clearSelection();
      setShowDeleteConfirm(false);
      setShowSortMenu(false);
    }
  }, [selectAll, clearSelection, selectedLayerIds.size, activeLayerId]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Auto-scroll to active layer ──
  useEffect(() => {
    if (!activeLayerId || !panelRef.current) return;
    const el = panelRef.current.querySelector(`[data-layer-id="${activeLayerId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeLayerId]);

  // ── Delete confirmation ──
  const handleConfirmDelete = useCallback(() => {
    const idsToDelete = Array.from(selectedLayerIds);
    const allIds = new Set(idsToDelete);
    for (const id of idsToDelete) {
      const children = layers.filter((l) => l.groupId === id);
      for (const child of children) allIds.add(child.id);
    }
    for (const id of allIds) {
      const layer = layers.find((l) => l.id === id);
      if (layer?.type === 'GEOTIFF') {
        removeImagery(id);
      } else if (layer?.type === 'DXF') {
        removeDxfEntities(id);
      } else if (layer?.type === 'SHP') {
        removeShpEntities(id);
      } else {
        unregisterModel(id, true);
      }
    }
    removeLayers(Array.from(allIds));
    setShowDeleteConfirm(false);
  }, [selectedLayerIds, layers, removeLayers]);

  // ── Data computation ──
  const groupLayers = useMemo(() => {
    const topLevel = layers.filter((l) => !l.groupId);
    return sortLayers(topLevel, sortMode);
  }, [layers, sortMode]);
  const childrenByGroup = useMemo(() => {
    const map = new Map<string, LayerItem[]>();
    for (const child of layers) {
      if (!child.groupId) continue;
      const list = map.get(child.groupId) || [];
      list.push(child);
      map.set(child.groupId, list);
    }
    return map;
  }, [layers]);
  const folderGroupIds = useMemo(() => new Set(childrenByGroup.keys()), [childrenByGroup]);

  // ── Build flat list of visible IDs for Shift-range selection ──
  const flatVisibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const layer of groupLayers) {
      ids.push(layer.id);
      const isFolder = folderGroupIds.has(layer.id);
      if (isFolder && !collapsedGroups.has(layer.id)) {
        const children = childrenByGroup.get(layer.id) || [];
        const filtered = searchText
          ? children.filter((c) => c.name.toLowerCase().includes(searchText.toLowerCase()))
          : children;
        const sorted = sortLayers(filtered, sortMode);
        for (const child of sorted.slice(0, LAYER_PANEL.MAX_RENDERED)) {
          ids.push(child.id);
        }
      }
    }
    return ids;
  }, [groupLayers, folderGroupIds, collapsedGroups, childrenByGroup, searchText, sortMode]);

  // ── Click handler: Ctrl, Shift, or single ──
  const handleItemClick = useCallback((layerId: string, e: React.MouseEvent) => {
    if (e.ctrlKey) {
      // Ctrl+Click → toggle individual selection
      toggleSelection(layerId);
      lastClickedIdRef.current = layerId;
    } else if (e.shiftKey && lastClickedIdRef.current) {
      // Shift+Click → range selection
      e.preventDefault();
      const startIdx = flatVisibleIds.indexOf(lastClickedIdRef.current);
      const endIdx = flatVisibleIds.indexOf(layerId);
      if (startIdx !== -1 && endIdx !== -1) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        const rangeIds = flatVisibleIds.slice(lo, hi + 1);
        useLayerStore.getState().setSelection(rangeIds);
      }
    } else {
      // Single click → select + activate
      useLayerStore.getState().setSelection([layerId]);
      setActiveLayer(layerId);
      lastClickedIdRef.current = layerId;

      // Skip fly-to and highlight for GEOTIFF layers
      const layer = layers.find((l) => l.id === layerId);
      if (layer?.type !== 'GEOTIFF') {
        onZoomToLayer(layerId);
        highlightModel(layerId);
      }
    }
  }, [toggleSelection, setActiveLayer, onZoomToLayer, flatVisibleIds, layers]);

  // ── Right-click context menu ──
  const handleContextMenu = useCallback((layerId: string, layerName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().open(e.clientX, e.clientY, layerId, layerName);
    useLayerStore.getState().setActiveLayer(layerId);
    useLayerStore.getState().setSelection([layerId]);
  }, []);

  return (
    <div className="layer-panel" ref={panelRef} tabIndex={0} style={{ outline: 'none' }}>
      {/* ── Header ── */}
      <div className="layer-panel-header">
        📑 레이어 ({layers.length})
        {selectedLayerIds.size > 0 && (
          <span className="selection-badge">{selectedLayerIds.size}개 선택</span>
        )}
        {layers.length > 0 && (
          <button
            className="sort-btn"
            onClick={() => setShowSortMenu(!showSortMenu)}
            title="정렬"
          >
            ⇅
          </button>
        )}
      </div>

      {/* ── Sort dropdown ── */}
      {showSortMenu && (
        <div className="sort-menu">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`sort-menu-item ${sortMode === opt.value ? 'active' : ''}`}
              onClick={() => { setSortMode(opt.value); setShowSortMenu(false); }}
            >
              {sortMode === opt.value && '✓ '}{opt.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Search bar ── */}
      {layers.length > 10 && (
        <div className="layer-search">
          <input
            type="text"
            placeholder="🔍 모델 검색..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="layer-search-input"
          />
          {searchText && (
            <button className="layer-search-clear" onClick={() => setSearchText('')}>✕</button>
          )}
        </div>
      )}

      {/* ── Shortcut hint ── */}
      {layers.length > 0 && selectedLayerIds.size === 0 && (
        <div className="layer-shortcut-hint">
          Ctrl+A 전체 | Ctrl+클릭 다중 | Shift+클릭 범위
        </div>
      )}

      {/* ── Layer list ── */}
      <div className="layer-panel-list">
        {groupLayers.length === 0 ? (
          <div className="layer-empty">
            <span className="icon">📦</span>
            <span>로드된 레이어가 없습니다</span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              OBJ/FBX 파일을 드래그하거나<br />리본에서 파일을 열어 주세요
            </span>
          </div>
        ) : (
          groupLayers.map((layer) => {
            const isFolder = folderGroupIds.has(layer.id);
            const isCollapsed = collapsedGroups.has(layer.id);
            const allChildren = childrenByGroup.get(layer.id) || [];

            const filteredChildren = searchText
              ? allChildren.filter((c) => c.name.toLowerCase().includes(searchText.toLowerCase()))
              : allChildren;
            const sortedChildren = sortLayers(filteredChildren, sortMode);
            const visibleChildren = sortedChildren.slice(0, LAYER_PANEL.MAX_RENDERED);
            const hiddenCount = sortedChildren.length - visibleChildren.length;
            const isSelected = selectedLayerIds.has(layer.id);

            if (searchText && isFolder && filteredChildren.length === 0) return null;

            return (
              <React.Fragment key={layer.id}>
                {/* Group / top-level layer */}
                <div
                  className={`layer-item ${activeLayerId === layer.id ? 'active' : ''} ${isFolder ? 'group-header' : ''} ${isSelected ? 'selected' : ''}`}
                  data-layer-id={layer.id}
                  onClick={(e) => {
                    if (e.ctrlKey || e.shiftKey) {
                      handleItemClick(layer.id, e);
                    } else if (isFolder) {
                      toggleGroupCollapse(layer.id);
                    } else {
                      handleItemClick(layer.id, e);
                    }
                  }}
                  onDoubleClick={() => onZoomToLayer(layer.id)}
                  onContextMenu={(e) => handleContextMenu(layer.id, layer.name, e)}
                  title={isFolder ? '클릭: 펼침/접기 | Shift+클릭: 범위 선택' : '클릭: 이동 | Shift+클릭: 범위 선택'}
                >
                  {isFolder && (
                    <span className="group-toggle">{isCollapsed ? '▶' : '▼'}</span>
                  )}
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={(e) => {
                      e.stopPropagation();
                      isFolder ? toggleGroupVisibility(layer.id) : toggleVisibility(layer.id);
                    }}
                  />
                  <span className="layer-item-icon">{isFolder ? '' : (typeIcons[layer.type] || '📄')}</span>
                  <span className="layer-item-name">{layer.name}</span>
                  {isFolder && (
                    <span className="layer-item-type" style={{ marginLeft: 'auto' }}>
                      ({filteredChildren.length})
                    </span>
                  )}
                </div>

                {/* Children list */}
                {isFolder && !isCollapsed && (
                  <div className="group-children">
                    {searchText && (
                      <div className="group-search-result">
                        검색 결과: {filteredChildren.length.toLocaleString()}개
                      </div>
                    )}
                    {sortedChildren.length > VIRTUAL_THRESHOLD ? (
                      <VirtualList
                        style={{ height: Math.min(sortedChildren.length * VIRTUAL_ITEM_HEIGHT, 400) }}
                        rowCount={sortedChildren.length}
                        rowHeight={VIRTUAL_ITEM_HEIGHT}
                        overscanCount={10}
                        rowProps={{ sortedChildren, activeLayerId, selectedLayerIds, handleItemClick, onZoomToLayer, handleContextMenu, toggleVisibility }}
                        rowComponent={VirtualChildRow}
                      />
                    ) : (
                      visibleChildren.map((child) => {
                        const isChildSelected = selectedLayerIds.has(child.id);
                        return (
                          <div
                            key={child.id}
                            className={`layer-item child ${activeLayerId === child.id ? 'active' : ''} ${isChildSelected ? 'selected' : ''}`}
                            data-layer-id={child.id}
                            onClick={(e) => handleItemClick(child.id, e)}
                            onDoubleClick={() => onZoomToLayer(child.id)}
                            onContextMenu={(e) => handleContextMenu(child.id, child.name, e)}
                            title="클릭: 이동 | Shift+클릭: 범위 선택 | 우클릭: 메뉴"
                          >
                            <input
                              type="checkbox"
                              checked={child.visible}
                              onChange={(e) => { e.stopPropagation(); toggleVisibility(child.id); }}
                            />
                            <span className="layer-item-icon">{typeIcons[child.type] || '📄'}</span>
                            <span className="layer-item-name">{child.name}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* ── Delete Confirmation ── */}
      {showDeleteConfirm && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <div className="delete-confirm-title">⚠️ 모델 삭제 확인</div>
            <div className="delete-confirm-body">
              선택된 <strong>{selectedLayerIds.size}개</strong> 항목을 삭제하시겠습니까?
              <br /><span className="delete-confirm-warning">이 작업은 되돌릴 수 없습니다.</span>
            </div>
            <div className="delete-confirm-actions">
              <button className="delete-confirm-btn cancel" onClick={() => setShowDeleteConfirm(false)}>취소</button>
              <button className="delete-confirm-btn confirm" onClick={handleConfirmDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayerPanel;
