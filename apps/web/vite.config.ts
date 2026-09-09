import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { coverageConfig } from '../../vitest.shared'

/**
 * Router plugin, with HMR kept out of the coverage denominator.
 *
 * Two separate things move here, and they were confused with each other
 * before. Splitting moves each route component into a `?tsr-split=component`
 * virtual module that v8 only sees if a test loads it, so an untested route
 * reported total:0 covered:0 and scored 100% while contributing nothing to
 * either side of the ratio. 23 of 35 route files were in that state, which is
 * how apps/web read as 92.5% while roughly half its code was outside the
 * denominator. Turning splitting off fixes that and is what VITEST does below.
 *
 * The `import.meta.hot` block is the other thing, and turning splitting off
 * does not remove it: router-composed-plugin adds the HMR plugin whenever
 * NODE_ENV is not production and splitting is off. Under `vitest run` that
 * block is a function and two branches that can never execute, on every route
 * file, which put a ceiling near 98.5% branches. There is no plugin option for
 * it on the non-splitting path, only that NODE_ENV check, and it is read once
 * when the factory runs. So the factory runs with NODE_ENV set to production
 * and the previous value goes straight back.
 *
 * Production still splits and still gets HMR; only the measurement changes.
 */
function routerPlugin() {
  const options = {
    autoCodeSplitting: !process.env.VITEST,
    // Tests beside routes are not routes.
    routeFileIgnorePattern: '\\.(test|spec)\\.tsx?$',
  }
  if (!process.env.VITEST) return TanStackRouterVite(options)
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    return TanStackRouterVite(options)
  } finally {
    process.env.NODE_ENV = previous
  }
}

export default defineConfig({
  plugins: [routerPlugin(), react(), tailwindcss()],
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
      // Measured 97.63 / 93.48 / 97.49 / 98.83 after HMR left the denominator.
      // Branch is gated tight because it is the only stable dimension under
      // turbo's parallel load; the other three keep a full point of headroom.
      thresholds: { statements: 96, branches: 93, functions: 96, lines: 97 },
    }),
  },
})
