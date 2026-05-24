import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { env } from '../lib/env'
import { getAuthUser } from '../middleware/session'

const presignedUrlSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  folder: z.enum(['cv', 'milestone', 'avatar', 'evidence', 'document']),
})

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
})

const BUCKET = env.S3_BUCKET

export const uploadRoute = new Hono()

uploadRoute.post('/presigned-url', async (c) => {
  getAuthUser(c)
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
    data: { url, key },
  })
})
