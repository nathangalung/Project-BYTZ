import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  FileText,
  Link2,
  Loader2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateTalentProfile, useUploadPresignedUrl } from '@/hooks/use-talent'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/talent/register')({
  component: TalentRegisterPage,
})

const INPUT =
  'w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30'

function TalentRegisterPage() {
  const { t } = useTranslation('talent')
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const createProfile = useCreateTalentProfile()
  const uploadPresigned = useUploadPresignedUrl()

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [cvFileUrl, setCvFileUrl] = useState('')

  // CV
  const [cvFile, setCvFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Profile fields (auto-filled from CV, editable)
  const [fullName, setFullName] = useState(user?.name ?? '')
  const [bio, setBio] = useState('')
  const [role, setRole] = useState('')
  const [yearsOfExperience, setYearsOfExperience] = useState('')
  const [location, setLocation] = useState('')
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [skills, setSkills] = useState('')
  const [links, setLinks] = useState(['', '', ''])

  const handleFileChange = (file: File | null) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError(t('file_too_large'))
      return
    }
    setCvFile(file)
    setError('')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFileChange(e.dataTransfer.files[0] ?? null)
  }

  // Upload CV + parse + move to step 1
  const handleUploadAndParse = async () => {
    if (!cvFile) return
    setParsing(true)
    setError('')

    try {
      // Upload to storage
      const presigned = await uploadPresigned.mutateAsync({
        fileName: cvFile.name,
        fileType: cvFile.type,
        folder: 'cv',
      })
      await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': cvFile.type },
        body: cvFile,
      })
      setCvFileUrl(presigned.key)

      // Parse CV via AI service
      try {
        const res = await fetch('/api/v1/ai/parse-cv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            talent_id: user?.id,
            file_url: presigned.key,
            file_type: cvFile.name.split('.').pop(),
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const p = data.data?.parsed_data ?? data.parsed_data ?? {}
          // Auto-fill from parsed data
          if (p.name) setFullName(p.name)
          if (p.skills?.length) setSkills(p.skills.join(', '))
          if (p.education?.[0]) {
            setUniversity(p.education[0].universitas ?? p.education[0].university ?? '')
            setMajor(p.education[0].jurusan ?? p.education[0].major ?? '')
          }
          if (p.experience?.[0]) {
            setRole(p.experience[0].posisi ?? p.experience[0].position ?? '')
            const years = p.experience?.length ?? 0
            setYearsOfExperience(years > 5 ? '5+' : years > 3 ? '3-5' : years > 1 ? '1-3' : '0-1')
          }
          // Auto-fill portfolio links
          if (p.projects?.length) {
            const urls = p.projects.map((pr: Record<string, string>) => pr.url).filter(Boolean)
            if (urls.length > 0) setLinks([...urls.slice(0, 3), '', '', ''].slice(0, 3))
          }
        }
      } catch {
        // CV parsing is optional, continue to manual fill
      }

      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload_failed'))
    } finally {
      setParsing(false)
    }
  }

  const handleSubmit = async () => {
    if (!fullName.trim()) {
      setError(t('name_required'))
      return
    }
    if (!role.trim()) {
      setError(t('role_required'))
      return
    }
    if (!yearsOfExperience) {
      setError(t('experience_required'))
      return
    }
    if (!skills.trim()) {
      setError(t('skills_required'))
      return
    }
    setLoading(true)
    setError('')

    const validLinks = links.filter(Boolean).map((url) => ({
      platform: url.includes('github')
        ? 'GitHub'
        : url.includes('linkedin')
          ? 'LinkedIn'
          : url.includes('dribbble')
            ? 'Dribbble'
            : url.includes('behance')
              ? 'Behance'
              : 'Website',
      url,
    }))
    const skillList = skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    try {
      await createProfile.mutateAsync({
        userId: user?.id,
        bio,
        yearsOfExperience: Number(yearsOfExperience.replace(/\D/g, '')) || 0,
        educationUniversity: university || undefined,
        educationMajor: major || undefined,
        skills: skillList.map((name) => ({
          name,
          proficiencyLevel: 'intermediate',
          isPrimary: false,
        })),
        portfolioLinks: validLinks,
        domainExpertise: [],
        cvFileUrl: cvFileUrl || undefined,
      })
      // Mark profile as complete
      if (user?.id) localStorage.setItem('kerjacus-profile-complete', user.id)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile_submit_failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-start justify-center bg-surface-low px-4 py-10">
      <div className="w-full max-w-3xl">
        {/* Step dots */}
        <div className="mb-8 flex items-center justify-between">
          <span className="text-sm font-bold text-primary-600">
            {t('step_of', { current: step + 1, total: 3 })}
          </span>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-all ${i <= step ? 'bg-primary-500' : 'bg-outline-dim'}`}
              />
            ))}
          </div>
        </div>

        {/* Step 0: Upload CV */}
        {step === 0 && (
          <div className="animate-fade-in">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/10">
                <Upload className="h-8 w-8 text-primary-500" />
              </div>
              <h2 className="text-2xl font-extrabold text-primary-600">{t('upload_cv_title')}</h2>
              <p className="mt-2 text-sm text-on-surface-muted">{t('upload_cv_description')}</p>
            </div>

            <div className="mb-5 rounded-3xl border border-outline-dim/20 bg-surface-bright p-7">
              <h4 className="mb-4 flex items-center gap-2 font-bold text-primary-600">
                <FileText className="h-4 w-4" /> {t('cv_resume')}
              </h4>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="mb-3 w-full cursor-pointer rounded-2xl border-2 border-dashed border-outline-dim/40 p-10 text-center transition-colors hover:border-primary-500/40"
              >
                <Upload className="mx-auto h-12 w-12 text-outline" />
                <p className="mt-3 font-bold text-on-surface">
                  {cvFile ? cvFile.name : t('drag_or_click')}
                </p>
                <p className="mt-1 text-xs text-on-surface-muted">{t('cv_max_size')}</p>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              {cvFile && (
                <div className="flex items-center gap-3 rounded-xl border border-outline-dim/20 bg-surface-container p-3">
                  <FileText className="h-5 w-5 text-accent-coral-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-on-surface">{cvFile.name}</p>
                    <p className="text-xs text-on-surface-muted">
                      {(cvFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-success-600" />
                </div>
              )}
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleUploadAndParse}
              disabled={!cvFile || parsing}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-4 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
            >
              {parsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('processing_cv')}
                </>
              ) : (
                <>
                  {t('continue_verify')} <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 1: Verify + edit parsed data */}
        {step === 1 && (
          <div className="animate-fade-in">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-cream-500/30">
                <CheckCircle className="h-8 w-8 text-accent-cream-600" />
              </div>
              <h2 className="text-2xl font-extrabold text-primary-600">{t('verify_title')}</h2>
              <p className="mt-2 text-sm text-on-surface-muted">{t('verify_description')}</p>
            </div>

            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-accent-cream-600/30 bg-accent-cream-500/10 p-4">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-cream-600" />
              <div>
                <p className="text-sm font-bold text-on-surface">{t('cv_extraction_result')}</p>
                <p className="mt-0.5 text-xs text-on-surface-muted">{t('cv_extraction_hint')}</p>
              </div>
            </div>

            <div className="mb-5 space-y-4 rounded-3xl border border-outline-dim/20 bg-surface-bright p-7">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={`${t('full_name')} *`}
                  value={fullName}
                  onChange={setFullName}
                  placeholder={t('full_name')}
                />
                <Field
                  label={`${t('role_label')} *`}
                  value={role}
                  onChange={setRole}
                  placeholder={t('role_placeholder')}
                />
                <div>
                  <label
                    htmlFor="years-of-experience"
                    className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
                  >
                    {t('experience_label')}
                  </label>
                  <select
                    id="years-of-experience"
                    value={yearsOfExperience}
                    onChange={(e) => setYearsOfExperience(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">{t('experience_select')}</option>
                    <option value="0-1">{t('experience_entry')}</option>
                    <option value="1-3">{t('experience_junior')}</option>
                    <option value="3-5">{t('experience_mid')}</option>
                    <option value="5+">{t('experience_senior')}</option>
                  </select>
                </div>
                <Field
                  label={t('location')}
                  value={location}
                  onChange={setLocation}
                  placeholder={t('location_placeholder')}
                />
                <Field label={t('university')} value={university} onChange={setUniversity} />
                <Field label={t('major')} value={major} onChange={setMajor} />
              </div>
              <div>
                <label
                  htmlFor="detected-skills"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
                >
                  {t('detected_skills')} *
                </label>
                <input
                  id="detected-skills"
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder={t('skills_placeholder')}
                  className={INPUT}
                />
                <p className="mt-1 text-xs text-on-surface-muted">{t('skills_from_cv')}</p>
              </div>
              <div>
                <label
                  htmlFor="short-bio"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
                >
                  {t('short_bio')}
                </label>
                <textarea
                  id="short-bio"
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('bio_short_placeholder')}
                  className={`${INPUT} resize-none`}
                />
              </div>

              {/* Portfolio links from CV */}
              <div>
                <label
                  htmlFor="portfolio-links"
                  className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-on-surface-muted"
                >
                  <Link2 className="h-3.5 w-3.5" /> {t('portfolio_links')}
                </label>
                <div id="portfolio-links" className="space-y-3">
                  {(['github', 'linkedin', 'dribbble'] as const).map((slot, i) => (
                    <div key={slot} className="relative">
                      <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
                      <input
                        type="url"
                        value={links[i] ?? ''}
                        onChange={(e) => {
                          const next = [...links]
                          next[i] = e.target.value
                          setLinks(next)
                        }}
                        placeholder={
                          {
                            github: 'https://github.com/...',
                            linkedin: 'https://linkedin.com/in/...',
                            dribbble: 'https://dribbble.com/...',
                          }[slot]
                        }
                        className={`${INPUT} pl-10`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-error-500/20 bg-error-500/10 p-3 text-sm text-error-600">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="rounded-2xl border border-outline-dim/30 px-5 py-3 text-sm font-bold text-on-surface-muted transition-all hover:bg-surface-container"
              >
                <ChevronLeft className="mr-1 inline h-4 w-4" /> {t('back')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !bio.trim() || !skills.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {loading ? t('submitting') : t('data_correct')}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Success */}
        {step === 2 && (
          <div className="animate-fade-in text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success-500/10">
              <CheckCircle className="h-10 w-10 text-success-600" />
            </div>
            <h2 className="mb-3 text-2xl font-extrabold text-primary-600">
              {t('profile_created')}
            </h2>
            <p className="mx-auto mb-8 max-w-md text-on-surface-muted">
              {t('profile_active_message')}
            </p>
            <div className="mx-auto mb-8 grid max-w-sm grid-cols-3 gap-4">
              <div className="rounded-2xl bg-surface-container p-4 text-center">
                <FileText className="mx-auto mb-1 h-6 w-6 text-primary-500" />
                <p className="text-xs font-bold text-on-surface">{t('cv_active')}</p>
              </div>
              <div className="rounded-2xl bg-surface-container p-4 text-center">
                <Upload className="mx-auto mb-1 h-6 w-6 text-accent-coral-600" />
                <p className="text-xs font-bold text-on-surface">{t('ai_matching')}</p>
              </div>
              <div className="rounded-2xl bg-surface-container p-4 text-center">
                <CheckCircle className="mx-auto mb-1 h-6 w-6 text-success-600" />
                <p className="text-xs font-bold text-on-surface">{t('verified')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: '/talent' })}
              className="mx-auto block w-full max-w-sm rounded-2xl bg-primary-600 py-4 font-bold text-white transition-all hover:opacity-90"
            >
              {t('go_to_dashboard')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const fieldId = `field-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`
  return (
    <div>
      <label
        htmlFor={fieldId}
        className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-on-surface-muted"
      >
        {label}
      </label>
      <input
        id={fieldId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-outline transition-all focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
      />
    </div>
  )
}
