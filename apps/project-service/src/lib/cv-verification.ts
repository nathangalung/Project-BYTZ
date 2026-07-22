/**
 * CV parsing is the only vetting stage, so its confidence decides verification.
 *
 * 0.5 sits above an empty parse, which the AI service reports as 0.0 when the
 * document yields under 50 characters, and below the 0.7 ceiling of the regex
 * fallback, so a talent is not held back just because the LLM path was down.
 */
export const CV_VERIFY_MIN_CONFIDENCE = 0.5

export type VerificationStatus = 'unverified' | 'cv_parsing' | 'verified' | 'suspended'

export function verificationFromParse(confidence: number | undefined): VerificationStatus {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unverified'
  return confidence >= CV_VERIFY_MIN_CONFIDENCE ? 'verified' : 'unverified'
}
