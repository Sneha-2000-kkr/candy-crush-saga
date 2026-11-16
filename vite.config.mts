import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
} as Parameters<typeof defineConfig>[0]);
