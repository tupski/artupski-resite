import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri expects a fixed dev port and fails if it is not available.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tauri works best when the Rust source is not watched by Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Produce a build that Tauri can bundle.
  build: {
    target: 'es2022',
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
    minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'esbuild',
  },
});
