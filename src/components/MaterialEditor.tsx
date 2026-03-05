import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import * as THREE from 'three';
import { Palette, ChevronDown, ChevronRight } from 'lucide-react';

const MAX_STEP_SWATCHES = 96;

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

function toHexColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export default function MaterialEditor() {
  const { modelComponents, showEdges, toggleEdges } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [, forceUpdate] = useState({});
  const selectedComponent = modelComponents.find(c => c.selected);
  const selectedMesh =
    selectedComponent && selectedComponent.mesh instanceof THREE.Mesh
      ? selectedComponent.mesh
      : null;
  const selectedMaterials = selectedMesh ? getEditableMaterials(selectedMesh) : [];
  const material = selectedMaterials[0] ?? null;

  const stepPalette = useMemo(() => {
    if (!isOpen) {
      return { colors: [] as number[], hiddenCount: 0 };
    }

    const colorUseCount = new Map<number, number>();
    const visitedMaterials = new Set<THREE.Material>();

    for (const component of modelComponents) {
      if (!(component.mesh instanceof THREE.Mesh)) continue;
      const componentMaterials = getEditableMaterials(component.mesh);
      for (const componentMaterial of componentMaterials) {
        if (visitedMaterials.has(componentMaterial)) continue;
        visitedMaterials.add(componentMaterial);

        const originalColor = componentMaterial.userData?.originalStepColor;
        if (typeof originalColor === 'number') {
          colorUseCount.set(originalColor, (colorUseCount.get(originalColor) ?? 0) + 1);
        }
      }
    }

    const sortedColors = [...colorUseCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color);

    return {
      colors: sortedColors.slice(0, MAX_STEP_SWATCHES),
      hiddenCount: Math.max(0, sortedColors.length - MAX_STEP_SWATCHES),
    };
  }, [isOpen, modelComponents]);

  if (!selectedMesh || !material || selectedMaterials.length === 0) {
    return null;
  }

  const selectedOriginalStepColor =
    typeof material.userData?.originalStepColor === 'number'
      ? (material.userData.originalStepColor as number)
      : null;

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

  const applyStepPaletteColor = (hex: number) => {
    for (const entry of selectedMaterials) {
      entry.color.setHex(hex);
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const restoreSelectedStepColor = () => {
    for (const entry of selectedMaterials) {
      const originalColor =
        typeof entry.userData?.originalStepColor === 'number'
          ? (entry.userData.originalStepColor as number)
          : selectedOriginalStepColor;
      if (typeof originalColor !== 'number') continue;

      entry.color.setHex(originalColor);
      entry.needsUpdate = true;
    }
    triggerUpdate();
  };

  const restoreAllStepColors = () => {
    const processedMaterials = new Set<THREE.Material>();

    for (const component of modelComponents) {
      if (!(component.mesh instanceof THREE.Mesh)) continue;
      const componentMaterials = getEditableMaterials(component.mesh);
      for (const componentMaterial of componentMaterials) {
        if (processedMaterials.has(componentMaterial)) continue;
        processedMaterials.add(componentMaterial);

        const originalColor = componentMaterial.userData?.originalStepColor;
        if (typeof originalColor === 'number') {
          componentMaterial.color.setHex(originalColor);
          componentMaterial.needsUpdate = true;
        }
      }
    }

    triggerUpdate();
  };

  const colorHex = '#' + material.color.getHexString();

  return (
    <div className="material-editor">
      <button 
        className="material-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Palette size={18} />
        Material Editor
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      
      {isOpen && (
        <div className="material-controls">
          <div className="material-section">
            <label>Color</label>
            <input
              type="color"
              value={colorHex}
              onChange={(e) => handleColorChange(e.target.value)}
            />
          </div>

          {selectedOriginalStepColor !== null && (
            <div className="material-section">
              <label>Original STEP Color</label>
              <div className="step-color-actions">
                <button
                  className="step-color-button"
                  type="button"
                  onClick={restoreSelectedStepColor}
                >
                  Use Original
                </button>
                <span
                  className="step-color-chip"
                  style={{ backgroundColor: toHexColor(selectedOriginalStepColor) }}
                  title={toHexColor(selectedOriginalStepColor)}
                />
              </div>
            </div>
          )}

          {stepPalette.colors.length > 0 && (
            <div className="material-section">
              <label>STEP Palette</label>
              <div className="step-color-palette">
                {stepPalette.colors.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`step-color-swatch ${material.color.getHex() === hex ? 'active' : ''}`}
                    style={{ backgroundColor: toHexColor(hex) }}
                    onClick={() => applyStepPaletteColor(hex)}
                    title={toHexColor(hex)}
                  />
                ))}
              </div>
              {stepPalette.hiddenCount > 0 && (
                <div className="step-palette-note">
                  +{stepPalette.hiddenCount} more colors
                </div>
              )}
              <button
                className="step-color-button secondary"
                type="button"
                onClick={restoreAllStepColors}
              >
                Restore All STEP Colors
              </button>
            </div>
          )}

          <div className="material-section">
            <label>Metalness: {material.metalness.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={material.metalness}
              onChange={(e) => handleMetalnessChange(parseFloat(e.target.value))}
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
              onChange={(e) => handleRoughnessChange(parseFloat(e.target.value))}
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
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
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

          <div className="material-section">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showEdges}
                onChange={toggleEdges}
              />
              Show Edge Outlines
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
