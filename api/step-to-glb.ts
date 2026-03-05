import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => void;
};

interface StepParseMesh {
  name?: string;
  color?: unknown;
  attributes?: {
    position?: { array: Float32Array | number[] };
    normal?: { array: Float32Array | number[] };
  };
  index?: { array: Uint32Array | number[] };
}

interface StepParseResult {
  success: boolean;
  meshes?: StepParseMesh[];
}

class NodeFileReader {
  result: ArrayBuffer | null = null;
  error: unknown = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((arrayBuffer) => {
        this.result = arrayBuffer;
        this.onloadend?.({ target: this });
      })
      .catch((error) => {
        this.error = error;
        this.onerror?.(error);
      });
  }
}

if (typeof globalThis.FileReader === 'undefined') {
  (globalThis as any).FileReader = NodeFileReader;
}

const require = createRequire(import.meta.url);
const occtFactory = require('occt-import-js/dist/occt-import-js.js');
const wasmPath = require.resolve('occt-import-js/dist/occt-import-js.wasm');
const wasmBinary = fs.readFileSync(wasmPath);
let occtPromise: Promise<any> | null = null;

const memoryCache = new Map<string, { etag: string; glb: Buffer; at: number }>();
const inFlightConversions = new Map<string, Promise<{ glbBuffer: Buffer; etag: string }>>();
const MEMORY_CACHE_MAX_ENTRIES = 24;
const MEMORY_CACHE_TTL_MS = 1000 * 60 * 30;
const PREVIEW_TARGET_TRIANGLES = 450000;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405);
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

  const sourceUrl = normalizeSourceUrl(getQueryParam(req.query, 'url'));
  const preview = getQueryParam(req.query, 'preview') === '1';

  if (!sourceUrl) {
    sendJsonError(res, 400, 'Missing query parameter: url');
    return;
  }

  if (!isAllowedSource(sourceUrl)) {
    sendJsonError(res, 400, 'Only GitHub raw and blob URLs are supported');
    return;
  }

  const cacheKey = createCacheKey(sourceUrl, preview);
  const ifNoneMatch = getIfNoneMatch(req.headers);
  pruneMemoryCache();

  const memoryEntry = memoryCache.get(cacheKey);
  if (memoryEntry) {
    if (ifNoneMatch && ifNoneMatch === memoryEntry.etag) {
      writeCacheHeaders(res, memoryEntry.etag);
      res.status(304).end();
      return;
    }

    writeModelResponse(res, memoryEntry.glb, memoryEntry.etag);
    return;
  }

  try {
    const { glbBuffer, etag } = await getOrCreateConversion(cacheKey, sourceUrl, preview);

    if (ifNoneMatch && ifNoneMatch === etag) {
      writeCacheHeaders(res, etag);
      res.status(304).end();
      return;
    }

    writeModelResponse(res, glbBuffer, etag);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STEP conversion failed';
    sendJsonError(res, 500, message);
  }
}

function getQueryParam(
  query: Record<string, string | string[]> | undefined,
  key: string
): string {
  const value = query?.[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function getIfNoneMatch(
  headers: Record<string, string | string[] | undefined> | undefined
): string | null {
  const value = headers?.['if-none-match'];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeSourceUrl(value: string): string {
  if (!value) return '';

  try {
    const url = new URL(value);
    if (url.hostname === 'raw.githubusercontent.com') {
      return url.toString();
    }

    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 5 && parts[2] === 'blob') {
        const owner = parts[0];
        const repo = parts[1];
        const branch = parts[3];
        const path = parts.slice(4).join('/');
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      }
    }
  } catch {
    return '';
  }

  return '';
}

function isAllowedSource(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'raw.githubusercontent.com';
  } catch {
    return false;
  }
}

function createCacheKey(sourceUrl: string, preview: boolean): string {
  return sha1Hex(`${sourceUrl}|preview:${preview ? '1' : '0'}|v1`);
}

function pruneMemoryCache(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (now - entry.at > MEMORY_CACHE_TTL_MS) {
      memoryCache.delete(key);
    }
  }

  if (memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES) return;

  const sorted = [...memoryCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < sorted.length - MEMORY_CACHE_MAX_ENTRIES; i++) {
    memoryCache.delete(sorted[i][0]);
  }
}

function writeCacheHeaders(res: ApiResponse, etag: string): void {
  res.setHeader('ETag', etag);
  const cacheValue = 'public, max-age=0, s-maxage=31536000, stale-while-revalidate=86400';
  res.setHeader('Cache-Control', cacheValue);
  res.setHeader('CDN-Cache-Control', cacheValue);
  res.setHeader('Vercel-CDN-Cache-Control', cacheValue);
  res.setHeader('Vary', 'Accept');
}

function writeModelResponse(res: ApiResponse, body: Buffer, etag: string): void {
  writeCacheHeaders(res, etag);
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Length', String(body.byteLength));
  res.status(200).end(body);
}

