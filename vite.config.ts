/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/particle-simulator/',
    server: { port: 5173 },
    build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
    test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
