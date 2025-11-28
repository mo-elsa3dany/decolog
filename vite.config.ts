import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      devOptions: {
        enabled: mode === 'development',
      },
      // We already have a manifest.webmanifest in public/, so we let it stand.
      // Workbox will precache all these file types from the production build:
      minify: false,
      workbox: {
        cleanupOutdatedCaches: true,
        sourcemap: false,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
}));
