import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { ModelFileData, ModelComponent } from '../store/useStore';
import type { StepWorkerResult, StepWorkerMesh } from './stepTypes';
import {
  createStepCacheKey,
  getStepCacheValue,
  setStepCacheValue,
} from './stepCache';

type StlWorkerResponse =
  | { id: number; success: true; result: StlWorkerResult }
  | { id: number; success: false; error: string };

interface StlWorkerResult {
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | null;
}

type StepWorkerResponse =
  | { id: number; success: true; result: StepWorkerResult }
  | { id: number; success: false; error: string };

export interface LoadModelOptions {
  stepPreview?: boolean;
  enableStepCache?: boolean;
}

export interface ServerStepLoadOptions {
  preview: boolean;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

interface StepMeshBuildData {
  sourceId: string;
  sourceIndex: number;
  name: string;
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | null;
  center: THREE.Vector3;
  extent: THREE.Vector3;
  material: THREE.MeshStandardMaterial;
  signature: string | null;
}

interface StepSpatialStats {
  center: THREE.Vector3;
  extent: THREE.Vector3;
}

const STEP_SIGNATURE_SCALE = 10000;
const STEP_SIGNATURE_VERTEX_SAMPLES = 96;
const STEP_SIGNATURE_INDEX_SAMPLES = 192;
const STEP_COMPARE_VERTEX_SAMPLES = 80;
const STEP_COMPARE_INDEX_SAMPLES = 160;
const STEP_COMPARE_EPSILON = 1 / STEP_SIGNATURE_SCALE;
const STEP_MIN_INSTANCE_COUNT = 2;

function freezeStaticTransforms(object: THREE.Object3D): void {
  object.traverse((child) => {
    child.updateMatrix();
    child.matrixAutoUpdate = false;
  });
  object.updateMatrixWorld(true);
}

async function readResponseBufferWithProgress(
  response: Response,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  if (!response.body || !onProgress) {
    return response.arrayBuffer();
  }

  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  const reader = response.body.getReader();
  let loaded = 0;
  let capacity = total > 0 ? total : 1024 * 1024;
  let buffer = new Uint8Array(capacity);

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    if (loaded + value.byteLength > buffer.length) {
      while (loaded + value.byteLength > capacity) {
        capacity *= 2;
      }
      const grown = new Uint8Array(capacity);
      grown.set(buffer, 0);
      buffer = grown;
    }

    buffer.set(value, loaded);
    loaded += value.byteLength;
    onProgress(loaded, Math.max(total, loaded));
  }

  return buffer.slice(0, loaded).buffer as ArrayBuffer;
}

function isLikelyGlbResponse(response: Response): boolean {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType) return true;

  if (
    contentType.includes('model/gltf-binary') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/gltf-buffer')
  ) {
    return true;
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('html')
  ) {
    return false;
  }

  return true;
}

export async function loadStepFromServer(
  file: ModelFileData,
  options: ServerStepLoadOptions
): Promise<{ model: THREE.Group; components: ModelComponent[] } | null> {
  if (file.type !== 'step' && file.type !== 'stp') {
    return null;
  }

  const params = new URLSearchParams({
    url: file.url,
    preview: options.preview ? '1' : '0',
    format: 'v3',
  });

  const response = await fetch(`/api/step-to-glb?${params.toString()}`, {
    signal: options.signal,
    headers: {
      Accept: 'model/gltf-binary',
    },
  });

  if (!response.ok) {
    return null;
  }

  // In local Vite dev, /api routes may resolve to source files or HTML.
  // Only attempt GLB parsing when payload type looks binary.
  if (!isLikelyGlbResponse(response)) {
    return null;
  }

  const glb = await readResponseBufferWithProgress(response, options.onProgress);
  if (glb.byteLength < 4) {
    return null;
  }

  const magic = new TextDecoder().decode(new Uint8Array(glb, 0, 4));
  if (magic !== 'glTF') {
    return null;
  }

  return loadGLTF(glb, new GLTFLoader());
}

let stlWorker: Worker | null = null;
let stlRequestId = 0;
const pendingStlRequests = new Map<
  number,
  {
    resolve: (value: StlWorkerResult) => void;
    reject: (reason?: unknown) => void;
    timeoutHandle: number;
  }
