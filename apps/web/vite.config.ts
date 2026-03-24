import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/me': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/phone': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/projects': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/work-packages': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/milestones': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/matching': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/time-logs': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/talents': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/reviews': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/disputes': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/contracts': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/chat': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/applications': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/talent-profiles': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/upload': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/activities': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/v1/ai': {
        target: 'http://localhost:3003',
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
      '/api/v1/admin': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
    },
  },
})
