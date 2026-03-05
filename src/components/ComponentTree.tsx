import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import MaterialEditor from './MaterialEditor';
import { Eye, EyeOff } from 'lucide-react';

export default function ComponentTree() {
  const { 
    modelComponents, 
    toggleComponentVisibility, 
    toggleComponentSelection 
  } = useStore();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const ROW_HEIGHT = 34;
  const OVERSCAN_ROWS = 12;

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;

    const updateHeight = () => {
      setViewportHeight(element.clientHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [modelComponents.length]);

  const visibleWindow = useMemo(() => {
    const visibleRows = Math.ceil((viewportHeight || 1) / ROW_HEIGHT);
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(
      modelComponents.length,
      start + visibleRows + OVERSCAN_ROWS * 2
    );

    return {
      start,
      end,
      totalHeight: modelComponents.length * ROW_HEIGHT,
      items: modelComponents.slice(start, end),
    };
  }, [modelComponents, scrollTop, viewportHeight]);

  if (modelComponents.length === 0) {
    return null;
  }

  return (
    <div className="component-tree">
      <div className="component-tree-header">
        <h3>Components</h3>
        <span className="component-count">{modelComponents.length}</span>
      </div>
      <div
        ref={listRef}
        className="component-list"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="component-list-inner" style={{ height: `${visibleWindow.totalHeight}px` }}>
        {visibleWindow.items.map((component, localIndex) => (
          <div
            key={component.id}
            className={`component-item ${component.selected ? 'selected' : ''}`}
            style={{ top: `${(visibleWindow.start + localIndex) * ROW_HEIGHT}px` }}
          >
            <div className="component-controls">
              <button
                className={`visibility-toggle ${component.visible ? 'visible' : 'hidden'}`}
                onClick={() => toggleComponentVisibility(component.id)}
                title={component.visible ? 'Hide' : 'Show'}
              >
                {component.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <div
                className="component-name"
                onClick={() => toggleComponentSelection(component.id)}
              >
                {component.name}
              </div>
            </div>
          </div>
        ))}
        </div>
      </div>
      <MaterialEditor />
    </div>
  );
}