>();

let stepWorker: Worker | null = null;
let stepRequestId = 0;
const pendingStepRequests = new Map<
  number,
  {
    resolve: (value: StepWorkerResult) => void;
    reject: (reason?: unknown) => void;
    timeoutHandle: number;
  }
>();

function getStlWorker(): Worker {
  if (stlWorker) return stlWorker;

  const worker = new Worker(new URL('../workers/stlWorker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent<StlWorkerResponse>) => {
    const payload = event.data;
    const pending = pendingStlRequests.get(payload.id);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    pendingStlRequests.delete(payload.id);

    if (payload.success) {
      pending.resolve(payload.result);
      return;
    }

    pending.reject(new Error(payload.error || 'STL worker failed'));
  };

  worker.onerror = (event: ErrorEvent) => {
    for (const [, pending] of pendingStlRequests) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(event.message || 'STL worker crashed'));
    }
    pendingStlRequests.clear();

    worker.terminate();
    if (stlWorker === worker) {
      stlWorker = null;
    }
  };

  stlWorker = worker;
  return worker;
}

function parseStlWithWorker(
  content: ArrayBuffer,
  timeoutMs: number = 120000
): Promise<StlWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = getStlWorker();
    const id = ++stlRequestId;
    const timeoutHandle = globalThis.setTimeout(() => {
      pendingStlRequests.delete(id);
      reject(
        new Error(`STL parsing timed out after ${Math.round(timeoutMs / 1000)} seconds`)
      );

      worker.terminate();
      if (stlWorker === worker) {
        stlWorker = null;
      }
    }, timeoutMs);

    pendingStlRequests.set(id, { resolve, reject, timeoutHandle });
    worker.postMessage({ id, buffer: content }, [content]);
  });
}

function getStepWorker(): Worker {
  if (stepWorker) return stepWorker;

  const worker = new Worker('/occt-step-worker.js');

  worker.onmessage = (event: MessageEvent<StepWorkerResponse>) => {
    const payload = event.data;
    const pending = pendingStepRequests.get(payload.id);
    if (!pending) return;

    clearTimeout(pending.timeoutHandle);
    pendingStepRequests.delete(payload.id);

    if (payload.success) {
      pending.resolve(payload.result);
      return;
    }

    pending.reject(new Error(payload.error || 'STEP worker failed'));
  };

  worker.onerror = (event: ErrorEvent) => {
    for (const [, pending] of pendingStepRequests) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(event.message || 'STEP worker crashed'));
    }
    pendingStepRequests.clear();

    worker.terminate();
    if (stepWorker === worker) {
      stepWorker = null;
    }
  };

  stepWorker = worker;
  return worker;
}

function parseStepWithWorker(
  content: ArrayBuffer,
  _filename: string,
  timeoutMs: number | null = null,
  preview: boolean = false
): Promise<StepWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = getStepWorker();
    const id = ++stepRequestId;
    const timeoutHandle =
      typeof timeoutMs === 'number' && timeoutMs > 0
        ? globalThis.setTimeout(() => {
            pendingStepRequests.delete(id);
            reject(
              new Error(
                `STEP parsing timed out after ${Math.round(timeoutMs / 1000)} seconds`
              )
            );

            worker.terminate();
            if (stepWorker === worker) {
              stepWorker = null;
            }
          }, timeoutMs)
        : -1;

    pendingStepRequests.set(id, { resolve, reject, timeoutHandle });
    worker.postMessage({ id, buffer: content, preview }, [content]);
  });
}

export async function loadModel(
  file: ModelFileData,
  content: ArrayBuffer,
  options: LoadModelOptions = {}
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  switch (file.type) {
    case 'stl':
      return loadSTL(content);
    case 'obj':
      return loadOBJ(content, new OBJLoader());
    case 'gltf':
    case 'glb':
      return loadGLTF(content, new GLTFLoader());
    case 'ply':
      return loadPLY(content, new PLYLoader());
    case '3mf':
      return load3MF(content, new ThreeMFLoader());
    case 'step':
    case 'stp':
      return loadSTEP(file, content, file.name, options);
    default:
      throw new Error(`Unsupported file type: ${file.type}`);
  }
}



