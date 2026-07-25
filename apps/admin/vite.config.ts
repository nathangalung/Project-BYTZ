import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.(test|spec)\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api/v1/auth': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/v1/me': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/v1/admin': { target: 'http://localhost:3006', changeOrigin: true },
      // Dispute mediation is served by project-service, not admin-service.
      '/api/v1/disputes': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/projects': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/payments': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/api/v1/notifications': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },
})
