import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        id: '/',
        name: 'Sistema de Control de Cosecha',
        short_name: 'Cosecha Quijas',

        description:
          'Sistema de Control de Cosecha',

        start_url: '/',
        scope: '/',

        display: 'standalone',

        theme_color: '#1668c7',
        background_color: '#f3f5f7',

        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
