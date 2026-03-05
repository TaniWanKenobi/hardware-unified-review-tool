import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['occt-import-js'],
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: ['**/kicanvas/**', '**/3dcanvas/**'],
    },
  },
})
