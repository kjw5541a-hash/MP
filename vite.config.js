import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Generate relative paths for GitHub Pages
  server: {
    host: true, // Expose to local network (so iPhone can connect)
    port: 5173,
  },
});
