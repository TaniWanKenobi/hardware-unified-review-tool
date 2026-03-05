/// <reference lib="webworker" />

import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

interface StlWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
}

interface StlWorkerResult {
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | null;
}

type StlWorkerResponse =
  | { id: number; success: true; result: StlWorkerResult }
  | { id: number; success: false; error: string };

let stlLoader: STLLoader | null = null;

function getStlLoader(): STLLoader {
  if (!stlLoader) {
    stlLoader = new STLLoader();
  }
  return stlLoader;
}

function toFloat32Array(source: ArrayLike<number>): Float32Array {
  if (source instanceof Float32Array) {
    return source;
  }
  return new Float32Array(source);
}

function toUint32Array(source: ArrayLike<number>): Uint32Array {
  if (source instanceof Uint32Array) {
    return source;
  }
  return new Uint32Array(source);
}

self.onmessage = (event: MessageEvent<StlWorkerRequest>) => {
  const { id, buffer } = event.data ?? {};

  if (typeof id !== 'number' || !(buffer instanceof ArrayBuffer)) {
    const invalidPayloadResponse: StlWorkerResponse = {
      id,
      success: false,
      error: 'Invalid STL worker payload',
    };
    self.postMessage(invalidPayloadResponse);
    return;
  }

  try {
    const geometry = getStlLoader().parse(buffer);
    const positionAttribute = geometry.getAttribute('position');

    if (!positionAttribute) {
      throw new Error('STL parser returned geometry without position attribute');
    }

    const normalAttribute = geometry.getAttribute('normal');
    const indexAttribute = geometry.getIndex();

    const position = toFloat32Array(positionAttribute.array as ArrayLike<number>);
    const normal = normalAttribute
      ? toFloat32Array(normalAttribute.array as ArrayLike<number>)
      : null;
    const index = indexAttribute
      ? toUint32Array(indexAttribute.array as ArrayLike<number>)
      : null;

    geometry.dispose();

    const response: StlWorkerResponse = {
      id,
      success: true,
      result: { position, normal, index },
    };

    const transferables: Transferable[] = [position.buffer as ArrayBuffer];
    if (normal) transferables.push(normal.buffer as ArrayBuffer);
    if (index) transferables.push(index.buffer as ArrayBuffer);

    self.postMessage(response, transferables);
  } catch (error) {
    const response: StlWorkerResponse = {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse STL file',
    };
    self.postMessage(response);
  }
};

export {};
