let kicanvasLoadPromise: Promise<void> | null = null;

export function ensureKiCanvasLoaded(): Promise<void> {
  if (customElements.get("kicanvas-embed")) return Promise.resolve();

  if (!kicanvasLoadPromise) {
    kicanvasLoadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "/vendor/kicanvas/kicanvas.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load KiCanvas"));
      document.head.appendChild(script);
    });
  }
  return kicanvasLoadPromise;
}
