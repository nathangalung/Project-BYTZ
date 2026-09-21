import { authEnvSchema, isProduction as isProductionEnv, validateEnv } from '@kerjacus/config'
import * as schema from '@kerjacus/db'
import { getDb } from '@kerjacus/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { resolveDatabaseUrl } from './database-url'

const env = validateEnv(authEnvSchema)
const db = getDb(resolveDatabaseUrl(env.DATABASE_URL))

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
 * Delivery is necessary but not sufficient: enforcement is a separate opt-in
 * (REQUIRE_EMAIL_VERIFICATION). Set both, and backfill existing accounts first,
 * or the accounts that predate delivery lose access the moment it starts.
 */
const canDeliverEmail = Boolean(env.RESEND_API_KEY)

// Two conditions, both required, and kept separate on purpose. Delivery being
// possible is not the same as wanting to enforce verification: enforcement
// locks out every account that predates it and every sign-up until it clicks a
// link, so it is an explicit opt-in (REQUIRE_EMAIL_VERIFICATION=true), not an
// accident of configuring RESEND_API_KEY.
const enforceEmailVerification = isProduction && canDeliverEmail && env.REQUIRE_EMAIL_VERIFICATION

if (isProduction && env.REQUIRE_EMAIL_VERIFICATION && !canDeliverEmail) {
  console.warn(
    '[auth] REQUIRE_EMAIL_VERIFICATION is set but RESEND_API_KEY is unset, so ' +
      'verification stays off. Sign-in does not check email_verified until delivery works.',
  )
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
    /**
     * Makes a sign-up all-or-nothing.
     *
     * Better Auth already wraps sign-up in runWithTransaction, but the drizzle
     * adapter declares `transaction: config.transaction ?? false`, so without
     * this that wrapper was a no-op and the INSERT into `user` committed on
     * its own. Anything that failed afterwards - linking the credential row,
     * creating the session, signing the cookie - then answered with an error
     * over an account that already existed. The caller read "registration
     * failed", tried again, and was told the email was taken: the row was
     * real, the reply was not.
     */
    transaction: true,
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
    requireEmailVerification: enforceEmailVerification,
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
      /**
       * Never writable from a request body. Better Auth refuses an update that
       * names it and replaces whatever a create sends with the default below,
       * so no path it serves - including the ones no handler of ours guards -
       * can hand an account the admin panel. The role a registration actually
       * asked for is written by the create hook further down.
       */
      role: { type: 'string', required: true, defaultValue: 'owner', input: false },
      avatarUrl: { type: 'string', required: false, input: false },
      isVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
      phoneVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
      locale: { type: 'string', required: false, defaultValue: 'id', input: true },
      deletedAt: { type: 'string', required: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Puts the registration's role back, after the field declaration above
         * has thrown the submitted one away.
         *
         * `input: false` is what closes the escalation, and on a create it does
         * so by silently substituting the default rather than refusing: without
         * this hook every talent registration would land as an owner, with
         * nothing in the response to say so.
         *
         * `context.path` is the endpoint's declared route, not the request URL,
         * so a trailing slash or any other spelling cannot make another
         * endpoint look like sign-up. Only owner and talent are accepted, which
         * is the same rule routes/auth.ts applies before forwarding the body:
         * an unauthenticated caller cannot name admin here either. OAuth
         * carries no role and keeps the default until complete-onboarding.
         */
        before: async (user, context) => {
          if (context?.path !== '/sign-up/email') return
          const role = (context.body as { role?: unknown } | undefined)?.role
          if (role !== 'owner' && role !== 'talent') return
          return { data: { ...user, role } }
        },
      },
    },
  },
})

export type Auth = typeof auth
