import { S3Client } from '@aws-sdk/client-s3'
import { getDb } from '@kerjacus/db'
import { env } from '../lib/env'
import { InvoiceRepository } from '../repositories/invoice.repository'
import { InvoiceService } from './invoice.service'

/**
 * Builds the invoice service, cached for the process lifetime.
 *
 * This lived in routes/invoices.ts, which made invoice-consumer.ts import from
 * routes/ to get it. That was the only service-to-route edge in the codebase,
 * and it is backwards: a NATS consumer has no HTTP layer to depend on, and the
 * edge would have pulled the whole route module, its middleware and Hono into
 * the consumer's graph. Both callers want the service, so the factory belongs
 * next to the service.
 */

// MinIO via the AWS SDK, same config pattern as upload.ts.
function buildS3(): { client: S3Client | null; bucket: string; endpoint: string } {
  const endpoint = env.S3_ENDPOINT
  const bucket = env.S3_BUCKET
  // S3_ENDPOINT=disabled turns storage off in dev and test.
  if (endpoint === 'disabled') return { client: null, bucket, endpoint }
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
  })
  return { client, bucket, endpoint }
}

let cachedService: InvoiceService | null = null

export function getInvoiceService(): InvoiceService {
  if (cachedService) return cachedService
  const db = getDb()
  const repo = new InvoiceRepository(db)
  const { client, bucket, endpoint } = buildS3()
  cachedService = new InvoiceService(repo, client, bucket, endpoint)
  return cachedService
}
