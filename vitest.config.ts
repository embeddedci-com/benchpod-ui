import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The engine tests import the vendored .wasm as bytes (`?inline`).
  assetsInclude: ['**/*.wasm'],
})
