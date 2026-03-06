declare global {
  interface Window {
    occtimportjs: (config?: any) => Promise<any>;
  }
}

let occtInstance: any = null;
let loadPromise: Promise<void> | null = null;

function loadOcctScript(): Promise<void> {
  if (typeof window.occtimportjs === 'function') return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/occt-import-js.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load occt-import-js'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export async function getOcctInstance() {
  if (occtInstance) return occtInstance;

  await loadOcctScript();

  occtInstance = await window.occtimportjs({
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) return '/occt-import-js.wasm';
      return path;
    }
  });

  return occtInstance;
}
