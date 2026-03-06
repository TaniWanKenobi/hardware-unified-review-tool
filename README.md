<a id="readme-top"></a>

<p align="center">
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19">
  </a>
  <a href="https://threejs.org/">
    <img src="https://img.shields.io/badge/Three.js-3D%20Viewer-111111?style=for-the-badge&logo=three.js&logoColor=white" alt="Three.js">
  </a>
  <a href="https://kicanvas.org/">
    <img src="https://img.shields.io/badge/KiCanvas-Embedded-2D9CDB?style=for-the-badge" alt="KiCanvas">
  </a>
  <a href="https://vite.dev/">
    <img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7">
  </a>
</p>

<div align="center">
  <h3>HURT</h3>
  <p>
    <strong>Hardware Unified Review Tool</strong><br />
    A browser-based reviewer for 3D CAD and KiCad files directly from GitHub repositories.
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#how-it-works">How It Works</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#supported-file-types">Supported File Types</a></li>
    <li><a href="#large-file--step-performance">Large File / STEP Performance</a></li>
    <li><a href="#quick-start">Quick Start</a></li>
    <li><a href="#deployment">Deployment</a></li>
    <li><a href="#project-structure">Project Structure</a></li>
    <li><a href="#limitations">Limitations</a></li>
    <li><a href="#credits">Credits</a></li>
  </ol>
</details>

## About The Project

HURT loads a GitHub repository URL, discovers supported hardware files, and renders them in-browser.

It combines:
- a high-performance 3D model viewer path for CAD formats
- an embedded KiCad viewer for schematics and PCBs
- file-level and component-level navigation for hardware review workflows

### Built With

- React 19 + TypeScript
- Three.js + React Three Fiber + Drei
- Zustand (state management)
- Vite
- `occt-import-js` (STEP parsing/conversion)
- KiCanvas (embedded web component)

## How It Works

1. URL ingestion
- User pastes a GitHub URL (input field or global paste handler).
- URL parser resolves `owner/repo/branch/path` from `repo`, `tree`, or `blob` formats.

2. Repository discovery
- App calls GitHub Trees API recursively.
- Supported files are collected into a single sidebar list.
- A resolver map is built so related KiCad files can resolve references.

3. File loading
- 3D model selected:
  - For STEP/STP, app first tries server-side conversion (`/api/step-to-glb`).
  - If unavailable/failing, app falls back to client-side STEP worker parsing.
  - Other 3D formats load directly through dedicated loaders.
- KiCad file selected:
  - App loads `/vendor/kicanvas/kicanvas.js`.
  - Creates a `kicanvas-embed` element and injects a custom resolver.

4. Runtime UX
- Streaming fetch reports progress in real-time.
- ETA is estimated using learned local download/processing metrics.
- Component tree enables per-part visibility and selection.
- Material editor updates selected mesh material properties.

## Features

- GitHub-native workflow
  - Paste a repo URL and review files immediately.
  - Supports repo root or nested branch/path URLs.

- Multi-format 3D viewer
  - STL, STEP/STP, OBJ, GLTF/GLB, PLY, 3MF.
  - Orbit controls, camera framing, scene lighting, optional edge overlays.

- KiCad integration
  - In-app schematic/PCB viewing with KiCanvas.
  - Cross-file resolution for linked KiCad project files.

- Large-file resilience
  - STEP server conversion path plus worker fallback.
  - Adaptive preview decimation for very large STEP geometry.
  - Client-side STEP IndexedDB cache.
  - LFS pointer detection and retrieval on both client and server paths.

- Performance controls
  - User toggle for performance mode.
  - Auto-performance mode for large models.
  - Reduced render cost settings when performance mode is active.

- Component-level tooling
  - Virtualized component list for large assemblies.
  - Show/hide and select components.
  - Per-selection material editing (color, roughness, metalness, opacity, wireframe, flat shading).

## Supported File Types

### 3D Files

| Type | Extensions |
| --- | --- |
| STL | `.stl` |
| STEP | `.step`, `.stp` |
| OBJ | `.obj` |
| GLTF | `.gltf`, `.glb` |
| PLY | `.ply` |
| 3MF | `.3mf` |

### KiCad Files

| Type | Extensions |
| --- | --- |
| Schematic | `.kicad_sch` |
| PCB | `.kicad_pcb` |
| Project | `.kicad_prj` |
| Worksheet | `.kicad_wks` |

## Large File / STEP Performance

HURT uses multiple layers to improve large STEP loading:

1. Preferred server conversion
- `api/step-to-glb.ts` converts STEP to GLB on the server.
- Response includes cache headers for CDN friendliness.
- In-memory dedupe avoids duplicate concurrent conversion work.

2. Worker fallback
- `public/occt-step-worker.js` parses STEP off the main UI thread.
- Worker returns transferable typed arrays for lower copy overhead.

3. Preview decimation
- Large STEP meshes can be decimated to reduce triangle count for fast initial view.

4. Instancing
- Repeated compatible STEP meshes are collapsed into `THREE.InstancedMesh`.

5. Client caching and ETA
- Parsed STEP results cached in IndexedDB.
- Download and processing rates are learned and reused for ETA prediction.

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Run

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

## Deployment

- Deploy with an environment that runs both static app and `api/` function routes.
- Server STEP conversion is active when `/api/step-to-glb` is available.
- If API route is not available (common in plain local Vite), the app auto-falls back to client-side STEP parsing.

## Project Structure

```text
api/
  step-to-glb.ts          # Server STEP -> GLB conversion, cache headers, LFS handling
public/
  occt-step-worker.js     # STEP parser worker
  occt-import-js.js
  occt-import-js.wasm
  vendor/kicanvas/
src/
  components/
    App + Viewer UI
  utils/
    github.ts             # GitHub file discovery + streaming fetch + LFS support
    modelLoader.ts        # Loader orchestration for all model types
    stepCache.ts          # IndexedDB STEP cache
    loadMetrics.ts        # ETA estimation metrics
  integrations/
    kicanvasLoader.ts     # KiCanvas script loader
  store/
    useStore.ts           # Zustand app state
```

## Limitations

- GitHub API calls are unauthenticated by default and can hit rate limits.
- Local drag-and-drop file import is not implemented yet.
- STEP source colors are currently not preserved (models use normalized default material styling).

## Credits

- [KiCanvas](https://kicanvas.org/) by [Thea Flowers](https://thea.codes) and contributors
  - Used for embedded KiCad schematic/PCB rendering.
  - KiCanvas repository: https://github.com/theacodes/kicanvas

- [3DCanvas](./3dcanvas)
  - This project's sibling 3D viewer codebase that informed HURT's 3D loading and interaction structure.

## Contact

Tanishq Goyal - @Tanuki - [tanishqgoyal590@gmail.com](mailto:tanishqgoyal590@gmail.com)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

