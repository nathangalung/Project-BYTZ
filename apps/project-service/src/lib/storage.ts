import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env'

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
})

export const BUCKET = env.S3_BUCKET

const READ_URL_TTL_SECONDS = 900

/**
 * Reduce a stored value to an object key.
 *
 * Uploads record the presigned PUT with its query string stripped, so the
 * column holds a full URL rather than a key. Older rows may hold either, and
 * the host differs between the internal endpoint and the public one.
 */
export function storageKeyOf(stored: string): string {
  if (!stored.startsWith('http://') && !stored.startsWith('https://')) {
    return stored.replace(/^\/+/, '')
  }

  // Public URLs carry a /storage prefix before the bucket, internal ones do
  // not. Take everything after the first bucket segment.
  const segments = new URL(stored).pathname.split('/').filter(Boolean)
  const bucketAt = segments.indexOf(BUCKET)
  return (bucketAt === -1 ? segments : segments.slice(bucketAt + 1)).join('/')
}

/**
 * Sign a read for a stored object.
 *
 * The bucket is private because it holds CVs, dispute evidence and
 * deliverables, so a bare URL 403s. Callers must have authorised the read
 * first: this signs whatever key it is given.
 */
export function presignStoredObject(stored: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: storageKeyOf(stored) }), {
    expiresIn: READ_URL_TTL_SECONDS,
  })
}
