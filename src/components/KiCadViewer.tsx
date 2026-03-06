import { useEffect, useRef, useState } from 'react';
import { ensureKiCanvasLoaded } from '../integrations/kicanvasLoader';
import { fetchFileContent } from '../utils/github';

interface KiCadViewerProps {
  fileUrl: string;
  fileName: string;
  resolverMap: Map<string, string>;
}

export default function KiCadViewer({ fileUrl, fileName, resolverMap }: KiCadViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const embedRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ensureKiCanvasLoaded()
      .then(() => setReady(true))
      .catch((err) => setError(`Failed to load KiCad viewer: ${err.message}`));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current) return;

    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      setError(null);

      try {
        // Pre-fetch the file content ourselves to avoid CORS / LFS issues
        const buffer = await fetchFileContent(fileUrl);
        const text = new TextDecoder().decode(buffer);

        if (cancelled) return;

        // Remove previous embed
        if (embedRef.current) {
          embedRef.current.remove();
          embedRef.current = null;
        }

        // Build a kicanvas-embed with inline source instead of URL src
        const embed = document.createElement('kicanvas-embed');
        embed.setAttribute('controls', 'full');
        embed.setAttribute('controlslist', 'nooverlay');
        embed.style.width = '100%';
        embed.style.height = '100%';

        // Set custom_resolver so KiCanvas can fetch related files
        (embed as any).custom_resolver = (name: string) => {
          const url = resolverMap.get(name) ?? resolverMap.get(name.split('/').pop()!);
          return url ? new URL(url) : new URL(fileUrl);
        };

        // Use inline <kicanvas-source> element to pass the pre-fetched content
        const source = document.createElement('kicanvas-source');
        source.setAttribute('name', fileName);
        source.textContent = text;
        embed.appendChild(source);

        containerRef.current!.appendChild(embed);
        embedRef.current = embed;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
          setLoading(false);
        }
      }
    }

    loadFile();

    return () => {
      cancelled = true;
      if (embedRef.current) {
        embedRef.current.remove();
        embedRef.current = null;
      }
    };
  }, [ready, fileUrl, fileName, resolverMap]);

  if (error) {
    return (
      <div className="kicad-viewer-error">
        <div className="error-icon">⚠️</div>
        <p>{error}</p>
      </div>
    );
  }

  if (!ready || loading) {
    return (
      <div className="kicad-viewer-loading">
        <div className="spinner"></div>
        <p>Loading KiCad viewer…</p>
      </div>
    );
  }

  return <div ref={containerRef} className="kicad-viewer" />;
}
