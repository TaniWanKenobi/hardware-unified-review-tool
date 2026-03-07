import { useState } from 'react';
import { useStore } from '../store/useStore';
import * as THREE from 'three';
import { Palette, ChevronDown, ChevronRight } from 'lucide-react';

function getEditableMaterials(mesh: THREE.Mesh): THREE.MeshStandardMaterial[] {
  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    return [mesh.material];
  }

  if (Array.isArray(mesh.material)) {
    return mesh.material.filter(
      (material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial
    );
  }

  return [];
}

export default function MaterialEditor() {
  const { modelComponents, showEdges, toggleEdges } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [, forceUpdate] = useState({});
  const selectedComponent = modelComponents.find((component) => component.selected);
  const selectedMesh =
    selectedComponent && selectedComponent.mesh instanceof THREE.Mesh
      ? selectedComponent.mesh
      : null;
  const selectedMaterials = selectedMesh ? getEditableMaterials(selectedMesh) : [];
  const material = selectedMaterials[0] ?? null;
  const canEditMaterial = Boolean(selectedMesh && material && selectedMaterials.length > 0);

  const triggerUpdate = () => {
    forceUpdate({});
  };

  const handleColorChange = (color: string) => {
    for (const entry of selectedMaterials) {
      entry.color.set(color);
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const handleMetalnessChange = (value: number) => {
    for (const entry of selectedMaterials) {
      entry.metalness = value;
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const handleRoughnessChange = (value: number) => {
    for (const entry of selectedMaterials) {
      entry.roughness = value;
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const handleOpacityChange = (value: number) => {
    for (const entry of selectedMaterials) {
      entry.opacity = value;
      entry.transparent = value < 1;
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const handleWireframeToggle = () => {
    const next = !material.wireframe;
    for (const entry of selectedMaterials) {
      entry.wireframe = next;
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const handleFlatShadingToggle = () => {
    const next = !material.flatShading;
    for (const entry of selectedMaterials) {
      entry.flatShading = next;
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const colorHex = material ? `#${material.color.getHexString()}` : '#ffffff';

  return (
    <div className="material-editor">
      <button className="material-toggle" onClick={() => setIsOpen(!isOpen)}>
        <Palette size={18} />
        Material Editor
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      {isOpen && (
        <div className="material-controls">
          {canEditMaterial ? (
            <>
              <div className="material-section">
                <label>Color</label>
                <input
                  type="color"
                  value={colorHex}
                  title="Material color"
                  aria-label="Material color"
                  onChange={(event) => handleColorChange(event.target.value)}
                />
              </div>

              <div className="material-section">
                <label>Metalness: {material.metalness.toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={material.metalness}
                  title="Material metalness"
                  aria-label="Material metalness"
                  onChange={(event) => handleMetalnessChange(parseFloat(event.target.value))}
                />
              </div>

              <div className="material-section">
                <label>Roughness: {material.roughness.toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={material.roughness}
                  title="Material roughness"
                  aria-label="Material roughness"
                  onChange={(event) => handleRoughnessChange(parseFloat(event.target.value))}
                />
              </div>

              <div className="material-section">
                <label>Opacity: {material.opacity.toFixed(2)}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={material.opacity}
                  title="Material opacity"
                  aria-label="Material opacity"
                  onChange={(event) => handleOpacityChange(parseFloat(event.target.value))}
                />
              </div>

              <div className="material-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={material.wireframe}
                    onChange={handleWireframeToggle}
                  />
                  Wireframe Mode
                </label>
              </div>

              <div className="material-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={material.flatShading}
                    onChange={handleFlatShadingToggle}
                  />
                  Flat Shading
                </label>
              </div>
            </>
          ) : (
            <p className="material-empty-hint">Select a mesh in the component list or viewport to edit material.</p>
          )}

          <div className="material-section">
            <label className="checkbox-label">
              <input type="checkbox" checked={showEdges} onChange={toggleEdges} />
              Show Edge Outlines
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
