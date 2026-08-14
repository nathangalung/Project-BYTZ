import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { coverageConfig } from '../../vitest.shared'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      /**
       * Off under vitest, on everywhere else.
       *
       * Splitting moves each route component into a `?tsr-split=component`
       * virtual module that v8 only sees if a test loads it, so an untested
       * route reported total:0 covered:0 and scored 100% while contributing
       * nothing to either side of the ratio. 23 of 35 route files were in that
       * state, which is how apps/web read as 92.5% while roughly half its code
       * was outside the denominator.
       *
       * This does NOT remove the `import.meta.hot` block the router plugin
       * appends to every route module. I claimed it did when I made this
       * change and I was wrong: the plugin injects it whether or not splitting
       * is on. Under `vitest run` it is undefined, so it remains a permanently
       * uncovered function and two uncovered branches on eleven route files,
       * which is why check-email.tsx still reports 0% branches with every line
       * of its own source executed. That puts a ceiling near 98.5% branches on
       * this workspace, so a 100% threshold would fail on day one. Removing it
       * would be a router-plugin option or a coverage exclusion, not a test.
       *
       * Production still splits; only the measurement changes.
       */
      autoCodeSplitting: !process.env.VITEST,
      // Tests beside routes are not routes.
      routeFileIgnorePattern: '\\.(test|spec)\\.tsx?$',
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
  test: {
    setupFiles: ['./vitest.setup.ts'],
    coverage: coverageConfig({
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      thresholds: { statements: 96, branches: 91, functions: 95, lines: 97 },
    }),
  },
})
