import { authEnvSchema, isProduction as isProductionEnv, validateEnv } from '@kerjacus/config'
import * as schema from '@kerjacus/db'
import { getDb } from '@kerjacus/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

const env = validateEnv(authEnvSchema)
const db = getDb(process.env.DATABASE_DIRECT_URL ?? env.DATABASE_URL)

/**
 * Read at runtime, not baked at build. bun build substitutes the dotted
 * process.env.NODE_ENV, and the Dockerfile builds before NODE_ENV is set, so
 * the literal false was compiled in and disabled secure cookies, email
 * verification, and the production trustedOrigins list.
 */
const isProduction = isProductionEnv()

/**
 * Whether a verification email can actually be delivered.
 *
 * sendEmail degrades to a console.log when RESEND_API_KEY is missing, and it
 * is missing in production, so requiring verification would gate every account
 * behind a message nobody receives. Verification that cannot be completed is
 * not a security control, it is a lockout: it would have shut out all existing
 * users, whose email_verified is false, and every new sign-up along with them.
 *
 * Set RESEND_API_KEY to turn verification on. Do the backfill first, or the
 * accounts that predate delivery lose access the moment it starts working.
 */
const canDeliverEmail = Boolean(env.RESEND_API_KEY)

if (isProduction && !canDeliverEmail) {
  console.warn(
    '[auth] RESEND_API_KEY is unset, so email verification stays off. ' +
      'Sign-in does not check email_verified until delivery works.',
  )
}

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
    requireEmailVerification: isProduction && canDeliverEmail,
    sendResetPassword: async ({ user, url }) => {
      const { sendEmail } = await import('./email')
      await sendEmail({
        to: user.email,
        subject: 'Reset password KerjaCUS',
        html: `<p>Hi ${user.name},</p><p>Klik untuk reset password: <a href="${url}">${url}</a></p>`,
      })
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendEmail, buildVerificationEmail } = await import('./email')
      await sendEmail({ to: user.email, ...buildVerificationEmail(user.name, url) })
    },
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

  /**
   * Better Auth ships its own limiter, on by default in production, at three
   * sign-in attempts per ten seconds. It kept returning 429 for correct
   * credentials because it keys on its own IP resolution, which behind three
   * proxy hops reads an internal address, and it counts in a per-process Map
   * while more than one replica serves auth.
   *
   * Turned off in favour of the middleware in middleware/rate-limit.ts, which
   * counts the same paths in Valkey so the window is shared across replicas,
   * resolves the caller from CF-Connecting-IP, and refuses to key on a private
   * address. Two limiters with different keys means the weaker one decides,
   * and the weaker one here was producing false positives on every login.
   */
  rateLimit: {
    enabled: false,
  },

  advanced: {
    cookiePrefix: 'kerjacus',
    generateId: false,
    useSecureCookies: isProduction,
    /**
     * Where to read the caller from. The default is X-Forwarded-For, whose
     * leftmost entry is client-supplied, and session.ipAddress was landing
     * empty as a result, so the audit trail recorded nothing.
     */
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip', 'x-real-ip'],
    },
  },

  user: {
    additionalFields: {
      // Google supplies no phone; email sign-up validates it itself.
      phone: { type: 'string', required: false, input: true },
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
