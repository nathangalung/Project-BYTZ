import { describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({
  env: {
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_URL: 'https://api.kerjacus.id/storage',
    S3_BUCKET: 'kerjacus-uploads',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
  },
}))

const { storageKeyOf } = await import('./storage')

/**
 * Uploads record the presigned PUT with its query string stripped, so columns
 * hold a full object URL rather than a key, and the host differs depending on
 * whether the URL was rewritten to the public one for the browser. Signing a
 * read has to recover the key from any of those shapes.
 */

describe('storageKeyOf', () => {
  it('passes a bare key through', () => {
    expect(storageKeyOf('milestone/abc.pdf')).toBe('milestone/abc.pdf')
  })

  it('strips a leading slash', () => {
    expect(storageKeyOf('/milestone/abc.pdf')).toBe('milestone/abc.pdf')
  })

  it('recovers the key from the internal endpoint', () => {
    expect(storageKeyOf('http://minio:9000/kerjacus-uploads/milestone/abc.pdf')).toBe(
      'milestone/abc.pdf',
    )
  })

  it('recovers the key from the public URL', () => {
    expect(storageKeyOf('https://api.kerjacus.id/storage/kerjacus-uploads/cv/x.pdf')).toBe(
      'cv/x.pdf',
    )
  })

  // Uploads store the PUT URL with its signature stripped.
  it('ignores a leftover query string', () => {
    expect(
      storageKeyOf('http://minio:9000/kerjacus-uploads/evidence/e.png?X-Amz-Signature=abc'),
    ).toBe('evidence/e.png')
  })

  it('keeps nested prefixes intact', () => {
    expect(storageKeyOf('http://minio:9000/kerjacus-uploads/document/2026/07/a.pdf')).toBe(
      'document/2026/07/a.pdf',
    )
  })

  it('does not strip a bucket name that only appears deeper in the path', () => {
    expect(storageKeyOf('http://minio:9000/kerjacus-uploads/cv/kerjacus-uploads/x.pdf')).toBe(
      'cv/kerjacus-uploads/x.pdf',
    )
  })

  /**
   * A bucket-less URL is what a row written before the bucket was renamed
   * looks like, or one rewritten by a CDN that serves the bucket at its root.
   * Dropping the first segment there would sign the wrong key and 404 the
   * download; keeping the whole path is the only recoverable reading.
   */
  it('keeps the whole path when the bucket does not appear in it', () => {
    expect(storageKeyOf('https://cdn.kerjacus.id/cv/x.pdf')).toBe('cv/x.pdf')
  })

  it('keeps a nested path intact when the bucket is absent', () => {
    expect(storageKeyOf('https://cdn.kerjacus.id/document/2026/07/a.pdf')).toBe(
      'document/2026/07/a.pdf',
    )
  })
})
