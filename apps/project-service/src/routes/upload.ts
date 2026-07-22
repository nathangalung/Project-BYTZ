import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { env } from '../lib/env'
import { withServiceAuth } from '../lib/service-auth'
import { BUCKET, s3 } from '../lib/storage'
import { signUploadKey, verifyUploadKey } from '../lib/upload-token'
import { getAuthUser } from '../middleware/session'

const presignedUrlSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  folder: z.enum(['cv', 'milestone', 'avatar', 'evidence', 'document']),
})

export const uploadRoute = new Hono()

uploadRoute.post('/presigned-url', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()
  const parsed = presignedUrlSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid upload params', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const ext = parsed.data.fileName.split('.').pop() || 'bin'
  const key = `${parsed.data.folder}/${uuidv7()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: parsed.data.fileType,
  })

  let url = await getSignedUrl(s3, command, { expiresIn: 600 })

  // Rewrite internal S3 endpoint to public URL so browsers can reach it.
  if (env.S3_PUBLIC_URL) {
    url = url.replace(env.S3_ENDPOINT, env.S3_PUBLIC_URL)
  }

  return c.json({
    success: true,
    // token proves this caller was given this key.
    data: { url, key, token: signUploadKey(key, user.id, env.SERVICE_AUTH_SECRET) },
  })
})

const parseCvSchema = z.object({
  key: z.string().min(1),
  token: z.string().min(1),
  fileType: z.string().min(1).max(10).optional(),
})

/**
 * Parse a CV the caller uploaded.
 *
 * The AI service route this proxies returns name, email, phone, education and
 * employment history, and it only checks that the key points at project
 * storage, not who owns it. The browser used to call it directly, so it was
 * open to anyone: nginx proxies /api/v1/ai straight through and the AI service
 * reads no session. Ownership is checked here, and the AI service now requires
 * the inter-service secret the browser cannot mint.
 */
uploadRoute.post('/parse-cv', async (c) => {
  const user = getAuthUser(c)
  const parsed = parseCvSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid parse params', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { key, token, fileType } = parsed.data
  if (!verifyUploadKey(key, user.id, token, env.SERVICE_AUTH_SECRET)) {
    throw new AppError('AUTH_FORBIDDEN', 'Upload token does not match this key')
  }

  // Presigned GET, so the bucket does not have to be public.
  const fileUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 300,
  })

  const res = await fetch(`${env.AI_SERVICE_URL}/api/v1/ai/parse-cv`, {
    method: 'POST',
    headers: withServiceAuth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      talent_id: user.id,
      file_url: fileUrl,
      file_type: fileType ?? key.split('.').pop() ?? 'pdf',
    }),
  })

  if (!res.ok) {
    throw new AppError('AI_SERVICE_UNAVAILABLE', 'CV parsing is unavailable')
  }

  return c.json({ success: true, data: await res.json() })
})
