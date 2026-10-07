import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_URL = process.env.VITE_API_URL || 'http://127.0.0.1:3300';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Absolute asset URLs: with './' a reload on a nested route (/dashboard/servers/x)
  // requested /dashboard/servers/assets/*.js, which the SPA fallback answered with
  // index.html -> module load failure -> "app files couldn't be loaded".
  // Set VITE_BASE=./ only when hosting inside a subfolder.
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
        secure: false,
      },
      // socket.io namespaces (/ws, /ws/exec) live outside /api
      '/socket.io': {
        target: API_URL,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
