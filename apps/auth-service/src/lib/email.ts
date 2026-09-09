/**
 * Transactional mail for the auth flows: verification and password recovery.
 *
 * Both env reads happen per call, not at module load. A module constant froze
 * the value at import, which made the configured and unconfigured paths two
 * different module instances and left the choice to whether whoever ran the
 * process happened to have a .env -- it covered locally and not in CI.
 */

/**
 * Used when EMAIL_FROM is unset. Deliberately a subdomain, and deliberately
 * the same default notification-service uses: transactional reputation and the
 * corporate mailbox on the root domain must not share an SPF record or a
 * complaint history. This read RESEND_FROM before, a name set nowhere in the
 * repo, so what shipped was a hardcoded root-domain sender no deployment could
 * correct.
 */
const DEFAULT_EMAIL_FROM = 'KerjaCUS! <noreply@notify.kerjacus.id>'

export type SendEmailParams = {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY missing, would have sent:', params)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM, ...params }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Resend send failed: ${res.status} ${err}`)
  }
}

export function buildVerificationEmail(name: string, verifyUrl: string) {
  return {
    subject: 'Verifikasi email KerjaCUS Anda',
    html: `<p>Hi ${name},</p><p>Klik link berikut untuk verifikasi email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Link berlaku 24 jam.</p>`,
    text: `Hi ${name}, verifikasi email Anda di: ${verifyUrl}`,
  }
}
