/// <reference types="vitest" />
import { defineConfig } from 'vite';

// GitHub Pages project sites live at /<repo>/; local `npm run dev` uses `/`.
// Set VITE_BASE in CI (see .github/workflows/pages.yml).
export default defineConfig({
    base: process.env.VITE_BASE || '/',
    test: {
        environment: 'jsdom',
    },
});
