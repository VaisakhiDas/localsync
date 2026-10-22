/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The browser talks to ONE origin; the dev/preview server forwards API and WebSocket
// traffic to the backend. Same origin means cookies just work and no CORS is needed.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:4000';
const proxy = {
  '/api': { target: backend, changeOrigin: false },
  '/collab': { target: backend, ws: true, changeOrigin: false },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The service worker is what lets the app SHELL (html/js/css) load with no network at all.
    // Without it, reloading while offline shows a browser error page, whatever the CRDT does.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LocalSync',
        short_name: 'LocalSync',
        description: 'Local-first collaborative document editor',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // Single-page app: any navigation is answered with the cached shell...
        navigateFallback: '/index.html',
        // ...except API and WebSocket paths, which must always reach the network (or fail honestly).
        navigateFallbackDenylist: [/^\/api\//, /^\/collab\//],
        cleanupOutdatedCaches: true,
        // The editor bundle is large; allow it to be precached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
