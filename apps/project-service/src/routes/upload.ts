import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getDb, talentProfiles } from '@kerjacus/db'
import { AppError } from '@kerjacus/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import { claimCvParse, releaseCvParse, verificationFromParse } from '../lib/cv-verification'
import { env } from '../lib/env'
import { serviceFetch, TIMEOUT_MS } from '../lib/http/service-fetch'
import { UpstreamError } from '../lib/http/upstream-error'
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

  const parseResult = await runCvParse(user.id, key, fileType ?? key.split('.').pop() ?? 'pdf')
  return c.json({ success: true, data: parseResult })
})

/**
 * Re-parse the CV already on file.
 *
 * Parsing runs once during registration and swallows a transient AI or storage
 * outage, leaving the talent unverified and invisible to matching with no way
 * back. This lets them retry against the stored CV without re-uploading.
 */
uploadRoute.post('/reparse-cv', async (c) => {
  const user = getAuthUser(c)
  const db = getDb()
  const [profile] = await db
    .select({ cvFileUrl: talentProfiles.cvFileUrl })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, user.id))
    .limit(1)
  if (!profile?.cvFileUrl) {
    throw new AppError('NOT_FOUND', 'No CV on file to re-parse')
  }

  const key = profile.cvFileUrl
  const parseResult = await runCvParse(user.id, key, key.split('.').pop() ?? 'pdf')
  return c.json({ success: true, data: parseResult })
})

/**
 * Fetch the stored CV, parse it via the AI service, and persist the result.
 *
 * A download or AI failure surfaces as an error here rather than a fake
 * zero-confidence parse, so the caller can retry instead of silently marking a
 * good CV unverified.
 */
async function runCvParse(
  userId: string,
  key: string,
  fileType: string,
): Promise<{ parsed_data?: Record<string, unknown>; confidence_score?: number }> {
  // Presigned GET, so the bucket does not have to be public.
  const fileUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 300,
  })

  // Claimed before the call, so a second tab is refused rather than billed.
  const claim = await claimCvParse(userId)

  let parseResult: { parsed_data?: Record<string, unknown>; confidence_score?: number }
  try {
    const res = await serviceFetch(
      `${env.AI_SERVICE_URL}/api/v1/ai/parse-cv`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ talent_id: userId, file_url: fileUrl, file_type: fileType }),
      },
      { service: 'ai-service', timeoutMs: TIMEOUT_MS.cvParse },
    )
    // Reading the body belongs to the call. A 2xx carrying JSON that will not
    // parse is still a parse that produced nothing, and leaving it outside left
    // the talent sitting in cv_parsing until the reclaim timer caught them.
    parseResult = (await res.json()) as typeof parseResult
  } catch (err) {
    // Nothing was parsed, so hand the status back before anything else: an
    // outage says nothing about the CV and must not cost a verified talent
    // their standing.
    await releaseCvParse(userId, claim)
    if (err instanceof UpstreamError && err.status === 404) {
      // Storage no longer holds the object, so a retry cannot succeed. Forget
      // the key too, or the re-parse button keeps offering one that always fails.
      await clearCvFileKey(userId)
      throw new AppError(
        'CV_FILE_MISSING',
        'The CV is no longer in storage; please upload it again',
      )
    }
    if (err instanceof UpstreamError) {
      // Record the uploaded CV even though this parse failed, so the talent can
      // find and re-parse it rather than losing a file nobody remembered.
      await persistCvFileKey(userId, key)
      throw new AppError('AI_SERVICE_UNAVAILABLE', 'CV parsing is unavailable')
    }
    throw err
  }

  await persistCvParse(userId, key, parseResult)
  return parseResult
}

/**
 * Record the parse on the talent profile and vet the talent.
 *
 * CV parsing is the only vetting stage, and nothing was writing its result:
 * cv_parsed_data was never populated and verification_status never left
 * 'unverified', while the talent directory and the matching query both require
 * 'verified'. A real talent could therefore never be recommended for anything.
 *
 * The profile row may not exist yet, because registration parses the CV before
 * submitting the rest of the form, so this creates a stub the later profile
 * write fills in.
 */
async function persistCvParse(
  userId: string,
  key: string,
  result: { parsed_data?: Record<string, unknown>; confidence_score?: number },
): Promise<void> {
  const db = getDb()
  const status = verificationFromParse(result.confidence_score)

  const fields = {
    cvFileUrl: key,
    cvParsedData: result.parsed_data ?? null,
    verificationStatus: status,
    updatedAt: new Date(),
  }

  const [existing] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (existing) {
    await db.update(talentProfiles).set(fields).where(eq(talentProfiles.id, existing.id))
    return
  }

  await db.insert(talentProfiles).values({ id: uuidv7(), userId, ...fields })
}

/**
 * Record the uploaded CV key when parsing failed.
 *
 * Leaves verification and any prior parsed data untouched; it only remembers
 * the file so the talent can re-parse it rather than losing a key nobody saved.
 */
async function persistCvFileKey(userId: string, key: string): Promise<void> {
  const db = getDb()
  const [existing] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (existing) {
    await db
      .update(talentProfiles)
      .set({ cvFileUrl: key, updatedAt: new Date() })
      .where(eq(talentProfiles.id, existing.id))
    return
  }

  await db
    .insert(talentProfiles)
    .values({ id: uuidv7(), userId, cvFileUrl: key, verificationStatus: 'unverified' })
}

/**
 * Drop a CV key storage no longer serves.
 *
 * Updates only: a talent whose profile does not exist yet has nothing to
 * forget, and a stub row would just hide the upload form behind a re-parse
 * button for a file that is gone.
 */
async function clearCvFileKey(userId: string): Promise<void> {
  const db = getDb()
  const [existing] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, userId))
    .limit(1)

  if (!existing) return

  await db
    .update(talentProfiles)
    .set({ cvFileUrl: null, updatedAt: new Date() })
    .where(eq(talentProfiles.id, existing.id))
}
