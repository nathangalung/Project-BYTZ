import { hc } from 'hono/client'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

// Type-safe API client via hono/client
// Will be typed against Hono route types once services are built
export const apiClient = hc(API_URL)
