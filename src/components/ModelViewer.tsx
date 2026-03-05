import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, type ModelFileData } from '../store/useStore';
import { fetchFileContent } from '../utils/github';
import { loadModel } from '../utils/modelLoader';

function CameraController({ model }: { model: THREE.Group | null }) {
  const { camera, controls } = useThree();

  useEffect(() => {
    if (!model || !controls) return;

    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Calculate the distance needed to fit the entire model
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

    // Add some padding (multiply by 1.5 for better initial view)
    cameraZ *= 1.5;

    // Position camera
    camera.position.set(cameraZ, cameraZ, cameraZ);
    camera.lookAt(center);

    // Update controls target to model center
    if (controls && 'target' in controls) {
      (controls as any).target.copy(center);
      (controls as any).update();
    }

    // Update camera
    camera.updateProjectionMatrix();
  }, [model, camera, controls]);

  return null;
}

export default function ModelViewer() {
  const { selectedFile, setModelComponents, setIsLoading, setError, modelComponents, toggleComponentSelection, isLoading, showEdges, loadProgress } = useStore();
  const modelRef = useRef<THREE.Group | null>(null);
  const [currentModel, setCurrentModel] = useState<THREE.Group | null>(null);
  const edgeLinesRef = useRef<THREE.LineSegments[]>([]);

  const handleMeshClick = (event: any) => {
    event.stopPropagation();
    const clickedMesh = event.object;
    
    // Find the component that matches this mesh
    const component = modelComponents.find(c => c.mesh === clickedMesh || c.mesh.uuid === clickedMesh.uuid);
    if (component) {
      toggleComponentSelection(component.id);
    }
  };

  useEffect(() => {
    if (!selectedFile) return;

    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const file = selectedFile as ModelFileData;
        const { setLoadProgress } = useStore.getState();
        setLoadProgress(0);
        const content = await fetchFileContent(file.url, (loaded, total) => {
          if (total > 0) setLoadProgress(Math.round((loaded / total) * 100));
        });
        setLoadProgress(100);
        const { model, components } = await loadModel(file, content);

        if (isMounted) {
          // Clear previous edge lines
          edgeLinesRef.current = [];
          
          // Enable shadows and fix transparency rendering on all meshes
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              
              // Ensure normals exist for proper shading
              if (child.geometry && !child.geometry.attributes.normal) {
                child.geometry.computeVertexNormals();
              }
              
              // Fix transparency rendering order
              if (child.material) {
                const material = child.material as THREE.MeshStandardMaterial;
                if (material.transparent && material.opacity < 1) {
                  // Disable depth write for transparent materials to prevent z-fighting
                  material.depthWrite = false;
                  // Set proper render order
                  child.renderOrder = 1;
                }
              }
              
              // Add dark purple edge outlines
              const edges = new THREE.EdgesGeometry(child.geometry, 15);
              const edgeMaterial = new THREE.LineBasicMaterial({ 
                color: 0x4a148c,  // Dark purple
                linewidth: 1
              });
              const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
              edgeLines.visible = showEdges;
              child.add(edgeLines);
              edgeLinesRef.current.push(edgeLines);
            }
          });

          modelRef.current = model;
          setCurrentModel(model);
          setModelComponents(components);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error loading model:', error);
        if (isMounted) {
          setError(error instanceof Error ? error.message : 'Failed to load model');
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [selectedFile, setModelComponents, setIsLoading, setError]);

  // Update component visibility
  useEffect(() => {
    if (!modelRef.current) return;

    modelComponents.forEach(component => {
      component.mesh.visible = component.visible;
    });
  }, [modelComponents]);

  // Update edge lines visibility
  useEffect(() => {
    edgeLinesRef.current.forEach(edgeLine => {
      edgeLine.visible = showEdges;
    });
  }, [showEdges]);

  return (
    <div className="model-viewer">
      {isLoading && (
        <div className="model-loading-indicator">
          <div className="spinner"></div>
          <p>{loadProgress > 0 && loadProgress < 100 ? `Downloading… ${loadProgress}%` : 'Processing model…'}</p>
        </div>
      )}
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[5, 5, 5]} />
        <OrbitControls makeDefault />
        <CameraController model={currentModel} />
        
        {/* Lighting - Sharp dramatic setup */}
        <ambientLight intensity={0.2} />
        
        {/* Main key light - strong shadows */}
        <directionalLight
          position={[10, 15, 8]}
          intensity={2.5}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-bias={-0.001}
          shadow-normalBias={0.05}
        />
        
        {/* Fill lights - multi-angle illumination */}
        <directionalLight position={[-8, 8, -8]} intensity={0.8} />
        <directionalLight position={[0, -10, 5]} intensity={1.5} />
        <directionalLight position={[5, 5, -10]} intensity={0.6} />
        
        {/* Rim light for edge separation */}
        <directionalLight position={[-10, 2, 10]} intensity={1.0} />
        
        {/* Shadow-catching ground plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <shadowMaterial transparent opacity={0.3} />
        </mesh>
        
        {/* Environment */}
        <Environment preset="studio" />
        
        {/* Grid */}
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#6d28d9"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#8b5cf6"
          fadeDistance={30}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />
        
        {/* Model */}
        {modelRef.current && <primitive object={modelRef.current} onClick={handleMeshClick} />}
      </Canvas>
    </div>
  );
}
