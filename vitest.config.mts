import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose electron plugin would build and start the app
// every time the tests run
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
