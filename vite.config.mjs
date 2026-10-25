import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  publicDir: false,
  base: '/frontend/',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'public/frontend',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: fileURLToPath(new URL('./frontend/main.tsx', import.meta.url)) }
  }
});
