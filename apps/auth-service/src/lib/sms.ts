/** WhatsApp OTP delivery via Zenziva WA Regular API. */

type OtpResult = { success: boolean; messageId?: string; error?: string }

/**
 * Send OTP via Zenziva WhatsApp Regular API.
 *
 * Endpoint: POST https://console.zenziva.net/wareguler/api/sendWA/
 * Params: userkey, passkey, to, message
 * Response: { status: "1", text: "Success", to: "08xxx" }
 *
 * Webhook (POST to configured URL):
 * { type: "whatsapp", messageId: "594512", status: "Delivered" }
 * Status: SENT, DELIVERED, READED, FAILED
 */
async function sendViaZenziva(phone: string, message: string): Promise<OtpResult> {
  const userKey = process.env.ZENZIVA_USER_KEY
  const apiKey = process.env.ZENZIVA_API_KEY
  if (!userKey || !apiKey) return { success: false, error: 'ZENZIVA keys not configured' }

  const cleanPhone = phone.startsWith('+') ? phone.slice(1) : phone

  try {
    const res = await fetch('https://console.zenziva.net/wareguler/api/sendWA/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        userkey: userKey,
        passkey: apiKey,
        to: cleanPhone,
        message,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })

    const data = (await res.json()) as {
      status?: string
      text?: string
      to?: string
      messageId?: string
    }

    if (data.status === '1') {
      return { success: true, messageId: data.messageId ?? data.to }
    }

    return { success: false, error: data.text ?? 'Zenziva WhatsApp send failed' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/**
 * Send OTP via WhatsApp (Zenziva).
 * Falls back to console.log in development when ZENZIVA keys are not set.
 */
export async function sendOtp(phone: string, code: string): Promise<OtpResult> {
  const message = `[KerjaCUS!] Kode verifikasi Anda: ${code}. Berlaku 5 menit. Jangan bagikan kode ini kepada siapapun.`

  if (process.env.ZENZIVA_USER_KEY) {
    const result = await sendViaZenziva(phone, message)
    if (result.success) return result
    console.error(`[WA/Zenziva] Failed for ${phone}:`, result.error)
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV OTP] ${phone}: ${code}`)
    return { success: true, messageId: 'dev-console' }
  }

  return { success: false, error: 'ZENZIVA_USER_KEY and ZENZIVA_API_KEY required for WhatsApp OTP' }
}
