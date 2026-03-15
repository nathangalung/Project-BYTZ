import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/verify-phone')({
  component: VerifyPhonePage,
})

const OTP_LENGTH = 6
const COOLDOWN_SECONDS = 60

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
      const res = await fetch('/api/v1/phone/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(t('otp_sent', 'Kode OTP telah dikirim'))
        setError('')
        setCooldown(COOLDOWN_SECONDS)
        if (isDev && data.otp) {
          setDevOtp(data.otp)
        }
      }
    } catch {
      setError(t('otp_invalid', 'Kode OTP tidak valid atau sudah kadaluarsa'))
    }
  }, [cooldown, t])

  useEffect(() => {
    requestOtp()
  }, [requestOtp])

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
      const res = await fetch('/api/v1/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        setError(t('otp_invalid', 'Kode OTP tidak valid atau sudah kadaluarsa'))
        return
      }
      navigate({ to: '/dashboard' })
    } catch {
      setError(t('otp_invalid', 'Kode OTP tidak valid atau sudah kadaluarsa'))
    } finally {
      setLoading(false)
    }
  }

  const maskedPhone = user?.name ? maskPhone('+628123456789') : '+62***'

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100">
            <ShieldCheck className="h-8 w-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-800">
            {t('verify_phone_title', 'Verifikasi Nomor Telepon')}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {t('verify_phone_description', 'Masukkan kode OTP yang dikirim ke nomor telepon Anda')}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-sm font-medium text-neutral-700">
            <Phone className="h-4 w-4" />
            <span>{maskedPhone}</span>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
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
                aria-label="OTP code"
              >
                {['otp-1', 'otp-2', 'otp-3', 'otp-4', 'otp-5', 'otp-6'].map((digitId, i) => (
                  <label key={digitId} htmlFor={digitId} className="relative">
                    <span className="sr-only">{`OTP digit ${String(i + 1)}`}</span>
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
                      className="h-12 w-12 rounded-lg border border-neutral-300 text-center text-lg font-semibold text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </label>
                ))}
              </fieldset>
            </div>

            <button
              type="submit"
              disabled={loading || otp.join('').length !== OTP_LENGTH}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? '...' : t('verify_phone_title', 'Verifikasi Nomor Telepon')}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={requestOtp}
              disabled={cooldown > 0}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 disabled:text-neutral-400"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {cooldown > 0
                ? t('resend_in', 'Kirim ulang dalam {{seconds}} detik', {
                    seconds: cooldown,
                  })
                : t('resend_otp', 'Kirim Ulang OTP')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