async function loadSTL(
  content: ArrayBuffer
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  const parsed = await parseStlWithWorker(content);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(parsed.position, 3));

  if (parsed.normal) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(parsed.normal, 3));
  } else {
    geometry.computeVertexNormals();
  }

  if (parsed.index) {
    geometry.setIndex(new THREE.BufferAttribute(parsed.index, 1));
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xc084fc,
    metalness: 0.1,
    roughness: 0.7,
    side: THREE.DoubleSide,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Center the geometry
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox?.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const group = new THREE.Group();
  group.add(mesh);

  const components: ModelComponent[] = [{
    id: 'stl-0',
    name: 'STL Model',
    mesh: mesh,
    visible: true,
    selected: false
  }];

  freezeStaticTransforms(group);
  return { model: group, components };
}

async function loadOBJ(
  content: ArrayBuffer,
  loader: OBJLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const text = new TextDecoder().decode(content);
      const object = loader.parse(text);
      
      const components: ModelComponent[] = [];
      let idx = 0;
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Always set our default purple material
          child.material = new THREE.MeshStandardMaterial({ 
            color: 0xc084fc,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide
          });
          
          components.push({
            id: `obj-${idx}`,
            name: child.name || `Component ${idx}`,
            mesh: child,
            visible: true,
            selected: false
          });
          idx++;
        }
      });
      
      // Center the model
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);

      freezeStaticTransforms(object);
      
      resolve({ model: object, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function loadGLTF(
  content: ArrayBuffer,
  loader: GLTFLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    loader.parse(
      content,
      '',
      (gltf) => {
        const scene = gltf.scene;
        const components: ModelComponent[] = [];
        let idx = 0;
        
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // Always set our default purple material.
            child.material = new THREE.MeshStandardMaterial({
              color: 0xc084fc,
              metalness: 0.1,
              roughness: 0.7,
              side: THREE.DoubleSide
            });
            
            components.push({
              id: `gltf-${idx}`,
              name: child.name || `Component ${idx}`,
              mesh: child,
              visible: true,
              selected: false
            });
            idx++;
          }
        });
        
        // Center the model
        const box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());
        scene.position.sub(center);

        freezeStaticTransforms(scene);
        
        resolve({ model: scene, components });
      },
      reject
    );
  });
}

async function loadPLY(
  content: ArrayBuffer,
  loader: PLYLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const geometry = loader.parse(content);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xc084fc,
        metalness: 0.1,
        roughness: 0.7,
        side: THREE.DoubleSide,
        vertexColors: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      // Center the geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      
      const group = new THREE.Group();
      group.add(mesh);
      
      const components: ModelComponent[] = [{
        id: 'ply-0',
        name: 'PLY Model',
        mesh: mesh,
        visible: true,
        selected: false
      }];
      
      freezeStaticTransforms(group);
      resolve({ model: group, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function load3MF(
  content: ArrayBuffer,
  loader: ThreeMFLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const object = loader.parse(content);
      
      const components: ModelComponent[] = [];
      let idx = 0;
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Always set our default purple material
          child.material = new THREE.MeshStandardMaterial({ 
            color: 0xc084fc,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide
          });
          
          components.push({
            id: `3mf-${idx}`,
            name: child.name || `Component ${idx}`,
            mesh: child,
            visible: true,
            selected: false
          });
          idx++;
        }
      });
      
      // Center the model
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);

      freezeStaticTransforms(object);
      
      resolve({ model: object, components });
    } catch (error) {
      reject(error);
    }
  });
}

function hashMix(hash: number, value: number): number {
  hash ^= value | 0;
  return Math.imul(hash >>> 0, 16777619) >>> 0;
}

function quantize(value: number): number {
  return Math.round(value * STEP_SIGNATURE_SCALE);
}

