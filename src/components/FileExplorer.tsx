import { useStore } from '../store/useStore';
import { Box, Settings, Gem, Sparkles, Cpu, FolderOpen, FileText, File } from 'lucide-react';

export default function FileExplorer() {
  const { files, selectedFile, setSelectedFile } = useStore();

  if (files.length === 0) {
    return null;
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    const iconMap: Record<string, any> = {
      stl: Box,
      step: Settings,
      stp: Settings,
      obj: Gem,
      gltf: Sparkles,
      glb: Sparkles,
      ply: Gem,
      '3mf': Box,
      kicad_sch: Cpu,
      kicad_pcb: Cpu,
      kicad_prj: FolderOpen,
      kicad_wks: FileText,
      easyeda_json: FileText,
      easyeda_epro: FolderOpen,
      easyeda_zip: FolderOpen
    };
    const IconComponent = iconMap[type] || File;
    return <IconComponent size={18} />;
  };

  const getFileKindLabel = (kind: string) => {
    if (kind === 'model') return '3D Model';
    if (kind === 'kicad') return 'KiCad';
    if (kind === 'easyeda') return 'EasyEDA';
    return kind;
  };

  const getFileTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      easyeda_json: 'JSON',
      easyeda_epro: 'EPRO',
      easyeda_zip: 'ZIP'
    };
    return (labels[type] ?? type).toUpperCase();
  };

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <h3>Files</h3>
        <span className="file-count">{files.length}</span>
      </div>
      <div className="file-list">
        {files.map((file) => (
          <div
            key={file.path}
            className={`file-item ${selectedFile?.path === file.path ? 'selected' : ''}`}
            onClick={() => setSelectedFile(file)}
          >
            <span className="file-icon">{getFileIcon(file.type)}</span>
            <div className="file-info">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">
                <span className="file-kind">{getFileKindLabel(file.kind)}</span>
                <span className="file-type">{getFileTypeLabel(file.type)}</span>
                <span className="file-size">{formatFileSize(file.size)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
