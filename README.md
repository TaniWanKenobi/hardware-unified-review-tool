# HURT

Hardware Unified Review Tool (HURT) is a browser app for reviewing hardware projects directly from GitHub.

Paste a GitHub URL, and HURT will:
- discover supported 3D CAD and KiCad files in the repo
- preview models/schematics in-browser
- provide component-level controls for large assemblies

## What It Does

- Loads GitHub repos from `repo`, `tree`, or `blob` URLs
- Finds supported files recursively using the GitHub Trees API
- Renders 3D models with Three.js (`STL`, `STEP/STP`, `OBJ`, `GLTF/GLB`, `PLY`, `3MF`)
- Renders KiCad files via embedded KiCanvas (`.kicad_sch`, `.kicad_pcb`, `.kicad_prj`, `.kicad_wks`)
- Supports component visibility/selection and material editing for 3D models
- Uses streaming downloads, progress bars, and ETA estimates for large files
- Includes optimized STEP loading paths for large CAD files

## STEP Performance Pipeline

HURT uses multiple strategies to handle large STEP files:

1. Server conversion path (preferred): `/api/step-to-glb` converts STEP -> GLB and returns cached binary results
2. Client fallback path: STEP parsing in `public/occt-step-worker.js` (Web Worker, not main thread)
3. Adaptive preview mode: large STEP files can be decimated for faster initial load
4. Instancing: repeated compatible STEP meshes are grouped with `THREE.InstancedMesh`
5. Local cache: parsed STEP results are cached in IndexedDB (`src/utils/stepCache.ts`)
6. ETA learning: download/processing rates are smoothed and persisted in localStorage (`src/utils/loadMetrics.ts`)

## Supported File Types

### 3D

| Type | Extensions |
| --- | --- |
| STL | `.stl` |
| STEP | `.step`, `.stp` |
| OBJ | `.obj` |
| GLTF | `.gltf`, `.glb` |
| PLY | `.ply` |
| 3MF | `.3mf` |

### KiCad

| Type | Extensions |
| --- | --- |
| Schematic | `.kicad_sch` |
| PCB | `.kicad_pcb` |
| Project | `.kicad_prj` |
| Worksheet | `.kicad_wks` |

## Quick Start

### Prerequisites

- Node.js 20+ recommended
- npm (or Bun)

### Install

```bash
npm install
```

### Run Dev Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Usage

1. Open the app
2. Paste a GitHub URL into the input (or press `Ctrl+V` anywhere on the page)
3. Select a file from the sidebar
4. Inspect:
   - 3D model with orbit controls, component tree, and material editor
   - KiCad content through embedded KiCanvas

Example URL formats:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/branch/path`
- `https://github.com/owner/repo/blob/branch/path/to/file.step`

## Deployment Notes

- The `api/step-to-glb.ts` endpoint is used for server-side STEP conversion.
- Best results come from deploying to a platform that runs the `api/` function (for example, Vercel).
- If the API route is unavailable (common in plain Vite local dev), HURT automatically falls back to client-side STEP parsing.

## Project Structure

```text
api/
  step-to-glb.ts          # Server-side STEP -> GLB conversion + cache headers
public/
  occt-step-worker.js     # STEP parser worker (occt-import-js)
  occt-import-js.js       # OCCT runtime
  occt-import-js.wasm
  vendor/kicanvas/
src/
  components/
    ModelViewer.tsx       # Main 3D viewer + loading/ETA pipeline
    KiCadViewer.tsx       # KiCanvas embed wrapper
    UrlInput.tsx          # GitHub URL ingestion + auto-paste
    ComponentTree.tsx     # Component list + visibility/selection
    MaterialEditor.tsx    # Material controls
  utils/
    github.ts             # GitHub file discovery + streaming download + LFS support
    modelLoader.ts        # Model loaders + STEP worker/client/server orchestration
    stepCache.ts          # IndexedDB cache for STEP parse results
    loadMetrics.ts        # Adaptive ETA estimation
  store/
    useStore.ts           # Global app state (Zustand)
```

## Current Limitations

- GitHub API requests are unauthenticated; large usage may hit rate limits.
- Drag-and-drop local files is not implemented yet (GitHub URL workflow is supported).
- STEP source colors are currently not preserved; models use a normalized default material.

## Tech Stack

- React 19 + TypeScript
- Vite
- Three.js + React Three Fiber + Drei
- Zustand
- occt-import-js
- KiCanvas (embedded web component)

