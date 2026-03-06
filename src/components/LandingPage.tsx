import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { isGithubUrl, fetchRepositoryFiles } from '../utils/github';

export default function LandingPage({ onLoaded }: { onLoaded: () => void }) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setGithubUrl, setFiles, setResolverMap, setIsLoading: setGlobalLoading, setError: setGlobalError } = useStore();

  const loadRepo = async (url: string) => {
    if (!isGithubUrl(url)) {
      setError('Please enter a valid GitHub URL');
      return;
    }

    setIsLoading(true);
    setError(null);
    setGithubUrl(url);
    setGlobalLoading(true);
    setGlobalError(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const store = useStore.getState();
      const { files, resolverMap } = await fetchRepositoryFiles(
        store.repoOwner,
        store.repoName,
        store.repoBranch,
        store.repoPath
      );

      if (files.length === 0) {
        setError('No hardware files found in this repository');
        setIsLoading(false);
      } else {
        setFiles(files);
        setResolverMap(resolverMap);
        setGlobalLoading(false);
        onLoaded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
      setIsLoading(false);
      setGlobalLoading(false);
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (text && isGithubUrl(text)) {
        setInputValue(text);
        loadRepo(text);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  return (
    <div className="landing">
      <div className="landing-inner">
        <h1>HURT</h1>
        <p>
          An <strong>interactive</strong>, <strong>browser-based</strong> viewer
          for 3D models, KiCad files, and EasyEDA files from GitHub.
        </p>
        <input
          type="text"
          placeholder="Paste a GitHub link..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && inputValue && loadRepo(inputValue)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text && isGithubUrl(text)) {
              e.preventDefault();
              e.stopPropagation();
              setInputValue(text);
              loadRepo(text);
            }
          }}
          disabled={isLoading}
          autoFocus
        />
        {isLoading && <p className="landing-status">Loading…</p>}
        {error && <p className="landing-error">{error}</p>}
        <p className="landing-note">
          or drag &amp; drop files directly onto the page.
          <br />
          Supports STL, STEP, OBJ, GLTF, PLY, 3MF, KiCad files, and EasyEDA
          (.json/.epro/.zip).
        </p>
      </div>
    </div>
  );
}
