import { describe, expect, it } from 'vitest'
import {
  extensionFor,
  MAX_UPLOAD_BYTES,
  resolveUploadPolicy,
  type UploadFolder,
} from './upload-policy'

describe('resolveUploadPolicy', () => {
  it('accepts a PDF CV within the cap', () => {
    const out = resolveUploadPolicy('cv', 'application/pdf', 1_000_000)

    expect(out).toEqual({ ok: true, contentType: 'application/pdf', extension: 'pdf' })
  })

  /** The upload inputs offer pptx, so the server has to accept it. */
  it('accepts every format the CV upload input offers', () => {
    const offered = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]

    for (const type of offered) {
      expect(resolveUploadPolicy('cv', type, 1_000).ok).toBe(true)
    }
  })

  it('refuses a content type the folder does not allow', () => {
    const out = resolveUploadPolicy('cv', 'text/html', 1_000)

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('type')
  })

  /** The vector that made this worth doing: SVG executes when served inline. */
  it('refuses svg on an avatar', () => {
    expect(resolveUploadPolicy('avatar', 'image/svg+xml', 1_000).ok).toBe(false)
  })

  it('refuses a file over the folder cap', () => {
    const out = resolveUploadPolicy('cv', 'application/pdf', MAX_UPLOAD_BYTES.cv + 1)

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('size')
  })

  it('accepts a file exactly at the cap', () => {
    expect(resolveUploadPolicy('cv', 'application/pdf', MAX_UPLOAD_BYTES.cv).ok).toBe(true)
  })

  it('refuses a zero or negative size', () => {
    expect(resolveUploadPolicy('cv', 'application/pdf', 0).ok).toBe(false)
    expect(resolveUploadPolicy('cv', 'application/pdf', -1).ok).toBe(false)
  })

  it('ignores parameters on the content type', () => {
    const out = resolveUploadPolicy('cv', 'application/pdf; charset=binary', 1_000)

    expect(out.ok).toBe(true)
  })

  it('matches the content type case insensitively', () => {
    expect(resolveUploadPolicy('cv', 'APPLICATION/PDF', 1_000).ok).toBe(true)
  })

  it('gives every folder a cap', () => {
    const folders: UploadFolder[] = ['cv', 'milestone', 'avatar', 'evidence', 'document']

    for (const folder of folders) {
      expect(MAX_UPLOAD_BYTES[folder]).toBeGreaterThan(0)
    }
  })
})

describe('extensionFor', () => {
  /**
   * The key used to end in whatever followed the last dot in the name the
   * caller sent, so "cv.pdf/../../x" became part of the object key.
   */
  it('comes from the content type, never the file name', () => {
    expect(extensionFor('application/pdf')).toBe('pdf')
    expect(extensionFor('image/jpeg')).toBe('jpg')
  })

  it('falls back to bin for anything unmapped', () => {
    expect(extensionFor('application/x-made-up')).toBe('bin')
  })
})
