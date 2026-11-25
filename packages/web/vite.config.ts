import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 45161,
    proxy: {
      '/api': 'http://127.0.0.1:45160',
      '/brand': 'http://127.0.0.1:45160',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
