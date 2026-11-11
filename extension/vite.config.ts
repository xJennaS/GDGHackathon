import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    // Modern target: no syntax-lowering helpers, which would break the
    // self-contained functions we inject with chrome.scripting.executeScript.
    target: 'chrome120',
    rollupOptions: { input: 'newtab.html' },
  },
});
