import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          validation: ['zod'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['mfaroedu-logo.png', 'mfaroedu-icon.svg', 'favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'MfaroEdu',
        short_name: 'MfaroEdu',
        description: 'Empowering Schools. Inspiring Futures.',
        theme_color: '#0047d6',
        background_color: '#f4f7fc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/mfaroedu-app-v2-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/mfaroedu-app-v2-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/mfaroedu-app-v2-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/auth/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
});
