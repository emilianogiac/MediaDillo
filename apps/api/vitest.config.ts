import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['source', 'node', 'import', 'default'],
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
