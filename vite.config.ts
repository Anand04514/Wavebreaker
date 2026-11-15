import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built game also works from a subfolder (GitHub Pages, itch.io zip).
  base: './',
  server: {
    port: 5173,
  },
  build: {
    // Phaser is one big dependency; the default 500 kB warning is noise here.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
