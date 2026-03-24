/** SMS/WhatsApp gateway abstraction for OTP delivery. */

type SmsResult = { success: boolean; messageId?: string; error?: string }

/** Send OTP via Zenziva (official WhatsApp Business API partner Indonesia) */
async function sendViaZenziva(phone: string, message: string): Promise<SmsResult> {
  const userKey = process.env.ZENZIVA_USER_KEY
  const apiKey = process.env.ZENZIVA_API_KEY
  if (!userKey || !apiKey) return { success: false, error: 'ZENZIVA keys not configured' }

  try {
    const params = new URLSearchParams({ userkey: userKey, passkey: apiKey, to: phone, message })
    const res = await fetch(`https://console.zenziva.net/wareguler/api/sendWA/?${params}`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
    const data = (await res.json()) as { status?: string; text?: string; to?: string }
    if (data.status === '1') {
      return { success: true, messageId: data.to }
    }
    return { success: false, error: data.text ?? 'Zenziva send failed' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Fallback: send via Fonnte (unofficial, dev/testing only) */
async function sendViaFonnte(phone: string, message: string): Promise<SmsResult> {
  const apiKey = process.env.FONNTE_API_KEY
  if (!apiKey) return { success: false, error: 'FONNTE_API_KEY not configured' }

  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: apiKey },
      body: new URLSearchParams({ target: phone, message, countryCode: '62' }),
      signal: AbortSignal.timeout(10000),
    })
    const data = (await res.json()) as { status?: boolean; id?: string; reason?: string }
    if (data.status) return { success: true, messageId: data.id }
    return { success: false, error: data.reason ?? 'Unknown error' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Send OTP. Priority: Zenziva (production), Fonnte (dev fallback), console.log (local). */
export async function sendOtp(phone: string, code: string): Promise<SmsResult> {
  const message = `[KerjaCUS!] Kode verifikasi Anda: ${code}. Berlaku 5 menit. Jangan bagikan kode ini.`

  // Zenziva (official WhatsApp Business API)
  if (process.env.ZENZIVA_USER_KEY) {
    const result = await sendViaZenziva(phone, message)
    if (result.success) return result
    console.error(`[SMS/Zenziva] Failed for ${phone}:`, result.error)
  }

  // Fonnte fallback (dev/testing)
  if (process.env.FONNTE_API_KEY) {
    const result = await sendViaFonnte(phone, message)
    if (result.success) return result
    console.error(`[SMS/Fonnte] Failed for ${phone}:`, result.error)
  }

  // Local dev: console only
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV OTP] ${phone}: ${code}`)
    return { success: true, messageId: 'dev-console' }
  }

  return { success: false, error: 'No SMS provider configured' }
}
