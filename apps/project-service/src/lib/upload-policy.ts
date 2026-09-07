/**
 * What a presigned upload is allowed to be.
 *
 * The presign used to take the caller's content type and put it straight into
 * PutObjectCommand, and take the extension from the caller's file name. Two
 * consequences. Storage is proxied at /storage/ from the API origin, so an
 * attacker-chosen text/html or image/svg+xml is served back as script from a
 * host that shares a registrable domain with the app. And the key ended in
 * whatever followed the last dot in the supplied name.
 *
 * There was also no size limit anywhere on the server. The 5MB CV cap existed
 * only as a check in the browser, which is not a cap.
 *
 * So the server decides all three now: which types a folder takes, how large,
 * and what the key ends in.
 */

const MB = 1024 * 1024

export type UploadFolder = 'cv' | 'milestone' | 'avatar' | 'evidence' | 'document'

/** Extension per accepted type. The key ends in this, not in the file name. */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/zip': 'zip',
}

const DOCUMENTS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

const IMAGES = ['image/png', 'image/jpeg', 'image/webp']

// No SVG anywhere: it carries script and renders inline.
const ALLOWED: Record<UploadFolder, readonly string[]> = {
  cv: DOCUMENTS,
  document: [...DOCUMENTS, 'application/msword'],
  avatar: IMAGES,
  milestone: [...DOCUMENTS, ...IMAGES, 'text/plain', 'text/markdown', 'application/zip'],
  evidence: [...DOCUMENTS, ...IMAGES, 'text/plain'],
}

/** Signed into the URL, so the upload cannot exceed it. */
export const MAX_UPLOAD_BYTES: Record<UploadFolder, number> = {
  cv: 5 * MB,
  document: 10 * MB,
  avatar: 2 * MB,
  milestone: 10 * MB,
  evidence: 10 * MB,
}

export type UploadDecision =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; reason: 'type' | 'size' }

/** Normalise `application/pdf; charset=binary` down to the media type. */
function mediaType(raw: string): string {
  return raw.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function extensionFor(contentType: string): string {
  return EXTENSIONS[mediaType(contentType)] ?? 'bin'
}

export function resolveUploadPolicy(
  folder: UploadFolder,
  rawContentType: string,
  sizeBytes: number,
): UploadDecision {
  const contentType = mediaType(rawContentType)
  if (!ALLOWED[folder].includes(contentType)) return { ok: false, reason: 'type' }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, reason: 'size' }
  if (sizeBytes > MAX_UPLOAD_BYTES[folder]) return { ok: false, reason: 'size' }
  return { ok: true, contentType, extension: extensionFor(contentType) }
}
