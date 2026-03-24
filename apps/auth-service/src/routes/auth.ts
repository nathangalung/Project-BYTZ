import { getDb, user as userTable } from '@kerjacus/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { auth } from '../lib/auth'

export const authRoute = new Hono()

function getDirectDb() {
  return getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)
}

// Custom sign-in: accepts email OR phone number
authRoute.post('/sign-in/email-or-phone', async (c) => {
  const body = await c.req.json()
  const { identifier, password } = body

  if (!identifier || !password) {
    return c.json(
      { message: 'Email/nomor HP dan password wajib diisi', code: 'MISSING_FIELD' },
      400,
    )
  }

  const isPhone = identifier.startsWith('+62')
  const db = getDirectDb()

  const [foundUser] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(isPhone ? eq(userTable.phone, identifier) : eq(userTable.email, identifier))
    .limit(1)

  if (!foundUser) {
    return c.json({ message: 'Akun tidak ditemukan', code: 'USER_NOT_FOUND' }, 401)
  }

  // Create a NEW request for Better Auth (original body is consumed)
  const signInReq = new Request(`${process.env.BETTER_AUTH_URL}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: foundUser.email, password }),
  })

  return auth.handler(signInReq)
})

// Custom sign-up: validate phone+email uniqueness, then forward to Better Auth
authRoute.post('/sign-up/email', async (c) => {
  // Clone the body so Better Auth can read it too
  const bodyText = await c.req.text()
  const body = JSON.parse(bodyText)

  // Block admin registration and validate role
  const validRoles = ['owner', 'talent']
  if (body.role && !validRoles.includes(body.role)) {
    return c.json({ message: 'Invalid role. Must be owner or talent', code: 'INVALID_ROLE' }, 400)
  }

  // Validate phone presence and format
  if (!body.phone) {
    return c.json({ message: 'Nomor telepon wajib diisi', code: 'MISSING_FIELD' }, 400)
  }

  if (!/^\+62\d{9,13}$/.test(body.phone)) {
    return c.json(
      {
        message: 'Format nomor telepon tidak valid. Gunakan +62 diikuti 9-13 digit',
        code: 'INVALID_PHONE',
      },
      400,
    )
  }

  if (!body.email) {
    return c.json({ message: 'Email wajib diisi', code: 'MISSING_FIELD' }, 400)
  }

  const db = getDirectDb()

  // Check phone uniqueness
  const [existingPhone] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.phone, body.phone))
    .limit(1)

  if (existingPhone) {
    return c.json({ message: 'Nomor telepon sudah terdaftar', code: 'PHONE_ALREADY_EXISTS' }, 409)
  }

  // Check email uniqueness
  const [existingEmail] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, body.email))
    .limit(1)

  if (existingEmail) {
    return c.json({ message: 'Email sudah terdaftar', code: 'EMAIL_ALREADY_EXISTS' }, 409)
  }

  // Create a NEW request for Better Auth (our body read consumed the original)
  const signUpReq = new Request(c.req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  })

  return auth.handler(signUpReq)
})

// Better Auth catch-all for all other auth routes
authRoute.all('/*', async (c) => {
  return auth.handler(c.req.raw)
})
