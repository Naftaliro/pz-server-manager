import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { fileURLToPath } from 'url'

// same list as STEAM_IMAGE_HOSTS in shared/workshopItem.ts (workshopItem.test.ts checks)
const STEAM_IMAGE_HOSTS = ['images.steamusercontent.com', 'steamuserimages-a.akamaihd.net', 'shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com']

// What the app's page may load: its own files, Google's font, mod pictures from Steam's image
// servers and the Steam Workshop in the mod browser's webview. Nothing else, so a picture link
// (or anything worse) slipped into a mod list or a pack can't reach out anywhere.
// A <meta> tag because the packaged app loads the page from a file, which has no headers.
// `npm run dev` also needs Vite's inline React refresh script and its live-reload socket
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: ${STEAM_IMAGE_HOSTS.map(h => `https://${h}`).join(' ')}`,
    `connect-src 'self'${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    'frame-src https://steamcommunity.com https://store.steampowered.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function csp(): Plugin {
  let dev = false
  return {
    name: 'knox-csp',
    configResolved(config) { dev = config.command === 'serve' },
    transformIndexHtml: () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(dev) },
      injectTo: 'head-prepend',
    }],
  }
}

export default defineConfig({
  plugins: [
    csp(),
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            // Electron's built-in unpatched fs (no asar magic), provided at runtime
            rollupOptions: { external: ['original-fs'] },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
          },
        },
        onstart(options) {
          options.reload()
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
  },
})
