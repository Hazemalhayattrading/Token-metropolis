import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/ — keep in sync with the repository name.
const base = process.env.VITE_BASE ?? '/Token-metropolis/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    // The only large chunk is the o200k tokenizer (~2 MB), loaded lazily when the prompt panel
    // opens; everything eager stays well below this.
    chunkSizeWarningLimit: 2100,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
