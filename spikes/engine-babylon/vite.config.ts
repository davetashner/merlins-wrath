import { defineConfig } from 'vite';

// One build per physics backend so each bundle only contains its own engine:
//   vite build                       -> dist-havok/  (index.html, Babylon + Havok)
//   SPIKE_PHYSICS=rapier vite build  -> dist-rapier/ (rapier.html, Babylon + Rapier)
const physics = process.env['SPIKE_PHYSICS'] === 'rapier' ? 'rapier' : 'havok';

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 8192,
    outDir: `dist-${physics}`,
    rolldownOptions: { input: physics === 'rapier' ? 'rapier.html' : 'index.html' },
  },
});
