import { useEffect, useRef, useState } from 'react';
import { ensureKiCanvasLoaded } from '../integrations/kicanvasLoader';

interface KiCadViewerProps {
  fileUrl: string;
  resolverMap: Map<string, string>;
}

export default function KiCadViewer({ fileUrl, resolverMap }: KiCadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const embedRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureKiCanvasLoaded()
      .then(() => setReady(true))
      .catch((err) => setError(`Failed to load KiCad viewer: ${err.message}`));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current) return;

    // Remove previous embed if any
    if (embedRef.current) {
      embedRef.current.remove();
      embedRef.current = null;
    }

    // Create a fresh kicanvas-embed element
    const embed = document.createElement('kicanvas-embed');
    embed.setAttribute('src', fileUrl);
    embed.setAttribute('controls', 'full');
    embed.setAttribute('controlslist', 'nooverlay');
    embed.style.width = '100%';
    embed.style.height = '100%';

    // Set custom_resolver for related file lookups
    (embed as any).custom_resolver = (name: string) => {
      const url = resolverMap.get(name) ?? resolverMap.get(name.split('/').pop()!);
      return url ? new URL(url) : new URL(fileUrl);
    };

    containerRef.current.appendChild(embed);
    embedRef.current = embed;

    return () => {
      if (embedRef.current) {
        embedRef.current.remove();
        embedRef.current = null;
      }
    };
  }, [ready, fileUrl, resolverMap]);

  if (error) {
    return (
      <div className="kicad-viewer-error">
        <div className="error-icon">⚠️</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="kicad-viewer-loading">
        <div className="spinner"></div>
        <p>Loading KiCad viewer...</p>
      </div>
    );
  }

  return <div ref={containerRef} className="kicad-viewer" />;
}
