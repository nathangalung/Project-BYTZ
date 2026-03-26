import { authEnvSchema, validateEnv } from '@kerjacus/config'
import * as schema from '@kerjacus/db'
import { getDb } from '@kerjacus/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

const env = validateEnv(authEnvSchema)
const db = getDb(process.env.DATABASE_DIRECT_URL ?? env.DATABASE_URL)

const isProduction = process.env.NODE_ENV === 'production'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),

  // Same-origin in production: https://kerjacus.id
  // API calls go through web nginx proxy: kerjacus.id/api/v1/* -> api-gateway
  // No cross-subdomain cookies needed
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/v1/auth',
  secret: env.BETTER_AUTH_SECRET,

  trustedOrigins: isProduction
    ? ['https://kerjacus.id', 'https://www.kerjacus.id', 'https://admin.kerjacus.id']
    : [env.CORS_ORIGIN],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: false,
  },

  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  advanced: {
    cookiePrefix: 'kerjacus',
    generateId: false,
    useSecureCookies: isProduction,
  },

  user: {
    additionalFields: {
      phone: { type: 'string', required: true, input: true },
      role: { type: 'string', required: true, defaultValue: 'owner', input: true },
      avatarUrl: { type: 'string', required: false, input: false },
      isVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
      phoneVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
      locale: { type: 'string', required: false, defaultValue: 'id', input: true },
      deletedAt: { type: 'string', required: false, input: false },
    },
  },
})

export type Auth = typeof auth
