import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2023', assetsInlineLimit: 0, chunkSizeWarningLimit: 4096 },
});