function sendJsonError(res: ApiResponse, status: number, message: string): void {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify({ error: message }));
}

function sha1Hex(value: string | Buffer): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

async function getOrCreateConversion(
  cacheKey: string,
  sourceUrl: string,
  preview: boolean
): Promise<{ glbBuffer: Buffer; etag: string }> {
  const active = inFlightConversions.get(cacheKey);
  if (active) return active;

  const promise = (async () => {
    const stepBytes = await fetchStepBytes(sourceUrl);
    const glbBuffer = await convertStepToGlb(stepBytes, preview);
    const etag = `"${sha1Hex(glbBuffer)}"`;
    memoryCache.set(cacheKey, { etag, glb: glbBuffer, at: Date.now() });
    return { glbBuffer, etag };
  })();

  inFlightConversions.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    if (inFlightConversions.get(cacheKey) === promise) {
      inFlightConversions.delete(cacheKey);
    }
  }
}

async function getOcct(): Promise<any> {
  if (!occtPromise) {
    occtPromise = occtFactory({ wasmBinary });
  }
  return occtPromise;
}

async function fetchStepBytes(rawUrl: string): Promise<Buffer> {
  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch STEP source: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
  if (contentLength > 0 && contentLength < 1024) {
    const text = await response.text();
    if (text.startsWith('version https://git-lfs.github.com')) {
      return fetchLfsPayload(rawUrl, text);
    }
    return Buffer.from(text, 'utf-8');
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function fetchLfsPayload(rawUrl: string, pointerText: string): Promise<Buffer> {
  const oidMatch = pointerText.match(/^oid sha256:([0-9a-f]+)$/m);
  const sizeMatch = pointerText.match(/^size (\d+)$/m);
  if (!oidMatch || !sizeMatch) {
    throw new Error('Failed to parse Git LFS pointer');
  }

  const source = new URL(rawUrl);
  const parts = source.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) {
    throw new Error('Cannot resolve owner/repo for Git LFS object');
  }

  const size = Number(sizeMatch[1]);
  const oid = oidMatch[1];
  const batchResponse = await fetch(
    `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.git-lfs+json',
        Accept: 'application/vnd.git-lfs+json',
      },
      body: JSON.stringify({
        operation: 'download',
        transfers: ['basic'],
        objects: [{ oid, size }],
      }),
    }
  );

  if (!batchResponse.ok) {
    throw new Error(
      `LFS batch request failed: ${batchResponse.status} ${batchResponse.statusText}`
    );
  }

  const batchData = await batchResponse.json();
  const downloadUrl: string | undefined = batchData?.objects?.[0]?.actions?.download?.href;
  if (!downloadUrl) {
    throw new Error('LFS batch API did not return a download URL');
  }

  const fileResponse = await fetch(downloadUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download LFS object: ${fileResponse.status}`);
  }

  return Buffer.from(await fileResponse.arrayBuffer());
}

function toFloat32Array(source: Float32Array | number[] | undefined): Float32Array | null {
  if (!source) return null;
  if (source instanceof Float32Array) return source;
  return new Float32Array(source);
}

function toUint32Array(source: Uint32Array | number[] | undefined): Uint32Array | null {
  if (!source) return null;
  if (source instanceof Uint32Array) return source;
  return new Uint32Array(source);
}

function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.round(Math.max(0, value) * 255);
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexFromRgbChannels(r: number, g: number, b: number): number {
  const rr = clampColorChannel(r);
  const gg = clampColorChannel(g);
  const bb = clampColorChannel(b);
  return (rr << 16) | (gg << 8) | bb;
}

function resolveStepColor(value: unknown, fallback: number = 0xc084fc): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) {
      return toHexFromRgbChannels(value, value, value);
    }
    if (value >= 0 && value <= 0xffffff) {
      return Math.round(value) & 0xffffff;
    }
  }

  if (Array.isArray(value) && value.length >= 3) {
    const [r, g, b] = value;
    if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
      return toHexFromRgbChannels(r, g, b);
    }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const r = record.r ?? record.red ?? record.R;
    const g = record.g ?? record.green ?? record.G;
    const b = record.b ?? record.blue ?? record.B;

    if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
      return toHexFromRgbChannels(r, g, b);
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      if (trimmed.startsWith('#')) {
        const parsed = Number.parseInt(trimmed.slice(1), 16);
        if (Number.isFinite(parsed)) {
          return parsed & 0xffffff;
        }
      }

      if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
        const parsed = Number.parseInt(trimmed.slice(2), 16);
        if (Number.isFinite(parsed)) {
          return parsed & 0xffffff;
        }
      }

      const numeric = Number.parseFloat(trimmed);
      if (Number.isFinite(numeric)) {
        if (numeric >= 0 && numeric <= 1) {
          return toHexFromRgbChannels(numeric, numeric, numeric);
        }
        if (numeric >= 0 && numeric <= 0xffffff) {
          return Math.round(numeric) & 0xffffff;
        }
      }

      const rgbParts = trimmed
        .split(/[,\s]+/)
        .map((part) => Number.parseFloat(part))
        .filter((part) => Number.isFinite(part));
      if (rgbParts.length >= 3) {
        return toHexFromRgbChannels(rgbParts[0], rgbParts[1], rgbParts[2]);
      }
    }
  }

  return fallback;
}

