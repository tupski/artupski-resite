import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Phase 16: the composed end-to-end suite lives in `e2e/` (impl-plan C7).
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.{test,spec}.{ts,tsx}'],
  },
});
