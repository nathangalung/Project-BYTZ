import './otel'
import { authEnvSchema, validateEnv } from '@kerjacus/config'
import { honoLogger } from '@kerjacus/logger'
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { uuidv7 } from 'uuidv7'
import { errorHandler } from './middleware/error-handler'
import { generalRateLimit, strictRateLimit } from './middleware/rate-limit'
import { authRoute } from './routes/auth'
import { healthRoute } from './routes/health'
import { meRoute } from './routes/me'
import { phoneVerificationRoute } from './routes/phone-verification'

// Validate env at startup - fail fast
const env = validateEnv(authEnvSchema)

const app = new Hono()

// Correlation ID middleware
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? uuidv7()
  c.header('X-Request-ID', requestId)
  await next()
})

// CORS
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
)

// Structured logging
app.use('*', honoLogger('auth-service'))

// Rate limiting: strict for auth endpoints, general for the rest
app.use('/api/v1/auth/*', strictRateLimit)
app.use('/api/v1/*', generalRateLimit)

// Error handler
app.onError(errorHandler)

// OpenAPI documentation
app.get(
  '/api/v1/auth/docs',
  Scalar({
    url: '/api/v1/auth/openapi.json',
    pageTitle: 'Auth Service API',
  }),
)
app.get('/api/v1/auth/openapi.json', (c) =>
  c.json({
    openapi: '3.1.0',
    info: {
      title: 'KerjaCUS Auth Service',
      version: '1.0.0',
      description:
        'Session-based auth (Better Auth). Email+password, Google OAuth, phone OTP, profile.',
    },
    servers: [{ url: '/', description: 'Same-origin via API Gateway' }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'httpOnly Secure SameSite=Lax session cookie',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            code: { type: 'string' },
          },
          required: ['message', 'code'],
        },
        SignInRequest: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Email or phone (+62 format)' },
            password: { type: 'string', minLength: 8 },
          },
          required: ['identifier', 'password'],
        },
        SignUpRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            name: { type: 'string' },
            phone: { type: 'string', pattern: '^\\+62\\d{9,13}$' },
            role: { type: 'string', enum: ['owner', 'talent'] },
          },
          required: ['email', 'password', 'name', 'phone', 'role'],
        },
        ChangePasswordRequest: {
          type: 'object',
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 },
          },
          required: ['currentPassword', 'newPassword'],
        },
        UpdateProfileRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            avatarUrl: { type: 'string', format: 'uri', nullable: true },
            locale: { type: 'string', enum: ['id', 'en'] },
          },
        },
        VerifyOtpRequest: {
          type: 'object',
          properties: {
            code: { type: 'string', minLength: 6, maxLength: 6 },
          },
          required: ['code'],
        },
        UserProfile: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            phone: { type: 'string' },
            phoneVerified: { type: 'boolean' },
            role: { type: 'string', enum: ['owner', 'talent', 'admin'] },
            avatarUrl: { type: 'string', nullable: true },
            locale: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Liveness probe',
          tags: ['health'],
          responses: { '200': { description: 'Service alive' } },
        },
      },
      '/health/ready': {
        get: {
          summary: 'Readiness probe (DB + Better Auth)',
          tags: ['health'],
          responses: {
            '200': { description: 'Ready' },
            '503': { description: 'Dependency unreachable' },
          },
        },
      },
      '/api/v1/auth/sign-in/email-or-phone': {
        post: {
          summary: 'Sign in with email or phone',
          tags: ['auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SignInRequest' } },
            },
          },
          responses: {
            '200': { description: 'Session created (sets cookie)' },
            '400': {
              description: 'Missing fields',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
            '401': {
              description: 'Invalid credentials',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
          },
        },
      },
      '/api/v1/auth/sign-up/email': {
        post: {
          summary: 'Register with email + phone',
          tags: ['auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SignUpRequest' } },
            },
          },
          responses: {
            '200': { description: 'Account created' },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
            '409': {
              description: 'Phone or email already taken',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
              },
            },
          },
        },
      },
      '/api/v1/auth/sign-out': {
        post: {
          summary: 'Sign out current session',
          tags: ['auth'],
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Session cleared' } },
        },
      },
      '/api/v1/auth/get-session': {
        get: {
          summary: 'Get current session (Better Auth)',
          tags: ['auth'],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Session info' },
            '401': { description: 'Not authenticated' },
          },
        },
      },
      '/api/v1/auth/sign-in/social': {
        post: {
          summary: 'Start social OAuth (Google)',
          tags: ['auth'],
          responses: {
            '200': { description: 'Redirect URL' },
            '302': { description: 'Redirect to provider' },
          },
        },
      },
      '/api/v1/me': {
        get: {
          summary: 'Get current user profile',
          tags: ['profile'],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': {
              description: 'User profile',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/UserProfile' } },
              },
            },
            '401': { description: 'Not authenticated' },
          },
        },
        patch: {
          summary: 'Update profile',
          tags: ['profile'],
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateProfileRequest' },
              },
            },
          },
          responses: {
            '200': { description: 'Profile updated' },
            '400': { description: 'Validation error' },
            '401': { description: 'Not authenticated' },
          },
        },
      },
      '/api/v1/me/change-password': {
        post: {
          summary: 'Change own password',
          tags: ['profile'],
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChangePasswordRequest' },
              },
            },
          },
          responses: {
            '200': { description: 'Password changed' },
            '400': { description: 'Validation error' },
            '401': { description: 'Wrong current password' },
          },
        },
      },
      '/api/v1/phone/request-otp': {
        post: {
          summary: 'Request 6-digit OTP to verify phone',
          tags: ['phone'],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'OTP sent' },
            '401': { description: 'Not authenticated' },
            '429': { description: 'Too many requests' },
          },
        },
      },
      '/api/v1/phone/verify': {
        post: {
          summary: 'Submit OTP code',
          tags: ['phone'],
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/VerifyOtpRequest' } },
            },
          },
          responses: {
            '200': { description: 'Phone verified' },
            '400': { description: 'Invalid or expired code' },
          },
        },
      },
      '/api/v1/phone/status': {
        get: {
          summary: 'Get phone verification status',
          tags: ['phone'],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Verification status' },
            '401': { description: 'Not authenticated' },
          },
        },
      },
    },
  }),
)

// Routes
app.route('/health', healthRoute)
app.route('/api/v1/auth', authRoute)
app.route('/api/v1/me', meRoute)
app.route('/api/v1/phone', phoneVerificationRoute)

const port = env.PORT
console.log(`Auth service running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