function decimateIndexed(indexArray: Uint32Array, step: number): Uint32Array {
  if (step <= 1) return indexArray;

  const triangleCount = Math.floor(indexArray.length / 3);
  const keptTriangles = Math.ceil(triangleCount / step);
  const output = new Uint32Array(keptTriangles * 3);
  let out = 0;

  for (let tri = 0; tri < triangleCount; tri += step) {
    const base = tri * 3;
    output[out++] = indexArray[base];
    output[out++] = indexArray[base + 1];
    output[out++] = indexArray[base + 2];
  }

  return output.subarray(0, out);
}

function decimateNonIndexed(
  position: Float32Array,
  normal: Float32Array | null,
  step: number
): { position: Float32Array; normal: Float32Array | null } {
  if (step <= 1) return { position, normal };

  const triangleCount = Math.floor(position.length / 9);
  const keptTriangles = Math.ceil(triangleCount / step);
  const outPos = new Float32Array(keptTriangles * 9);
  const outNormal = normal ? new Float32Array(keptTriangles * 9) : null;
  let out = 0;

  for (let tri = 0; tri < triangleCount; tri += step) {
    const base = tri * 9;
    outPos.set(position.subarray(base, base + 9), out * 9);
    if (outNormal && normal) {
      outNormal.set(normal.subarray(base, base + 9), out * 9);
    }
    out++;
  }

  return {
    position: outPos.subarray(0, out * 9),
    normal: outNormal ? outNormal.subarray(0, out * 9) : null,
  };
}

async function convertStepToGlb(stepBytes: Buffer, preview: boolean): Promise<Buffer> {
  const occt = await getOcct();
  let parseResult: StepParseResult;

  try {
    parseResult = occt.ReadStepFile(new Uint8Array(stepBytes));
  } catch {
    parseResult = occt.ReadStepFile(new Uint8Array(stepBytes), 'model.step');
  }

  if (!parseResult?.success || !Array.isArray(parseResult.meshes) || parseResult.meshes.length === 0) {
    throw new Error('No mesh data returned from STEP parser');
  }

  const rawMeshes = parseResult.meshes.map((mesh, index) => ({
    name: mesh.name || `Part ${index + 1}`,
    color: mesh.color,
    position: toFloat32Array(mesh.attributes?.position?.array),
    normal: toFloat32Array(mesh.attributes?.normal?.array),
    index: toUint32Array(mesh.index?.array),
  }));

  const totalTriangles = rawMeshes.reduce((sum, mesh) => {
    if (mesh.index) return sum + Math.floor(mesh.index.length / 3);
    if (mesh.position) return sum + Math.floor(mesh.position.length / 9);
    return sum;
  }, 0);

  const previewStride =
    preview && totalTriangles > PREVIEW_TARGET_TRIANGLES
      ? Math.max(2, Math.ceil(totalTriangles / PREVIEW_TARGET_TRIANGLES))
      : 1;

  const scene = new THREE.Scene();
  const materialCache = new Map<number, THREE.MeshStandardMaterial>();

  for (const mesh of rawMeshes) {
    let position = mesh.position;
    let normal = mesh.normal;
    let index = mesh.index;
    if (!position || position.length < 3) continue;

    if (previewStride > 1) {
      if (index) {
        index = decimateIndexed(index, previewStride);
      } else {
        const decimated = decimateNonIndexed(position, normal, previewStride);
        position = decimated.position;
        normal = decimated.normal;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    if (normal) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    } else {
      geometry.computeVertexNormals();
    }
    if (index) {
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
    }

    const color = resolveStepColor(mesh.color, 0xc084fc);
    let material = materialCache.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color,
        metalness: preview ? 0.05 : 0.1,
        roughness: preview ? 0.9 : 0.7,
        side: THREE.DoubleSide,
      });
      materialCache.set(color, material);
    }

    const object = new THREE.Mesh(geometry, material);
    object.name = mesh.name;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    scene.add(object);
  }

  if (scene.children.length === 0) {
    throw new Error('No valid geometry generated from STEP file');
  }

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  scene.updateMatrixWorld(true);

  const glbArrayBuffer = await exportSceneToGlb(scene);
  disposeScene(scene);
  return Buffer.from(glbArrayBuffer);
}

async function exportSceneToGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('GLTF exporter returned JSON instead of GLB'));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true }
    );
  });
}

function disposeScene(scene: THREE.Scene): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();

  scene.traverse((child) => {
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
      } else if (child.material && !disposedMaterials.has(child.material)) {
        child.material.dispose();
        disposedMaterials.add(child.material);
      }
    }
  });
}
