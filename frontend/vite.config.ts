import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The browser only ever talks to relative URLs (/api/...). In development the Vite dev server
// forwards /api to the backend on the same machine, so no backend address is exposed to the browser.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

const proxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: false, // keep the Host header so same-origin write checks pass
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // accept the Arena preview host
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 500,
  },
});
