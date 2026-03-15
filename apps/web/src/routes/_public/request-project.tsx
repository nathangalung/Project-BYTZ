import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  FileText,
  Globe,
  Lock,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_public/request-project')({
  component: RequestProjectPage,
})

const CATEGORIES = [
  { value: 'web_app', label: 'Web App' },
  { value: 'mobile_app', label: 'Mobile App' },
  { value: 'ui_ux_design', label: 'UI/UX Design' },
  { value: 'data_ai', label: 'Data / AI' },
  { value: 'other_digital', label: 'Digital Lainnya' },
]

const STEPS = [
  { key: 'basic', icon: FileText, label: 'Informasi Dasar' },
  { key: 'budget', icon: Wallet, label: 'Budget & Timeline' },
  { key: 'prefs', icon: Settings, label: 'Preferensi' },
  { key: 'review', icon: ClipboardList, label: 'Review' },
]

const INPUT =
  'w-full rounded-lg border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-success-500/50 focus:outline-none focus:ring-2 focus:ring-success-500/20'

function RequestProjectPage() {
  const { t } = useTranslation('project')
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()
  const [step, setStep] = useState(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [timeline, setTimeline] = useState('')
  const [almamater, setAlmamater] = useState('')
  const [minExp, setMinExp] = useState('')
  const [visibility, setVisibility] = useState('public_summary')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')

  const addSkill = () => {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills([...skills, s])
    setSkillInput('')
  }

  const formatRp = (v: string) => {
    const n = Number(v.replace(/\D/g, ''))
    return n ? `Rp ${n.toLocaleString('id-ID')}` : ''
  }

  const handleSubmit = () => {
    if (isAuthenticated) {
      navigate({ to: '/projects/new' })
    } else {
      setShowLoginPrompt(true)
    }
  }

  return (
    <div className="min-h-screen bg-primary-600">
      {/* Header */}
      <header className="border-b border-white/5 bg-primary-600/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-bold text-warning-500">
            BYTZ
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/browse-projects" className="text-sm text-neutral-400 hover:text-warning-500">
              Proyek
            </Link>
            <button
              type="button"
              onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
              className="flex items-center gap-1 text-sm text-neutral-500 hover:text-warning-500"
            >
              <Globe className="h-4 w-4" />
              {i18n.language === 'id' ? 'EN' : 'ID'}
            </button>
            <Link to="/login" className="text-sm text-neutral-400 hover:text-warning-500">
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-success-500 px-4 py-2 text-sm font-medium text-primary-900"
            >
              Daftar
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-warning-500">
          {t('request_project_title', 'Ajukan Proyek')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Isi formulir di bawah untuk memulai. Anda bisa mengisi semua langkah terlebih dahulu.
        </p>

        {/* Step indicator */}
        <div className="mt-8 flex items-center justify-between">
          {STEPS.map((s, idx) => {
            const Icon = s.icon
            const done = idx < step
            const active = idx === step
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => setStep(idx)}
                  className="flex flex-col items-center"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${done ? 'border-success-500 bg-success-500 text-primary-900' : active ? 'border-warning-500 bg-warning-500/10 text-warning-500' : 'border-neutral-600 text-neutral-500'}`}
                  >
                    {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span
                    className={`mt-2 text-xs font-medium ${done ? 'text-success-500' : active ? 'text-warning-500' : 'text-neutral-500'}`}
                  >
                    {s.label}
                  </span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 ${idx < step ? 'bg-success-500' : 'bg-neutral-700'}`}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Form card */}
        <div className="mt-8 rounded-xl border border-white/5 bg-neutral-600/30 p-6">
          {/* Step 1: Basic Info */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-warning-500">Informasi Dasar</h2>
              <div>
                <label
                  htmlFor="rp-title"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Judul Proyek *
                </label>
                <input
                  id="rp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Platform E-commerce untuk UMKM Kopi"
                  className={INPUT}
                />
              </div>
              <div>
                <label
                  htmlFor="rp-category"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Kategori *
                </label>
                <select
                  id="rp-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`${INPUT} ${!category ? 'text-neutral-500' : ''}`}
                >
                  <option value="" disabled>
                    Pilih kategori
                  </option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="rp-desc"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Deskripsi Proyek *
                </label>
                <textarea
                  id="rp-desc"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Jelaskan fitur yang dibutuhkan, target user, referensi aplikasi sejenis..."
                  className={`${INPUT} resize-none`}
                />
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium text-neutral-300">
                  Visibilitas Proyek *
                </span>
                <div className="space-y-2">
                  {[
                    {
                      value: 'public_full',
                      label: 'Publik — Tampilkan detail lengkap',
                      desc: 'Semua orang bisa melihat judul, deskripsi, dan budget proyek Anda',
                    },
                    {
                      value: 'public_summary',
                      label: 'Publik — Tampilkan ringkasan saja',
                      desc: 'Hanya judul dan kategori yang terlihat, detail hanya untuk worker yang di-match',
                    },
                    {
                      value: 'private',
                      label: 'Privat — Hanya BYTZ dan worker terpilih',
                      desc: 'Proyek tidak terlihat di listing publik, hanya worker yang di-match platform',
                    },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      htmlFor={`vis-${opt.value}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${visibility === opt.value ? 'border-success-500/50 bg-success-500/5' : 'border-white/5 hover:border-white/10'}`}
                    >
                      <input
                        id={`vis-${opt.value}`}
                        type="radio"
                        name="visibility"
                        value={opt.value}
                        checked={visibility === opt.value}
                        onChange={(e) => setVisibility(e.target.value)}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-neutral-200">{opt.label}</p>
                        <p className="text-xs text-neutral-500">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Budget & Timeline */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-warning-500">Budget & Timeline</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="rp-bmin"
                    className="mb-1.5 block text-sm font-medium text-neutral-300"
                  >
                    Budget Minimum *
                  </label>
                  <input
                    id="rp-bmin"
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(e.target.value.replace(/\D/g, ''))}
                    placeholder="10000000"
                    className={INPUT}
                  />
                  {budgetMin && (
                    <p className="mt-1 text-xs text-neutral-500">{formatRp(budgetMin)}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="rp-bmax"
                    className="mb-1.5 block text-sm font-medium text-neutral-300"
                  >
                    Budget Maksimum *
                  </label>
                  <input
                    id="rp-bmax"
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value.replace(/\D/g, ''))}
                    placeholder="50000000"
                    className={INPUT}
                  />
                  {budgetMax && (
                    <p className="mt-1 text-xs text-neutral-500">{formatRp(budgetMax)}</p>
                  )}
                </div>
              </div>
              <div>
                <label
                  htmlFor="rp-timeline"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Estimasi Timeline (hari) *
                </label>
                <input
                  id="rp-timeline"
                  type="number"
                  min="1"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  placeholder="60"
                  className={INPUT}
                />
              </div>

              {/* What happens next */}
              <div className="rounded-lg border border-white/5 bg-primary-700/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-warning-500">
                  <Sparkles className="h-4 w-4" /> Apa yang terjadi setelah ini?
                </div>
                <ul className="mt-3 space-y-2 text-xs text-neutral-400">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                    AI chatbot akan menggali detail kebutuhan proyek Anda
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                    BRD (Business Requirement Document) di-generate otomatis
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-500" />
                    Anda bisa beli BRD saja, atau lanjut ke development
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 3: Preferences */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-warning-500">Preferensi Worker</h2>
                <p className="mt-1 text-xs text-neutral-500">Semua opsional</p>
              </div>
              <div>
                <label
                  htmlFor="rp-skills"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Skill yang Dibutuhkan
                </label>
                <div className="flex gap-2">
                  <input
                    id="rp-skills"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())}
                    placeholder="React, Node.js..."
                    className={`flex-1 ${INPUT}`}
                  />
                  <button
                    type="button"
                    onClick={addSkill}
                    disabled={!skillInput.trim()}
                    className="rounded-lg bg-primary-700 px-4 text-neutral-300 hover:bg-primary-800 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                {skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skills.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-0.5 text-xs font-medium text-success-500"
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => setSkills(skills.filter((x) => x !== s))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="rp-alma"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Almamater
                </label>
                <input
                  id="rp-alma"
                  value={almamater}
                  onChange={(e) => setAlmamater(e.target.value)}
                  placeholder="ITB, UI, UGM..."
                  className={INPUT}
                />
              </div>
              <div>
                <label
                  htmlFor="rp-exp"
                  className="mb-1.5 block text-sm font-medium text-neutral-300"
                >
                  Pengalaman Minimum (tahun)
                </label>
                <input
                  id="rp-exp"
                  type="number"
                  min="0"
                  value={minExp}
                  onChange={(e) => setMinExp(e.target.value)}
                  placeholder="0"
                  className={INPUT}
                />
              </div>

              {/* Escrow info */}
              <div className="rounded-lg border border-success-500/20 bg-success-500/5 p-4">
                <p className="text-sm font-medium text-success-500">Dana Aman di Escrow</p>
                <p className="mt-1 text-xs text-neutral-400">
                  Pembayaran Anda aman di escrow platform. Dana hanya dicairkan ke worker setelah
                  milestone disetujui. Auto-release setelah 14 hari jika tidak ada respons.
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-warning-500">Review Proyek Anda</h2>
              <div className="space-y-4">
                <ReviewRow label="Judul" value={title || '-'} />
                <ReviewRow
                  label="Kategori"
                  value={CATEGORIES.find((c) => c.value === category)?.label || '-'}
                />
                <ReviewRow label="Deskripsi" value={description || '-'} multiline />
                <ReviewRow
                  label="Visibilitas"
                  value={
                    visibility === 'private'
                      ? 'Privat'
                      : visibility === 'public_summary'
                        ? 'Publik (ringkasan)'
                        : 'Publik (lengkap)'
                  }
                />
                <ReviewRow
                  label="Budget"
                  value={
                    budgetMin && budgetMax ? `${formatRp(budgetMin)} - ${formatRp(budgetMax)}` : '-'
                  }
                />
                <ReviewRow label="Timeline" value={timeline ? `${timeline} hari` : '-'} />
                {skills.length > 0 && (
                  <div className="flex gap-3">
                    <span className="w-32 shrink-0 text-xs text-neutral-500">Skills</span>
                    <div className="flex flex-wrap gap-1">
                      {skills.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-success-500/15 px-2 py-0.5 text-xs text-success-500"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {almamater && <ReviewRow label="Almamater" value={almamater} />}
                {minExp && <ReviewRow label="Min Pengalaman" value={`${minExp} tahun`} />}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-600/30"
            >
              <ArrowLeft className="h-4 w-4" /> Kembali
            </button>
          ) : (
            <Link
              to="/"
              className="flex items-center gap-1 text-sm text-neutral-500 hover:text-warning-500"
            >
              <ArrowLeft className="h-4 w-4" /> Beranda
            </Link>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-1 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-900 hover:bg-success-600"
            >
              Lanjut <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="flex items-center gap-1 rounded-lg bg-success-500 px-5 py-2.5 text-sm font-semibold text-primary-900 hover:bg-success-600"
            >
              <Check className="h-4 w-4" /> Kirim Proyek
            </button>
          )}
        </div>

        {/* Login prompt modal */}
        {showLoginPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-900/70 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-neutral-600 p-8 text-center">
              <Lock className="mx-auto h-10 w-10 text-success-500" />
              <h3 className="mt-4 text-xl font-semibold text-warning-500">
                Buat Akun untuk Mengirim
              </h3>
              <p className="mt-2 text-sm text-neutral-400">
                Data proyek Anda sudah tersimpan. Daftar atau masuk untuk mengirim proyek dan mulai
                proses AI scoping.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Link
                  to="/register"
                  className="rounded-lg bg-success-500 px-6 py-2.5 text-sm font-semibold text-primary-900 hover:bg-success-600"
                >
                  Daftar Sekarang
                </Link>
                <Link
                  to="/login"
                  className="rounded-lg border border-white/10 px-6 py-2.5 text-sm font-medium text-neutral-300 hover:bg-primary-700"
                >
                  Sudah Punya Akun
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginPrompt(false)}
                className="mt-4 text-xs text-neutral-500 hover:text-neutral-300"
              >
                Kembali ke formulir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewRow({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div className={`flex gap-3 ${multiline ? 'flex-col' : 'items-start'}`}>
      <span className="w-32 shrink-0 text-xs text-neutral-500">{label}</span>
      <span className={`text-sm text-neutral-200 ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value}
      </span>
    </div>
  )
}
