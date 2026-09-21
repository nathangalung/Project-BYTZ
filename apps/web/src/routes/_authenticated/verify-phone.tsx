import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackButton } from '@/components/ui/back-button'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/verify-phone')({
  component: VerifyPhonePage,
})

const OTP_LENGTH = 6
const COOLDOWN_SECONDS = 60

/**
 * One message per reason the OTP endpoints refuse.
 *
 * Both handlers below used to answer every failure with "invalid or expired
 * code", which is wrong for four of the five things that can go wrong and
 * tells the caller to retype a code that will never be accepted.
 */
const OTP_ERROR_KEYS: Record<string, string> = {
  RATE_LIMIT_EXCEEDED: 'otp_too_many',
  AUTH_INVALID_TOKEN: 'otp_invalid',
  CONFLICT: 'phone_already_verified',
  VALIDATION_ERROR: 'otp_no_phone',
}

function otpErrorKey(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback
  return OTP_ERROR_KEYS[err.code] ?? fallback
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return phone
  const prefix = phone.slice(0, 6)
  const suffix = phone.slice(-3)
  const masked = '*'.repeat(phone.length - 9)
  return `${prefix}${masked}${suffix}`
}

function VerifyPhonePage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const isDev = import.meta.env.DEV

  const requestOtp = useCallback(async () => {
    if (cooldown > 0) return
    try {
      const body = await apiFetch<{ data?: { devCode?: string } }>('/api/v1/phone/request-otp', {
        method: 'POST',
      })
      setSuccess(t('otp_sent'))
      setError('')
      setCooldown(COOLDOWN_SECONDS)
      // The field is devCode, and the server omits it in production. This read
      // `data.otp`, a name nothing sends, so the developer hint never appeared.
      if (isDev && body.data?.devCode) setDevOtp(body.data.devCode)
    } catch (err) {
      // A refused request has a reason the caller can act on - wait out the
      // cooldown, add a number, stop because the number is already verified -
      // and every one of them used to be silent: a non-2xx left the page
      // exactly as it was, so pressing Resend looked like nothing happened.
      setSuccess('')
      setError(t(otpErrorKey(err, 'otp_request_failed')))
    }
  }, [cooldown, t, isDev])

  /**
   * Sending on arrival is a one-shot, and only a ref can say so.
   *
   * requestOtp closes over cooldown, so it gets a new identity every time the
   * countdown ticks to zero - and an effect keyed on it fired again each time,
   * past the guard, forever. That is not just SMS spend: every new code
   * invalidates the one the owner is still typing.
   */
  const requestedOnMount = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design; depending on requestOtp is the bug
  useEffect(() => {
    if (requestedOnMount.current) return
    requestedOnMount.current = true
    void requestOtp()
    // Mount only. requestOtp is deliberately not a dependency.
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    const newOtp = [...otp]
    for (let i = 0; i < OTP_LENGTH; i++) {
      newOtp[i] = pasted[i] || ''
    }
    setOtp(newOtp)
    const nextEmpty = newOtp.findIndex((d) => !d)
    const focusIndex = nextEmpty === -1 ? OTP_LENGTH - 1 : nextEmpty
    inputRefs.current[focusIndex]?.focus()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = otp.join('')
    if (code.length !== OTP_LENGTH) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await apiFetch('/api/v1/phone/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      navigate({ to: '/dashboard' })
    } catch (err) {
      // "Wrong code" and "you have used all five guesses, ask for a new code"
      // are different instructions. Both used to read as the former, so a
      // caller who had run out kept retyping a code that could not be accepted.
      setError(t(otpErrorKey(err, 'otp_invalid')))
    } finally {
      setLoading(false)
    }
  }

  const maskedPhone = user?.phone ? maskPhone(user.phone) : '+62***'

  return (
    <div className="flex items-center justify-center bg-surface-bright px-4">
      <div className="w-full max-w-md">
        {/* Reached from the account menu and from a prompt on any page, so the
            step back is whatever the user was doing before. */}
        <BackButton />

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/15">
            <ShieldCheck className="h-8 w-8 text-brand-text" />
          </div>
          <h1 className="text-2xl font-semibold text-brand-text">{t('verify_phone_title')}</h1>
          <p className="mt-2 text-sm text-on-surface-muted">{t('verify_phone_description')}</p>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-sm font-medium text-on-surface-muted">
            <Phone className="h-4 w-4" />
            <span>{maskedPhone}</span>
          </div>
        </div>

        <div className="rounded-xl border border-outline-dim/20 bg-surface-bright p-8 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg bg-success-500/10 p-3 text-sm text-success-600">
              {success}
            </div>
          )}

          {isDev && devOtp && (
            <div className="mb-4 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3 text-sm text-warning-600">
              DEV OTP: <span className="font-mono font-bold">{devOtp}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <fieldset
                className="flex justify-center gap-3 border-none p-0 m-0"
                onPaste={handlePaste}
                aria-label={t('otp_fieldset_label')}
              >
                {['otp-1', 'otp-2', 'otp-3', 'otp-4', 'otp-5', 'otp-6'].map((digitId, i) => (
                  <label key={digitId} htmlFor={digitId} className="relative">
                    <span className="sr-only">{t('otp_digit', { n: i + 1 })}</span>
                    <input
                      id={digitId}
                      ref={(el) => {
                        inputRefs.current[i] = el
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={otp[i]}
                      onChange={(e) => handleChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      className="h-12 w-12 rounded-lg border border-outline-dim/30 text-center text-lg font-semibold text-brand-text focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/20"
                    />
                  </label>
                ))}
              </fieldset>
            </div>

            <button
              type="submit"
              disabled={loading || otp.join('').length !== OTP_LENGTH}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {loading ? '...' : t('verify_phone_title')}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={requestOtp}
              disabled={cooldown > 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:text-brand-text disabled:text-on-surface-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {cooldown > 0
                ? t('resend_in', {
                    seconds: cooldown,
                  })
                : t('resend_otp')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
