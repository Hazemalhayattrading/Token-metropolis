import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/ — keep in sync with the repository name.
const base = process.env.VITE_BASE ?? '/Token-metropolis/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
