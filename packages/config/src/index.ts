import { z } from 'zod'

// Base env schema shared by all services
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NATS_URL: z.string(),
})

// Auth service
export const authEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3001),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
})

// Project service
export const projectEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3002),
})

// AI service
export const aiEnvSchema = z.object({
  PORT: z.coerce.number().default(3003),
  DATABASE_URL: z.string().url(),
  TENSORZERO_API_URL: z.string().url(),
  OPENAI_API_KEY: z.string(),
  OLLAMA_URL: z.string().url().optional(),
  LANGFUSE_URL: z.string().url().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
})

// Payment service
export const paymentEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3004),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
})

// Notification service
export const notificationEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3005),
  RESEND_API_KEY: z.string().optional(),
  CENTRIFUGO_URL: z.string().url().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_SECRET: z.string().optional(),
})

// Admin service
export const adminEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3006),
})

// Frontend
export const webEnvSchema = z.object({
  VITE_API_URL: z.string().url(),
  VITE_APP_URL: z.string().url(),
})

export type BaseEnv = z.infer<typeof baseEnvSchema>
export type AuthEnv = z.infer<typeof authEnvSchema>
export type ProjectEnv = z.infer<typeof projectEnvSchema>
export type AiEnv = z.infer<typeof aiEnvSchema>
export type PaymentEnv = z.infer<typeof paymentEnvSchema>
export type NotificationEnv = z.infer<typeof notificationEnvSchema>
export type AdminEnv = z.infer<typeof adminEnvSchema>
export type WebEnv = z.infer<typeof webEnvSchema>

export function validateEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, unknown> = process.env,
): z.infer<T> {
  const result = schema.safeParse(env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format())
    throw new Error('Invalid environment variables')
  }
  return result.data
}
