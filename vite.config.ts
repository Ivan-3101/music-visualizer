import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Three.js alone is ~550 kB minified (~140 kB gzipped). It's needed on first
    // load, so code-splitting wouldn't help. Warn only if we grow well past that.
    chunkSizeWarningLimit: 700,
  },
});
