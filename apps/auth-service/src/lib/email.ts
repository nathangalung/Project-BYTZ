/**
 * Transactional mail for the auth flows: verification and password recovery.
 *
 * Both env reads happen per call, not at module load. A module constant froze
 * the value at import, which made the configured and unconfigured paths two
 * different module instances and left the choice to whether whoever ran the
 * process happened to have a .env -- it covered locally and not in CI.
 */

/**
 * Used when EMAIL_FROM is unset. Must name a domain verified in Resend, or
 * every send answers 403 and the failure looks like silence: password recovery
 * replies identically whether the address exists, so nothing on screen can
 * tell a rejected send from a delivered one.
 *
 * A subdomain, because signup sends to addresses nobody confirmed wants mail
 * and those complaints attach to whichever domain signs the DKIM. The root
 * carries the human mailbox. This read RESEND_FROM before, a name set nowhere
 * in the repo.
 */
const DEFAULT_EMAIL_FROM = 'KerjaCUS! <noreply@notify.kerjacus.id>'

export type SendEmailParams = {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * `b***@example.com`. Enough to tell which send is which in a log, not enough
 * to harvest the address list out of one.
 */
function redactAddress(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 1) return '***'
  return `${address[0]}***${address.slice(at)}`
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    /*
     * The envelope only.
     *
     * This used to log `params`, and params carries the body: for a password
     * reset and for email verification that body is a single-use link with the
     * token in it. Production runs without RESEND_API_KEY, so every reset
     * request wrote a working account-takeover link into a log stream that far
     * more people can read than can read the mailbox it was meant for.
     */
    console.log('[email] RESEND_API_KEY missing, message dropped:', {
      to: redactAddress(params.to),
      subject: params.subject,
    })
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
