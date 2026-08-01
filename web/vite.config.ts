import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración de Vite: plugin React y proxy de /api al backend Go en desarrollo
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 320,
  },
});
