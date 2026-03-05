# 3DCanvas 🧊

A modern, fast 3D model viewer for GitHub repositories. Paste any GitHub URL and instantly preview STL, STEP, OBJ, GLTF, and other 3D model files directly in your browser.

## ✨ Features

- 🚀 **Lightning Fast** - Built with Bun, React, TypeScript, and Three.js
- 📋 **Auto-Paste** - Just Ctrl+V anywhere to load a GitHub repo
- 🔍 **Smart Detection** - Automatically finds all 3D files in repositories
- 🎨 **Component Explorer** - View and toggle individual parts in STEP files
- 🌙 **Beautiful UI** - Clean, dark theme inspired by modern design
- 📦 **Multiple Formats** - STL, STEP/STP, OBJ, GLTF/GLB, PLY, 3MF

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Build for production
bun run build
```

## 💡 Usage

1. Visit the site
2. Paste a GitHub URL (or press Ctrl+V)
3. Select a 3D model from the file list
4. Explore and interact with your model!

## 🛠️ Tech Stack

- **Runtime:** Bun
- **Framework:** React 19 + TypeScript
- **3D Rendering:** Three.js + React Three Fiber
- **State Management:** Zustand
- **Build Tool:** Vite
- **Styling:** Pure CSS with CSS Variables

## 📝 Supported File Types

| Format | Extension | Description |
|--------|-----------|-------------|
| STL | `.stl` | 3D printing files |
| STEP | `.step`, `.stp` | CAD files with components |
| OBJ | `.obj` | 3D object files |
| GLTF | `.gltf`, `.glb` | Modern 3D web formats |
| PLY | `.ply` | Point cloud/mesh files |
| 3MF | `.3mf` | 3D manufacturing format |

## 🌐 Deploy

This project is optimized for deployment on Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/3dcanvas)

## 📄 License

MIT

## 🙏 Acknowledgments

Design inspired by [KiCanvas](https://kicanvas.org)
