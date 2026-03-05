import { useState, useEffect } from 'react';
import UrlInput from './components/UrlInput';
import FileExplorer from './components/FileExplorer';
import ComponentTree from './components/ComponentTree';
import ModelViewer from './components/ModelViewer';
import KiCadViewer from './components/KiCadViewer';
import LoadingOverlay from './components/LoadingOverlay';
import LandingPage from './components/LandingPage';
import { useStore } from './store/useStore';
import './App.css';

function App() {
  const { files, selectedFile, setSelectedFile, resolverMap } = useStore();
  const [showViewer, setShowViewer] = useState(false);

  useEffect(() => {
    if (files.length > 0 && !selectedFile) {
      setSelectedFile(files[0]);
    }
  }, [files, selectedFile, setSelectedFile]);

  if (!showViewer && files.length === 0) {
    return (
      <>
        <LandingPage onLoaded={() => setShowViewer(true)} />
        <LoadingOverlay />
      </>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="logo">HURT</span>
        <UrlInput />
      </header>

      <div className="app-content">
        {files.length > 0 && (
          <aside className="sidebar">
            <FileExplorer />
            {selectedFile?.kind === 'model' && <ComponentTree />}
          </aside>
        )}

        <main className="main-content">
          {selectedFile ? (
            selectedFile.kind === 'kicad' ? (
              <KiCadViewer fileUrl={selectedFile.url} resolverMap={resolverMap} />
            ) : (
              <ModelViewer />
            )
          ) : (
            <div className="empty-state">
              <p>Select a file from the sidebar</p>
            </div>
          )}
        </main>
      </div>

      <LoadingOverlay />
    </div>
  );
}

export default App;
