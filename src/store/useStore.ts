import { create } from 'zustand';
import * as THREE from 'three';

export type HardwareFileKind = 'model' | 'kicad';

export interface ModelFileData {
  kind: 'model';
  name: string;
  path: string;
  url: string;
  type: 'stl' | 'step' | 'stp' | 'obj' | 'gltf' | 'glb' | 'ply' | '3mf';
  size?: number;
}

export interface KiCadFileData {
  kind: 'kicad';
  name: string;
  path: string;
  url: string;
  type: 'kicad_sch' | 'kicad_pcb' | 'kicad_prj' | 'kicad_wks';
  size?: number;
}

export type HardwareFile = ModelFileData | KiCadFileData;

export interface ModelComponent {
  id: string;
  name: string;
  mesh: THREE.Mesh | THREE.Group;
  visible: boolean;
  selected: boolean;
}

interface AppState {
  // GitHub state
  githubUrl: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  repoPath: string;
  
  // Files state
  files: HardwareFile[];
  selectedFile: HardwareFile | null;
  resolverMap: Map<string, string>;
  isLoading: boolean;
  error: string | null;
  
  // Model viewer state
  modelComponents: ModelComponent[];
  selectedComponents: string[];
  showEdges: boolean;
  loadProgress: number;
  
  // Actions
  setGithubUrl: (url: string) => void;
  setFiles: (files: HardwareFile[]) => void;
  setSelectedFile: (file: HardwareFile | null) => void;
  setResolverMap: (resolverMap: Map<string, string>) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setModelComponents: (components: ModelComponent[]) => void;
  toggleComponentVisibility: (id: string) => void;
  toggleComponentSelection: (id: string) => void;
  selectAllComponents: () => void;
  deselectAllComponents: () => void;
  setLoadProgress: (progress: number) => void;
  toggleEdges: () => void;
  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  // Initial state
  githubUrl: '',
  repoOwner: '',
  repoName: '',
  repoBranch: 'main',
  repoPath: '',
  files: [],
  selectedFile: null,
  resolverMap: new Map(),
  isLoading: false,
  error: null,
  modelComponents: [],
  selectedComponents: [],
  showEdges: true,
  loadProgress: 0,
  
  // Actions
  setGithubUrl: (url: string) => {
    const parsed = parseGithubUrl(url);
    set({ 
      githubUrl: url,
      ...parsed,
      error: null 
    });
  },
  
  setFiles: (files: HardwareFile[]) => set({ files }),
  
  setResolverMap: (resolverMap: Map<string, string>) => set({ resolverMap }),
  
  setSelectedFile: (file: HardwareFile | null) => set({ 
    selectedFile: file,
    modelComponents: [],
    selectedComponents: []
  }),
  
  setIsLoading: (loading: boolean) => set({ isLoading: loading }),
  
  setError: (error: string | null) => set({ error, isLoading: false }),
  
  setModelComponents: (components: ModelComponent[]) => set({ modelComponents: components }),
  
  toggleComponentVisibility: (id: string) => set((state) => ({
    modelComponents: state.modelComponents.map(comp =>
      comp.id === id ? { ...comp, visible: !comp.visible } : comp
    )
  })),
  
  toggleComponentSelection: (id: string) => set((state) => {
    const isSelected = state.modelComponents.find(c => c.id === id)?.selected;
    return {
      selectedComponents: isSelected ? [] : [id],
      modelComponents: state.modelComponents.map(comp =>
        ({ ...comp, selected: comp.id === id ? !comp.selected : false })
      )
    };
  }),
  
  selectAllComponents: () => set((state) => ({
    selectedComponents: state.modelComponents.map(c => c.id),
    modelComponents: state.modelComponents.map(c => ({ ...c, selected: true }))
  })),
  
  deselectAllComponents: () => set({
    selectedComponents: [],
    modelComponents: []
  }),
  
  setLoadProgress: (progress: number) => set({ loadProgress: progress }),
  
  toggleEdges: () => set((state) => ({ showEdges: !state.showEdges })),
  
  reset: () => set({
    githubUrl: '',
    repoOwner: '',
    repoName: '',
    repoBranch: 'main',
    repoPath: '',
    files: [],
    selectedFile: null,
    resolverMap: new Map(),
    isLoading: false,
    error: null,
    modelComponents: [],
    selectedComponents: [],
    showEdges: true,
    loadProgress: 0
  })
}));

function parseGithubUrl(url: string): {
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  repoPath: string;
} {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    if (pathParts.length < 2) {
      return { repoOwner: '', repoName: '', repoBranch: 'main', repoPath: '' };
    }
    
    const repoOwner = pathParts[0];
    const repoName = pathParts[1];
    
    // Handle different GitHub URL formats
    // https://github.com/owner/repo
    // https://github.com/owner/repo/tree/branch/path/to/folder
    // https://github.com/owner/repo/blob/branch/path/to/file
    
    let repoBranch = 'main';
    let repoPath = '';
    
    if (pathParts.length > 3 && (pathParts[2] === 'tree' || pathParts[2] === 'blob')) {
      repoBranch = pathParts[3];
      repoPath = pathParts.slice(4).join('/');
    }
    
    return { repoOwner, repoName, repoBranch, repoPath };
  } catch {
    return { repoOwner: '', repoName: '', repoBranch: 'main', repoPath: '' };
  }
}