function computeStepSpatialStats(position: Float32Array): StepSpatialStats {
  const vertexCount = Math.floor(position.length / 3);
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < position.length; i += 3) {
    const x = position[i];
    const y = position[i + 1];
    const z = position[i + 2];

    sumX += x;
    sumY += y;
    sumZ += z;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    center: new THREE.Vector3(sumX / vertexCount, sumY / vertexCount, sumZ / vertexCount),
    extent: new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function buildStepMeshSignature(mesh: StepMeshBuildData): string | null {
  const vertexCount = Math.floor(mesh.position.length / 3);
  if (vertexCount === 0) return null;

  let hash = 2166136261;
  hash = hashMix(hash, vertexCount);
  hash = hashMix(hash, mesh.index ? mesh.index.length : 0);
  hash = hashMix(hash, mesh.normal ? 1 : 0);

  hash = hashMix(hash, quantize(mesh.extent.x));
  hash = hashMix(hash, quantize(mesh.extent.y));
  hash = hashMix(hash, quantize(mesh.extent.z));

  const vertexStride = Math.max(1, Math.floor(vertexCount / STEP_SIGNATURE_VERTEX_SAMPLES));
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += vertexStride) {
    const offset = vertexIndex * 3;
    hash = hashMix(hash, quantize(mesh.position[offset] - mesh.center.x));
    hash = hashMix(hash, quantize(mesh.position[offset + 1] - mesh.center.y));
    hash = hashMix(hash, quantize(mesh.position[offset + 2] - mesh.center.z));

    if (mesh.normal) {
      hash = hashMix(hash, quantize(mesh.normal[offset]));
      hash = hashMix(hash, quantize(mesh.normal[offset + 1]));
      hash = hashMix(hash, quantize(mesh.normal[offset + 2]));
    }
  }

  if (mesh.index && mesh.index.length > 0) {
    const indexStride = Math.max(1, Math.floor(mesh.index.length / STEP_SIGNATURE_INDEX_SAMPLES));
    for (let i = 0; i < mesh.index.length; i += indexStride) {
      hash = hashMix(hash, mesh.index[i]);
    }
  }

  return `${vertexCount}|${mesh.index ? mesh.index.length : 0}|${hash.toString(16)}`;
}

function areStepMeshesInstanceCompatible(
  baseMesh: StepMeshBuildData,
  candidateMesh: StepMeshBuildData
): boolean {
  if (baseMesh.position.length !== candidateMesh.position.length) return false;
  if ((baseMesh.index?.length ?? 0) !== (candidateMesh.index?.length ?? 0)) return false;
  if ((baseMesh.normal?.length ?? 0) !== (candidateMesh.normal?.length ?? 0)) return false;

  if (
    Math.abs(baseMesh.extent.x - candidateMesh.extent.x) > STEP_COMPARE_EPSILON ||
    Math.abs(baseMesh.extent.y - candidateMesh.extent.y) > STEP_COMPARE_EPSILON ||
    Math.abs(baseMesh.extent.z - candidateMesh.extent.z) > STEP_COMPARE_EPSILON
  ) {
    return false;
  }

  const vertexCount = Math.floor(baseMesh.position.length / 3);
  const vertexStride = Math.max(1, Math.floor(vertexCount / STEP_COMPARE_VERTEX_SAMPLES));
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += vertexStride) {
    const offset = vertexIndex * 3;
    const baseX = baseMesh.position[offset] - baseMesh.center.x;
    const baseY = baseMesh.position[offset + 1] - baseMesh.center.y;
    const baseZ = baseMesh.position[offset + 2] - baseMesh.center.z;

    const otherX = candidateMesh.position[offset] - candidateMesh.center.x;
    const otherY = candidateMesh.position[offset + 1] - candidateMesh.center.y;
    const otherZ = candidateMesh.position[offset + 2] - candidateMesh.center.z;

    if (
      Math.abs(baseX - otherX) > STEP_COMPARE_EPSILON ||
      Math.abs(baseY - otherY) > STEP_COMPARE_EPSILON ||
      Math.abs(baseZ - otherZ) > STEP_COMPARE_EPSILON
    ) {
      return false;
    }

    if (baseMesh.normal && candidateMesh.normal) {
      if (
        Math.abs(baseMesh.normal[offset] - candidateMesh.normal[offset]) > 0.005 ||
        Math.abs(baseMesh.normal[offset + 1] - candidateMesh.normal[offset + 1]) > 0.005 ||
        Math.abs(baseMesh.normal[offset + 2] - candidateMesh.normal[offset + 2]) > 0.005
      ) {
        return false;
      }
    }

  }

  if (baseMesh.index && candidateMesh.index) {
    const indexStride = Math.max(1, Math.floor(baseMesh.index.length / STEP_COMPARE_INDEX_SAMPLES));
    for (let i = 0; i < baseMesh.index.length; i += indexStride) {
      if (baseMesh.index[i] !== candidateMesh.index[i]) return false;
    }
  }

  return true;
}

