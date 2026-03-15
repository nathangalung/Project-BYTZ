import { AppError } from '@bytz/shared'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const presignedUrlSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  folder: z.enum(['cv', 'milestone', 'avatar', 'evidence']),
})

export const uploadRoute = new Hono()

// POST /presigned-url
uploadRoute.post('/presigned-url', async (c) => {
  const body = await c.req.json()

  const parsed = presignedUrlSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid upload params', {
      issues: parsed.error.flatten().fieldErrors,
    })
  }

  const ext = parsed.data.fileName.split('.').pop() || 'bin'
  const key = `${parsed.data.folder}/${uuidv7()}.${ext}`
  const bucket = process.env.S3_BUCKET || 'bytz-uploads'
  const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000'

  // TODO: generate real presigned URL via AWS SDK
  const uploadUrl = `${endpoint}/${bucket}/${key}`
  const fileUrl = `${endpoint}/${bucket}/${key}`

  return c.json({
    success: true,
    data: { uploadUrl, fileUrl, key },
  })
})
