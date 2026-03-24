import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  FileText,
  Lock,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const INPUT =
  'w-full rounded-lg border border-outline-dim/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface placeholder:text-outline focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30'

function RequestProjectPage() {
  const { t } = useTranslation('project')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const { isAuthenticated } = useAuthStore()
  const [step, setStep] = useState(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)

  const STEPS = [
    { key: 'basic', icon: FileText, label: t('basic_info', 'Informasi Dasar') },
    { key: 'budget', icon: Wallet, label: t('budget_timeline', 'Budget & Timeline') },
    { key: 'prefs', icon: Settings, label: t('preferences', 'Preferensi') },
    { key: 'review', icon: ClipboardList, label: t('review_submit', 'Review') },
  ]

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

  const canProceed = (s: number): boolean => {
    if (s === 0) return !!(title && category && description)
    if (s === 1) {
      const min = Number(String(budgetMin).replace(/\D/g, '')) || 0
      const max = Number(String(budgetMax).replace(/\D/g, '')) || 0
      return !!(min && max && timeline && min <= max)
    }
    return true
  }

  const goNext = () => {
    if (step < 3 && canProceed(step)) setStep(step + 1)
  }

  const saveFormToStorage = () => {
    const data = {
      title,
      category,
      description,
      budgetMin,
      budgetMax,
      timeline,
      almamater,
      minExp,
      visibility,
      skills,
    }
    localStorage.setItem('kerjacus-draft-project', JSON.stringify(data))
  }

  const handleSubmit = () => {
    saveFormToStorage()
    if (isAuthenticated) {
      navigate({ to: '/projects/new' })
    } else {
      setShowLoginPrompt(true)
    }
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-primary-600">{t('new_project', 'Ajukan Proyek')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          {t('request_project_desc', 'Isi formulir di bawah untuk memulai.')}
        </p>

        {/* Step indicator */}
        <div className="mt-8 flex items-start">
          {STEPS.map((s, idx) => {
            const Icon = s.icon
            const done = idx < step
            const active = idx === step
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex w-full flex-col items-center text-center">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${done ? 'border-primary-600 bg-primary-600 text-white' : active ? 'border-primary-500 bg-primary-500/10 text-primary-600' : 'border-outline-dim/30 text-on-surface-muted'}`}
                  >
                    {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span
                    className={`mt-2 hidden text-xs font-medium sm:block ${done || active ? 'text-primary-600' : 'text-on-surface-muted'}`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`mt-5 h-0.5 w-full min-w-4 ${idx < step ? 'bg-primary-600' : 'bg-outline-dim/20'}`}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Form */}
        <div className="mt-8 rounded-xl border border-outline-dim/10 bg-surface-bright p-6">
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-primary-600">
                {t('basic_info', 'Informasi Dasar')}
              </h2>
              <div>
                <label
                  htmlFor="rp-title"
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('title', 'Judul Proyek')} *
                </label>
                <input
                  id="rp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('title_placeholder', 'Contoh: Platform E-commerce untuk UMKM')}
                  className={INPUT}
                />
              </div>
              <div>
                <label
                  htmlFor="rp-category"
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('category', 'Kategori')} *
                </label>
                <select
                  id="rp-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`${INPUT} ${!category ? 'text-on-surface-muted' : ''}`}
                >
                  <option value="" disabled>
                    {t('category_placeholder', 'Pilih kategori')}
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
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('description', 'Deskripsi Proyek')} *
                </label>
                <textarea
                  id="rp-desc"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t(
                    'description_placeholder',
                    'Jelaskan fitur yang dibutuhkan, target user, referensi aplikasi sejenis...',
                  )}
                  className={`${INPUT} resize-none`}
                />
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium text-on-surface-muted">
                  {t('visibility', 'Visibilitas Proyek')} *
                </span>
                <div className="space-y-2">
                  {[
                    {
                      value: 'public_full',
                      label: t('vis_public_full', 'Publik — Detail lengkap'),
                      desc: t(
                        'vis_public_full_desc',
                        'Semua orang bisa melihat judul, deskripsi, dan budget proyek',
                      ),
                    },
                    {
                      value: 'public_summary',
                      label: t('vis_public_summary', 'Publik — Ringkasan saja'),
                      desc: t(
                        'vis_public_summary_desc',
                        'Hanya judul dan kategori terlihat, detail hanya untuk talenta yang di-match',
                      ),
                    },
                    {
                      value: 'private',
                      label: t('vis_private', 'Privat'),
                      desc: t(
                        'vis_private_desc',
                        'Proyek tidak terlihat publik, hanya talenta yang di-match platform',
                      ),
                    },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      htmlFor={`vis-${opt.value}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${visibility === opt.value ? 'border-primary-500/50 bg-primary-500/5' : 'border-outline-dim/10 hover:border-outline-dim/20'}`}
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
                        <p className="text-sm font-medium text-on-surface">{opt.label}</p>
                        <p className="text-xs text-on-surface-muted">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-primary-600">
                {t('budget_timeline', 'Budget & Timeline')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="rp-bmin"
                    className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                  >
                    {t('budget_min', 'Budget Minimum')} *
                  </label>
                  <input
                    id="rp-bmin"
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('budget_min_placeholder', '10000000')}
                    className={INPUT}
                  />
                  {budgetMin && (
                    <p className="mt-1 text-xs text-on-surface-muted">{formatRp(budgetMin)}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="rp-bmax"
                    className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                  >
                    {t('budget_max', 'Budget Maksimum')} *
                  </label>
                  <input
                    id="rp-bmax"
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('budget_max_placeholder', '50000000')}
                    className={INPUT}
                  />
                  {budgetMax && (
                    <p className="mt-1 text-xs text-on-surface-muted">{formatRp(budgetMax)}</p>
                  )}
                </div>
              </div>
              <div>
                <label
                  htmlFor="rp-timeline"
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('timeline', 'Estimasi Timeline (hari)')} *
                </label>
                <input
                  id="rp-timeline"
                  type="number"
                  min="1"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  placeholder={t('timeline_placeholder', '60')}
                  className={INPUT}
                />
              </div>
              <div className="rounded-lg border border-outline-dim/10 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-primary-600">
                  <Sparkles className="h-4 w-4" />{' '}
                  {t('whats_next', 'Apa yang terjadi setelah ini?')}
                </div>
                <ul className="mt-3 space-y-2 text-xs text-on-surface-muted">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-600" />
                    {t('next_step_1', 'AI chatbot akan menggali detail kebutuhan proyek Anda')}
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-600" />
                    {t('next_step_2', 'BRD (Business Requirement Document) dibuat otomatis')}
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-success-600" />
                    {t('next_step_3', 'Anda bisa beli BRD saja, atau lanjut ke development')}
                  </li>
                </ul>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-primary-600">
                  {t('talent_preferences', 'Preferensi Talenta')}
                </h2>
                <p className="mt-1 text-xs text-on-surface-muted">
                  {t('preferences_optional', 'Semua opsional')}
                </p>
              </div>
              <div>
                <label
                  htmlFor="rp-skills"
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('required_skills', 'Skill yang Dibutuhkan')}
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
                    className="rounded-lg bg-surface-container px-4 text-on-surface-muted hover:bg-surface-high disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                {skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skills.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-medium text-primary-600"
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
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('almamater', 'Almamater')}
                </label>
                <input
                  id="rp-alma"
                  value={almamater}
                  onChange={(e) => setAlmamater(e.target.value)}
                  placeholder={t('almamater_placeholder', 'ITB, UI, UGM...')}
                  className={INPUT}
                />
              </div>
              <div>
                <label
                  htmlFor="rp-exp"
                  className="mb-1.5 block text-sm font-medium text-on-surface-muted"
                >
                  {t('min_experience', 'Pengalaman Minimum (tahun)')}
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
              <div className="rounded-lg border border-success-500/20 bg-success-500/5 p-4">
                <p className="text-sm font-medium text-success-600">
                  {t('escrow_safe', 'Dana Aman di Escrow')}
                </p>
                <p className="mt-1 text-xs text-on-surface-muted">
                  {t(
                    'escrow_safe_desc',
                    'Pembayaran Anda aman di escrow platform. Dana hanya dicairkan ke talenta setelah milestone disetujui.',
                  )}
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-primary-600">
                {t('review_submit', 'Review Proyek')}
              </h2>
              <div className="space-y-4">
                <ReviewRow label={t('title', 'Judul')} value={title || '-'} />
                <ReviewRow
                  label={t('category', 'Kategori')}
                  value={CATEGORIES.find((c) => c.value === category)?.label || '-'}
                />
                <ReviewRow
                  label={t('description', 'Deskripsi')}
                  value={description || '-'}
                  multiline
                />
                <ReviewRow
                  label={t('budget', 'Budget')}
                  value={
                    budgetMin && budgetMax ? `${formatRp(budgetMin)} - ${formatRp(budgetMax)}` : '-'
                  }
                />
                <ReviewRow
                  label="Timeline"
                  value={timeline ? `${timeline} ${t('days', 'hari')}` : '-'}
                />
                {skills.length > 0 && (
                  <div className="flex gap-3">
                    <span className="w-32 shrink-0 text-xs text-on-surface-muted">Skills</span>
                    <div className="flex flex-wrap gap-1">
                      {skills.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-primary-500/10 px-2 py-0.5 text-xs text-primary-600"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {almamater && <ReviewRow label={t('almamater', 'Almamater')} value={almamater} />}
                {minExp && (
                  <ReviewRow
                    label={t('min_experience', 'Min Pengalaman')}
                    value={`${minExp} ${t('years', 'tahun')}`}
                  />
                )}
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
              className="flex items-center gap-1 rounded-lg border border-outline-dim/20 px-4 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-bright"
            >
              <ArrowLeft className="h-4 w-4" /> {tc('back', 'Kembali')}
            </button>
          ) : (
            <Link
              to="/"
              className="flex items-center gap-1 text-sm text-on-surface-muted hover:text-primary-600"
            >
              <ArrowLeft className="h-4 w-4" /> {tc('home', 'Beranda')}
            </Link>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canProceed(step)}
              className="flex items-center gap-1 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {tc('next', 'Lanjut')} <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="flex items-center gap-1 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Check className="h-4 w-4" /> {t('submit', 'Kirim Proyek')}
            </button>
          )}
        </div>

        {/* Login prompt */}
        {showLoginPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary-800/70 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-md rounded-xl border border-outline-dim/20 bg-surface-bright p-8 text-center">
              <Lock className="mx-auto h-10 w-10 text-primary-500" />
              <h3 className="mt-4 text-xl font-semibold text-primary-600">
                {t('login_to_submit', 'Buat Akun untuk Mengirim')}
              </h3>
              <p className="mt-2 text-sm text-on-surface-muted">
                {t(
                  'login_to_submit_desc',
                  'Data proyek Anda sudah tersimpan. Daftar atau masuk untuk mengirim proyek.',
                )}
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Link
                  to="/register"
                  className="rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  {tc('register', 'Daftar Sekarang')}
                </Link>
                <Link
                  to="/login"
                  className="rounded-lg border border-outline-dim/20 px-6 py-2.5 text-sm font-medium text-on-surface-muted hover:bg-surface-high"
                >
                  {tc('login', 'Sudah Punya Akun')}
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginPrompt(false)}
                className="mt-4 text-xs text-on-surface-muted hover:text-on-surface"
              >
                {tc('back', 'Kembali')}
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
      <span className="w-32 shrink-0 text-xs text-on-surface-muted">{label}</span>
      <span className={`text-sm text-on-surface ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value}
      </span>
    </div>
  )
}
