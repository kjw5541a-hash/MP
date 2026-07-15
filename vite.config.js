import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // Expose to local network (so iPhone can connect)
    port: 5173,
  },
});
