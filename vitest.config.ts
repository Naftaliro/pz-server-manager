import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: the electron renderer plugin there swaps out Node's
// built-in modules, which breaks tests that touch the file system
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
