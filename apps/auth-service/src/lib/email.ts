const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM || 'KerjaCUS <noreply@kerjacus.id>'

export type SendEmailParams = {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY missing, would have sent:', params)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: RESEND_FROM, ...params }),
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
