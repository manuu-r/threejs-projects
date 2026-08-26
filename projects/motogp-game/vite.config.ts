import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // jolt wasm-compat inlines ~3.2 MB of base64 WASM into its chunk
    chunkSizeWarningLimit: 4200,
  },
});
