import { useStore } from '../store/useStore';
import MaterialEditor from './MaterialEditor';
import { Eye, EyeOff } from 'lucide-react';

export default function ComponentTree() {
  const { 
    modelComponents, 
    toggleComponentVisibility, 
    toggleComponentSelection 
  } = useStore();

  if (modelComponents.length === 0) {
    return null;
  }

  return (
    <div className="component-tree">
      <div className="component-tree-header">
        <h3>Components</h3>
        <span className="component-count">{modelComponents.length}</span>
      </div>
      <div className="component-list">
        {modelComponents.map((component) => (
          <div
            key={component.id}
            className={`component-item ${component.selected ? 'selected' : ''}`}
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
      <MaterialEditor />
    </div>
  );
}
