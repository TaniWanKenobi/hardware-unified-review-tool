import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, type ModelFileData, type ModelComponent } from '../store/useStore';
import { fetchFileContent } from '../utils/github';
import { loadModel, loadStepFromServer } from '../utils/modelLoader';
import {
  estimateDownloadSeconds,
  estimateProcessingSeconds,
  updateDownloadRate,
  updateProcessingEstimate,
} from '../utils/loadMetrics';

type LoadStage = 'idle' | 'converting' | 'downloading' | 'processing';

function disposeObject3DResources(object: THREE.Object3D) {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (!disposedGeometries.has(child.geometry)) {
        child.geometry.dispose();
        disposedGeometries.add(child.geometry);
      }
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => {
          if (!disposedMaterials.has(material)) {
            material.dispose();
            disposedMaterials.add(material);
          }
        });
      } else if (child.material) {
        if (!disposedMaterials.has(child.material)) {
          child.material.dispose();
          disposedMaterials.add(child.material);
        }
      }
    }

    if (child instanceof THREE.LineSegments) {
      if (!disposedGeometries.has(child.geometry)) {
        child.geometry.dispose();
        disposedGeometries.add(child.geometry);
      }
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => {
          if (!disposedMaterials.has(material)) {
            material.dispose();
            disposedMaterials.add(material);
          }
        });
      } else if (child.material) {
        if (!disposedMaterials.has(child.material)) {
          child.material.dispose();
          disposedMaterials.add(child.material);
        }
      }
    }
  });
}

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

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  if (safeSeconds <= 1) return 'ETA < 1s';
  if (safeSeconds < 60) return `ETA ${safeSeconds}s`;

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (remainingSeconds === 0) return `ETA ${minutes}m`;
  return `ETA ${minutes}m ${remainingSeconds}s`;
}

function blendEta(liveSeconds: number | null, modeledSeconds: number | null): number | null {
  if (liveSeconds !== null && modeledSeconds !== null) {
    return liveSeconds * 0.7 + modeledSeconds * 0.3;
  }
  return liveSeconds ?? modeledSeconds;
}

