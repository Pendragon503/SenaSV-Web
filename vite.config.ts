import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const certificatePath = resolve('certs/server.crt');
const privateKeyPath = resolve('certs/server.key');
const https = existsSync(certificatePath) && existsSync(privateKeyPath)
  ? { cert: readFileSync(certificatePath), key: readFileSync(privateKeyPath) }
  : undefined;

export default defineConfig({
  base: '/SenaSV-Web/',
  server: { host: '0.0.0.0', https },
  preview: { host: '0.0.0.0', https },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'SeñaSV Web',
        short_name: 'SeñaSV',
        description: 'Prototipo PWA para reconocimiento local de señas aisladas de LESSA.',
        theme_color: '#174f7a',
        background_color: '#f5f8fb',
        display: 'standalone',
        orientation: 'any',
        lang: 'es-SV',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision/,
            handler: 'CacheFirst',
            options: { cacheName: 'mediapipe-wasm', expiration: { maxEntries: 10, maxAgeSeconds: 31536000 } }
          },
          {
            urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//,
            handler: 'CacheFirst',
            options: { cacheName: 'mediapipe-models', expiration: { maxEntries: 4, maxAgeSeconds: 31536000 } }
          }
        ]
      }
    })
  ]
});
