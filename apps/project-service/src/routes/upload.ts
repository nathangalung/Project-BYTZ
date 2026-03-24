import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { getAuthUser } from '../middleware/session'

const presignedUrlSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  folder: z.enum(['cv', 'milestone', 'avatar', 'evidence', 'document']),
})

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
})

const BUCKET = process.env.S3_BUCKET || 'kerjacus-uploads'

export const uploadRoute = new Hono()

uploadRoute.post('/presigned-url', async (c) => {
  getAuthUser(c)
  const body = await c.req.json()
  const parsed = presignedUrlSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid upload params', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const ext = parsed.data.fileName.split('.').pop() || 'bin'
  const key = `${parsed.data.folder}/${uuidv7()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: parsed.data.fileType,
  })

  const url = await getSignedUrl(s3, command, { expiresIn: 600 })

  return c.json({
    success: true,
    data: { url, key },
  })
})
