import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Enable PWA in dev preview via `npm run preview` (we'll still test offline via preview)
      devOptions: {
        enabled: false,
      },
      // We already have a manifest.webmanifest in public/, so we let it stand.
      // Workbox will precache all these file types from the production build:
      minify: false,
      workbox: {
        cleanupOutdatedCaches: true,
        sourcemap: false,
        mode: 'development',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
