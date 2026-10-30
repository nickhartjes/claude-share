import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript sources: bundle them. Native modules stay external.
const bundleWorkspace = { exclude: ['@specdeck/daemon', '@specdeck/protocol'] };

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // The daemon runs as its own process (Electron in Node mode); see HostController.
          daemon: resolve(import.meta.dirname, '../daemon/src/main.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