export default function ModelViewer() {
  const {
    selectedFile,
    setModelComponents,
    setIsLoading,
    setError,
    modelComponents,
    toggleComponentSelection,
    isLoading,
    showEdges,
    loadProgress,
    performanceMode,
  } = useStore();
  const modelRef = useRef<THREE.Group | null>(null);
  const [currentModel, setCurrentModel] = useState<THREE.Group | null>(null);
  const [loadStage, setLoadStage] = useState<LoadStage>('idle');
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const edgeLinesRef = useRef<THREE.LineSegments[]>([]);
  const etaIntervalRef = useRef<number | null>(null);
  const LARGE_MODEL_BYTES = 8 * 1024 * 1024;
  const STEP_PREVIEW_THRESHOLD_BYTES = 12 * 1024 * 1024;
  const MAX_EDGE_MESH_COUNT = 300;
  const selectedModelFile =
    selectedFile?.kind === 'model' ? (selectedFile as ModelFileData) : null;
  const selectedFileSize = typeof selectedModelFile?.size === 'number' ? selectedModelFile.size : 0;
  const autoPerfForLargeFile = selectedFileSize >= LARGE_MODEL_BYTES;
  const effectivePerformanceMode = performanceMode || autoPerfForLargeFile;

  const clearEtaCountdown = () => {
    if (etaIntervalRef.current !== null) {
      window.clearInterval(etaIntervalRef.current);
      etaIntervalRef.current = null;
    }
  };

  const startEtaCountdown = (seconds: number | null) => {
    clearEtaCountdown();

    if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
      setEtaSeconds(null);
      return;
    }

    let remaining = Math.max(0, seconds);
    setEtaSeconds(Math.ceil(remaining));
    etaIntervalRef.current = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      setEtaSeconds(Math.ceil(remaining));
      if (remaining <= 0) {
        clearEtaCountdown();
      }
    }, 1000);
  };

  const getLoadingMessage = () => {
    let base = 'Processing model...';
    if (loadStage === 'converting') {
      base = 'Converting STEP on server...';
    } else if (loadStage === 'downloading') {
      base =
        loadProgress > 0 && loadProgress < 100
          ? `Downloading... ${loadProgress}%`
          : 'Downloading...';
    } else if (loadStage === 'processing') {
      base = 'Processing model...';
    } else if (loadProgress > 0 && loadProgress < 100) {
      base = `Downloading... ${loadProgress}%`;
    }

    const etaLabel = formatEta(etaSeconds);
    return etaLabel ? `${base} (${etaLabel})` : base;
  };

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
    const controller = new AbortController();

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        setCurrentModel(null);
        edgeLinesRef.current = [];

        if (modelRef.current) {
          disposeObject3DResources(modelRef.current);
          modelRef.current = null;
        }

        const file = selectedFile as ModelFileData;
        const isStepFile = file.type === 'step' || file.type === 'stp';
        const shouldUseStepPreview =
          isStepFile &&
          (effectivePerformanceMode ||
            (typeof file.size === 'number' && file.size >= STEP_PREVIEW_THRESHOLD_BYTES));
        const { setLoadProgress } = useStore.getState();
        const fileSizeBytes = typeof file.size === 'number' && file.size > 0 ? file.size : 0;
        clearEtaCountdown();
        setEtaSeconds(null);
        setLoadStage('downloading');
        setLoadProgress(0);
        let loadedModel: { model: THREE.Group; components: ModelComponent[] } | null = null;

        // Server-side STEP->GLB conversion is substantially faster for large STEP files.
        if (isStepFile) {
          try {
            setLoadStage('converting');
            startEtaCountdown(estimateProcessingSeconds('server-step', fileSizeBytes));
            const serverStart = performance.now();
            let firstServerDownloadAt = 0;

            const serverResult = await loadStepFromServer(file, {
              preview: shouldUseStepPreview,
              signal: controller.signal,
              onProgress: (loaded, total) => {
                if (firstServerDownloadAt === 0) {
                  firstServerDownloadAt = performance.now();
                  clearEtaCountdown();
                  setLoadStage('downloading');
                }

                const downloadElapsedSeconds =
                  firstServerDownloadAt > 0
                    ? (performance.now() - firstServerDownloadAt) / 1000
                    : 0;

                if (downloadElapsedSeconds >= 0.5) {
                  updateDownloadRate(loaded, downloadElapsedSeconds);
                }

                if (total > 0) {
                  const progress = Math.round((loaded / total) * 100);
                  setLoadProgress(Math.min(99, Math.max(1, progress)));

                  const remaining = Math.max(total - loaded, 0);
                  const liveEta =
                    loaded > 0 && downloadElapsedSeconds > 0
                      ? remaining / (loaded / downloadElapsedSeconds)
                      : null;
                  const modeledEta = estimateDownloadSeconds(remaining);
                  const combinedEta = blendEta(liveEta, modeledEta);
                  if (combinedEta !== null) {
                    setEtaSeconds(Math.max(0, Math.ceil(combinedEta)));
                  }
                }
              },
            });

            if (serverResult) {
              const serverElapsedSeconds = (performance.now() - serverStart) / 1000;
              if (fileSizeBytes > 0) {
                updateProcessingEstimate('server-step', fileSizeBytes, serverElapsedSeconds);
              }
              clearEtaCountdown();
              setEtaSeconds(null);
              setLoadStage('idle');
              loadedModel = serverResult;
              setLoadProgress(100);
            }
          } catch (serverError) {
            if (serverError instanceof DOMException && serverError.name === 'AbortError') {
              throw serverError;
            }
            clearEtaCountdown();
            setEtaSeconds(null);
            console.warn('Server STEP conversion failed, falling back to client parser:', serverError);
          }
        }

        if (!loadedModel) {
          const processingProfile = isStepFile ? 'client-step' : 'model-generic';
          const processingEtaEstimate = estimateProcessingSeconds(
            processingProfile,
            fileSizeBytes
          );
          const downloadStart = performance.now();
          setLoadStage('downloading');

          const content = await fetchFileContent(
            file.url,
            (loaded, total) => {
              if (total > 0) {
                setLoadProgress(Math.round((loaded / total) * 100));
              }

              const downloadElapsedSeconds = (performance.now() - downloadStart) / 1000;
              if (downloadElapsedSeconds >= 0.5) {
                updateDownloadRate(loaded, downloadElapsedSeconds);
              }

              const fallbackTotal = total > 0 ? total : fileSizeBytes;
              if (fallbackTotal > 0) {
                const remaining = Math.max(fallbackTotal - loaded, 0);
                const liveEta =
                  loaded > 0 && downloadElapsedSeconds > 0
                    ? remaining / (loaded / downloadElapsedSeconds)
                    : null;
                const modeledDownloadEta = estimateDownloadSeconds(remaining);
                const blendedDownloadEta = blendEta(liveEta, modeledDownloadEta);
                const totalEta =
                  blendedDownloadEta !== null
                    ? blendedDownloadEta + (processingEtaEstimate ?? 0)
                    : processingEtaEstimate;
                if (totalEta !== null) {
                  setEtaSeconds(Math.max(0, Math.ceil(totalEta)));
                }
              }
            },
            controller.signal
          );

          const downloadElapsedSeconds = (performance.now() - downloadStart) / 1000;
          updateDownloadRate(content.byteLength, downloadElapsedSeconds);
          setLoadProgress(100);
          setLoadStage('processing');
          startEtaCountdown(
            processingEtaEstimate ??
              estimateProcessingSeconds(processingProfile, content.byteLength)
          );
          const parseStart = performance.now();
          loadedModel = await loadModel(file, content, {
            stepPreview: shouldUseStepPreview,
            enableStepCache: true,
          });
          const parseElapsedSeconds = (performance.now() - parseStart) / 1000;
          updateProcessingEstimate(
            processingProfile,
            fileSizeBytes > 0 ? fileSizeBytes : content.byteLength,
            parseElapsedSeconds
          );
          clearEtaCountdown();
          setEtaSeconds(null);
          setLoadStage('idle');
        }

        const { model, components } = loadedModel;

        if (isMounted) {
          // Clear previous edge lines
          edgeLinesRef.current = [];
          const meshes: THREE.Mesh[] = [];
          let meshCount = 0;
          
          // Enable shadows and fix transparency rendering on all meshes
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              meshes.push(child);
              meshCount++;
              child.castShadow = !effectivePerformanceMode;
              child.receiveShadow = !effectivePerformanceMode;
              
              // Ensure normals exist for proper shading
              if (
                !effectivePerformanceMode &&
                child.geometry &&
                !child.geometry.attributes.normal
              ) {
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
              
            }
          });

          const fileSize = typeof file.size === 'number' ? file.size : 0;
          const shouldSkipEdges =
            effectivePerformanceMode ||
            fileSize >= LARGE_MODEL_BYTES ||
            meshCount > MAX_EDGE_MESH_COUNT;

          if (!shouldSkipEdges) {
            for (const mesh of meshes) {
              if (mesh instanceof THREE.InstancedMesh) {
                continue;
              }
              const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
              const edgeMaterial = new THREE.LineBasicMaterial({
                color: 0x4a148c,
                linewidth: 1
              });
              const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
              edgeLines.visible = showEdges;
              mesh.add(edgeLines);
              edgeLinesRef.current.push(edgeLines);
            }
          }

          modelRef.current = model;
          setCurrentModel(model);
          setModelComponents(components);
          setIsLoading(false);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          clearEtaCountdown();
          setLoadStage('idle');
          setEtaSeconds(null);
          return;
        }

        clearEtaCountdown();
        setLoadStage('idle');
        setEtaSeconds(null);
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
      controller.abort();
      clearEtaCountdown();
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
      edgeLine.visible = showEdges && !effectivePerformanceMode;
    });
  }, [showEdges, effectivePerformanceMode]);

  useEffect(() => {
    if (!modelRef.current) return;

    modelRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = !effectivePerformanceMode;
        child.receiveShadow = !effectivePerformanceMode;
      }
    });
  }, [effectivePerformanceMode]);

  useEffect(() => {
    return () => {
      clearEtaCountdown();
      if (modelRef.current) {
        disposeObject3DResources(modelRef.current);
      }
      edgeLinesRef.current = [];
    };
  }, []);

  return (
    <div className="model-viewer">
      {isLoading && (
        <div className="model-loading-indicator">
          <div className="spinner"></div>
          <div className="model-loading-progress">
            <div className="model-loading-progress-track">
              <div
                className={`model-loading-progress-fill ${
                  loadProgress > 0 && loadProgress < 100 ? '' : 'indeterminate'
                }`}
                style={
                  loadProgress > 0 && loadProgress < 100
                    ? { width: `${Math.max(2, Math.min(loadProgress, 100))}%` }
                    : undefined
                }
              />
            </div>
            <div className="model-loading-progress-label">
              {loadProgress > 0 && loadProgress < 100
                ? `${Math.round(loadProgress)}%`
                : loadStage === 'processing'
                  ? 'Finalizing...'
                  : 'Preparing...'}
            </div>
          </div>
          <p>{getLoadingMessage()}</p>
        </div>
      )}
      <Canvas
        shadows={!effectivePerformanceMode}
        dpr={effectivePerformanceMode ? [1, 1.25] : [1, 2]}
        frameloop={effectivePerformanceMode ? 'demand' : 'always'}
        gl={{
          powerPreference: 'high-performance',
          antialias: !effectivePerformanceMode,
        }}
      >
        <PerspectiveCamera makeDefault position={[5, 5, 5]} />
        <OrbitControls makeDefault />
        <CameraController model={currentModel} />
        
        <ambientLight intensity={effectivePerformanceMode ? 0.6 : 0.2} />

        <directionalLight
          position={[10, 15, 8]}
          intensity={effectivePerformanceMode ? 1.2 : 2.5}
          castShadow={!effectivePerformanceMode}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-bias={-0.001}
          shadow-normalBias={0.05}
        />

        {!effectivePerformanceMode && (
          <>
            <directionalLight position={[-8, 8, -8]} intensity={0.8} />
            <directionalLight position={[0, -10, 5]} intensity={1.5} />
            <directionalLight position={[5, 5, -10]} intensity={0.6} />
            <directionalLight position={[-10, 2, 10]} intensity={1.0} />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
              <planeGeometry args={[200, 200]} />
              <shadowMaterial transparent opacity={0.3} />
            </mesh>

            <Environment preset="studio" />
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
          </>
        )}
        
        {/* Model */}
        {modelRef.current && <primitive object={modelRef.current} onClick={handleMeshClick} />}
      </Canvas>
    </div>
  );
}