function createStepGeometry(meshData: StepMeshBuildData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.position, 3));

  if (meshData.normal) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normal, 3));
  } else {
    geometry.computeVertexNormals();
  }

  if (meshData.index) {
    geometry.setIndex(new THREE.BufferAttribute(meshData.index, 1));
  }

  return geometry;
}

function createStepMeshBuildData(
  mesh: StepWorkerMesh,
  sourceIndex: number,
  material: THREE.MeshStandardMaterial
): StepMeshBuildData | null {
  if (!mesh.position || mesh.position.length < 9) {
    return null;
  }

  const spatial = computeStepSpatialStats(mesh.position);
  const data: StepMeshBuildData = {
    sourceId: `step-${sourceIndex}`,
    sourceIndex,
    name: mesh.name || `Part ${sourceIndex + 1}`,
    position: mesh.position,
    normal: mesh.normal,
    index: mesh.index,
    center: spatial.center,
    extent: spatial.extent,
    material,
    signature: null,
  };

  data.signature = buildStepMeshSignature(data);
  return data;
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

async function loadSTEP(
  file: ModelFileData,
  content: ArrayBuffer,
  filename: string,
  options: LoadModelOptions
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  try {
    const preview = Boolean(options.stepPreview);
    const enableStepCache = options.enableStepCache !== false;
    const cacheKey = createStepCacheKey(file, preview);

    let result: StepWorkerResult | null = null;
    if (enableStepCache) {
      result = await getStepCacheValue(cacheKey);
    }

    if (!result) {
      result = await parseStepWithWorker(content, filename, null, preview);
      if (enableStepCache && result.success && result.meshes.length > 0) {
        void setStepCacheValue(cacheKey, result);
      }
    }
    
    if (!result.success || !result.meshes || result.meshes.length === 0) {
      throw new Error('Failed to parse STEP file or no geometry found');
    }

    if (result.preview) {
      return buildPreviewStepModel(result);
    }

    const group = new THREE.Group();
    const components: ModelComponent[] = [];
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const preparedMeshes: StepMeshBuildData[] = [];
    const candidateInstanceGroups = new Map<string, StepMeshBuildData[]>();
    const singleMeshes: StepMeshBuildData[] = [];

    for (let idx = 0; idx < result.meshes.length; idx++) {
      const meshData = result.meshes[idx];
      try {
        const materialKey = 'default';
        let material = materialCache.get(materialKey);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            color: 0xc084fc,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide,
            flatShading: false,
          });
          materialCache.set(materialKey, material);
        }

        const prepared = createStepMeshBuildData(meshData, idx, material);
        if (!prepared) continue;
        preparedMeshes.push(prepared);
      } catch (meshError) {
        console.warn(`Failed to prepare STEP mesh ${idx}:`, meshError);
      }

      if ((idx + 1) % 50 === 0) {
        await yieldToMainThread();
      }
    }

    for (const mesh of preparedMeshes) {
      if (!mesh.signature) {
        singleMeshes.push(mesh);
        continue;
      }

      const key = `${mesh.material.uuid}|${mesh.signature}`;
      let groupMeshes = candidateInstanceGroups.get(key);
      if (!groupMeshes) {
        groupMeshes = [];
        candidateInstanceGroups.set(key, groupMeshes);
      }
      groupMeshes.push(mesh);
    }

    let instancedComponentIndex = 0;
    const tempMatrix = new THREE.Matrix4();

    for (const groupMeshes of candidateInstanceGroups.values()) {
      if (groupMeshes.length < STEP_MIN_INSTANCE_COUNT) {
        singleMeshes.push(...groupMeshes);
        continue;
      }

      let pending = groupMeshes;
      while (pending.length > 0) {
        const [base, ...rest] = pending;
        const cluster: StepMeshBuildData[] = [base];
        const remainder: StepMeshBuildData[] = [];

        for (const candidate of rest) {
          if (areStepMeshesInstanceCompatible(base, candidate)) {
            cluster.push(candidate);
          } else {
            remainder.push(candidate);
          }
        }

        pending = remainder;

        if (cluster.length < STEP_MIN_INSTANCE_COUNT) {
          singleMeshes.push(base);
          continue;
        }

        const instancedGeometry = createStepGeometry(base);
        instancedGeometry.translate(-base.center.x, -base.center.y, -base.center.z);
        const instancedMesh = new THREE.InstancedMesh(
          instancedGeometry,
          base.material,
          cluster.length
        );
        instancedMesh.name = `${base.name} (${cluster.length}x)`;
        instancedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        for (let index = 0; index < cluster.length; index++) {
          const instance = cluster[index];
          tempMatrix.makeTranslation(instance.center.x, instance.center.y, instance.center.z);
          instancedMesh.setMatrixAt(index, tempMatrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;

        group.add(instancedMesh);
        components.push({
          id: `step-inst-${instancedComponentIndex++}`,
          name: instancedMesh.name,
          mesh: instancedMesh,
          visible: true,
          selected: false,
        });
      }
    }

    singleMeshes.sort((a, b) => a.sourceIndex - b.sourceIndex);
    for (const meshData of singleMeshes) {
      try {
        const geometry = createStepGeometry(meshData);
        const mesh = new THREE.Mesh(geometry, meshData.material);
        mesh.name = meshData.name;
        group.add(mesh);

        components.push({
          id: meshData.sourceId,
          name: mesh.name,
          mesh,
          visible: true,
          selected: false,
        });
      } catch (meshError) {
        console.warn(`Failed to build STEP mesh ${meshData.sourceId}:`, meshError);
      }

      if (components.length % 50 === 0) {
        await yieldToMainThread();
      }
    }

    if (group.children.length === 0) {
      throw new Error('No valid geometry could be extracted from STEP file');
    }

    // Center the model
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);

    freezeStaticTransforms(group);
    
    return { model: group, components };
    
  } catch (error) {
    console.error('STEP loading error:', error);
    throw new Error(
      `Failed to load STEP file: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'The file may be corrupted or in an unsupported format.'
    );
  }
}

function buildPreviewStepModel(
  result: StepWorkerResult
): { model: THREE.Group; components: ModelComponent[] } {
  let totalVertices = 0;
  let totalIndices = 0;
  let hasNormalsForAll = true;

  for (const mesh of result.meshes) {
    if (!mesh.position || mesh.position.length < 3) continue;
    const vertexCount = Math.floor(mesh.position.length / 3);
    if (vertexCount === 0) continue;

    totalVertices += vertexCount;
    totalIndices += mesh.index ? mesh.index.length : vertexCount;
    if (!mesh.normal) {
      hasNormalsForAll = false;
    }
  }

  if (totalVertices === 0 || totalIndices === 0) {
    throw new Error('No preview geometry available');
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = hasNormalsForAll ? new Float32Array(totalVertices * 3) : null;
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of result.meshes) {
    if (!mesh.position || mesh.position.length < 3) continue;

    const vertexCount = Math.floor(mesh.position.length / 3);
    if (vertexCount === 0) continue;

    positions.set(mesh.position, vertexOffset * 3);
    if (normals && mesh.normal) {
      normals.set(mesh.normal, vertexOffset * 3);
    }

    if (mesh.index) {
      for (let i = 0; i < mesh.index.length; i++) {
        indices[indexOffset++] = mesh.index[i] + vertexOffset;
      }
    } else {
      for (let i = 0; i < vertexCount; i++) {
        indices[indexOffset++] = vertexOffset + i;
      }
    }

    vertexOffset += vertexCount;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexOffset), 1));

  if (normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xc084fc,
    metalness: 0.05,
    roughness: 0.85,
    side: THREE.DoubleSide,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'STEP Preview';

  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox?.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const group = new THREE.Group();
  group.add(mesh);

  const components: ModelComponent[] = [
    {
      id: 'step-preview-0',
      name: 'STEP Preview (Fast)',
      mesh,
      visible: true,
      selected: false,
    },
  ];

  freezeStaticTransforms(group);
  return { model: group, components };
}
