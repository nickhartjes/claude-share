import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests opt into jsdom with `// @vitest-environment jsdom`; others run in Node.
    setupFiles: ['./src/renderer/src/test-setup.ts'],
  },
});
