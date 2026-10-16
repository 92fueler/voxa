import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  server: {
    port: 4317,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } },
  },
});
