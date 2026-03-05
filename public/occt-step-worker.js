let occtInstance = null;
let occtLoadPromise = null;

function getOcctInstance() {
  if (occtInstance) {
    return Promise.resolve(occtInstance);
  }

  if (occtLoadPromise) {
    return occtLoadPromise;
  }

  occtLoadPromise = (async () => {
    importScripts('/occt-import-js.js');

    if (typeof self.occtimportjs !== 'function') {
      throw new Error('occt-import-js failed to initialize in worker');
    }

    occtInstance = await self.occtimportjs({
      locateFile(path) {
        if (path.endsWith('.wasm')) return '/occt-import-js.wasm';
        return path;
      },
    });

    return occtInstance;
  })();

  return occtLoadPromise;
}

self.onmessage = async (event) => {
  const { id, buffer, filename } = event.data ?? {};

  if (typeof id !== 'number' || !(buffer instanceof ArrayBuffer)) {
    self.postMessage({
      id,
      success: false,
      error: 'Invalid worker payload',
    });
    return;
  }

  try {
    const occt = await getOcctInstance();
    const result = occt.ReadStepFile(new Uint8Array(buffer), filename || 'model.step');
    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : 'STEP parse failed',
    });
  }
};
