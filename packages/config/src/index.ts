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
  // Deliberate opt-in. Configuring email delivery must not, by itself, start
  // rejecting every existing (unverified) account at sign-in and every new
  // sign-up until it clicks a link. Turn this on only once the verify flow is
  // validated end-to-end and the existing accounts have been backfilled.
  REQUIRE_EMAIL_VERIFICATION: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
})

/**
 * Values that are only ever right for one environment, and the value to use
 * outside production.
 *
 * Each of these used to carry a `.default()`, which reads as convenience and
 * behaves as a silent misconfiguration: a production deployment that forgets
 * S3_ACCESS_KEY signs uploads as `minioadmin`, one that forgets AI_SERVICE_URL
 * calls its own host on port 3003, and neither fails at boot. The failure
 * surfaces later, on a user's request, as a timeout or a 403 with no clue as to
 * why. Required in production, defaulted below it, so `bun run dev` and the
 * test suites still run against the compose stack with no .env at all.
 */
const DEVELOPMENT_FALLBACKS = {
  AI_SERVICE_URL: 'http://localhost:3003',
  PAYMENT_SERVICE_URL: 'http://localhost:3004',
  AUTH_SERVICE_URL: 'http://localhost:3001',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  TEMPORAL_URL: 'localhost:7233',
  CENTRIFUGO_SECRET: 'development-centrifugo-secret',
} as const

/** A short HMAC key is a forgeable Centrifugo subscription token. */
const CENTRIFUGO_SECRET_MIN_LENGTH = 16

// Project service
export const projectEnvSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().default(3002),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_SERVICE_URL: z.url().optional(),
    BETTER_AUTH_URL: z.url().optional(),
    AI_SERVICE_URL: z.url().optional(),
    PAYMENT_SERVICE_URL: z.url().optional(),
    SERVICE_AUTH_SECRET: z.string().min(1, 'SERVICE_AUTH_SECRET required for inter-service auth'),
    S3_ENDPOINT: z.string().optional(),
    S3_PUBLIC_URL: z.string().optional(),
    S3_BUCKET: z.string().default('kerjacus-uploads'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    TEMPORAL_URL: z.string().optional(),
    TEMPORAL_NAMESPACE: z.string().default('kerjacus'),
    TEMPORAL_TASK_QUEUE: z.string().default('project-service'),
    // Signs Centrifugo subscription tokens for chat, project and milestone.
    CENTRIFUGO_SECRET: z.string().optional(),
  })
  .transform((env, ctx) => {
    const production = env.NODE_ENV === 'production'

    const resolve = (key: keyof typeof DEVELOPMENT_FALLBACKS, value?: string, minLength = 1) => {
      if (value !== undefined && value.length >= minLength) return value
      if (!production) return DEVELOPMENT_FALLBACKS[key]
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          minLength > 1
            ? `${key} must be set in production and be at least ${minLength} characters`
            : `${key} must be set in production; there is no safe default`,
      })
      return ''
    }

    return {
      ...env,
      AI_SERVICE_URL: resolve('AI_SERVICE_URL', env.AI_SERVICE_URL),
      PAYMENT_SERVICE_URL: resolve('PAYMENT_SERVICE_URL', env.PAYMENT_SERVICE_URL),
      // BETTER_AUTH_URL is the older name for the same host. A deployment that
      // sets only that one still has to reach auth-service.
      AUTH_SERVICE_URL: resolve('AUTH_SERVICE_URL', env.AUTH_SERVICE_URL ?? env.BETTER_AUTH_URL),
      S3_ENDPOINT: resolve('S3_ENDPOINT', env.S3_ENDPOINT),
      S3_ACCESS_KEY: resolve('S3_ACCESS_KEY', env.S3_ACCESS_KEY),
      S3_SECRET_KEY: resolve('S3_SECRET_KEY', env.S3_SECRET_KEY),
      TEMPORAL_URL: resolve('TEMPORAL_URL', env.TEMPORAL_URL),
      CENTRIFUGO_SECRET: resolve(
        'CENTRIFUGO_SECRET',
        env.CENTRIFUGO_SECRET,
        CENTRIFUGO_SECRET_MIN_LENGTH,
      ),
    }
  })

// Only the TypeScript services consume these schemas. The Go services
// (payment, notification, admin) and Python ai-service parse env natively,
// and the web app reads import.meta.env, so their schemas were dead exports.

export type BaseEnv = z.infer<typeof baseEnvSchema>
export type AuthEnv = z.infer<typeof authEnvSchema>
export type ProjectEnv = z.infer<typeof projectEnvSchema>

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

/**
 * Whether this process is running in production, read at runtime.
 *
 * The dotted form, process.env.NODE_ENV, is substituted by bun build at bundle
 * time. The Dockerfiles build in a stage that never sets NODE_ENV and only set
 * it in the runner, so `const isProduction = process.env.NODE_ENV ===
 * 'production'` was compiled to the literal false and stayed false no matter
 * what the container environment said.
 *
 * That silently disabled three things in auth-service at once: the Secure
 * attribute on the session cookie, email verification on sign-in, and the
 * production trustedOrigins list, which left admin.kerjacus.id and
 * www.kerjacus.id rejected with 403 so the admin panel could not log in.
 *
 * Bracket access is not substituted, verified against bun 1.3.9: the dotted
 * form compiles to `var dotted = false`, this form survives as a real lookup.
 * Anything that must follow the deployed environment rather than the build
 * environment has to read it this way.
 */
export function isProduction(): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: bracket access is load bearing. bun build substitutes the dotted form at bundle time, which is how this shipped as a constant false in production.
  return process.env['NODE_ENV'] === 'production'
}
