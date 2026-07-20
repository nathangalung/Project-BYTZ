import { z } from 'zod'

// Base env schema shared by all services
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  NATS_URL: z.string(),
})

// Auth service
export const authEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3001),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
})

// Project service
export const projectEnvSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().default(3002),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_SERVICE_URL: z.url().optional(),
    BETTER_AUTH_URL: z.url().optional(),
    AI_SERVICE_URL: z.url().default('http://localhost:3003'),
    SERVICE_AUTH_SECRET: z.string().min(1, 'SERVICE_AUTH_SECRET required for inter-service auth'),
    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_PUBLIC_URL: z.string().optional(),
    S3_BUCKET: z.string().default('kerjacus-uploads'),
    S3_ACCESS_KEY: z.string().default('minioadmin'),
    S3_SECRET_KEY: z.string().default('minioadmin'),
    TEMPORAL_URL: z.string().default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().default('kerjacus'),
    TEMPORAL_TASK_QUEUE: z.string().default('project-service'),
  })
  .transform((env) => ({
    ...env,
    AUTH_SERVICE_URL: env.AUTH_SERVICE_URL ?? env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  }))

// AI service
export const aiEnvSchema = z.object({
  PORT: z.coerce.number().default(3003),
  DATABASE_URL: z.url(),
  TENSORZERO_API_URL: z.url(),
  OPENAI_API_KEY: z.string(),
  OLLAMA_URL: z.url().optional(),
  LANGFUSE_URL: z.url().optional(),
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
  CENTRIFUGO_URL: z.url().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_SECRET: z.string().optional(),
})

// Admin service
export const adminEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().default(3006),
})

// Frontend
export const webEnvSchema = z.object({
  VITE_API_URL: z.url(),
  VITE_APP_URL: z.url(),
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
    console.error('Invalid environment variables:', z.treeifyError(result.error))
    throw new Error('Invalid environment variables')
  }
  return result.data
}
