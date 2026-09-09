import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateTalentProfile, useUploadPresignedUrl } from '@/hooks/use-talent'
import { apiUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/talent/register')({
  component: TalentRegisterPage,
})

const INPUT =
  'w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-subtle transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30'

// Bucket to representative years.
const EXPERIENCE_YEARS: Record<string, number> = { '0-1': 1, '1-3': 2, '3-5': 4, '5+': 6 }

// Years to the select's band.
function experienceBand(years: number): string {
  if (years > 5) return '5+'
  if (years > 3) return '3-5'
  if (years > 1) return '1-3'
  return '0-1'
}

// Graduation year out of a free-form end date.
function graduationYear(end: unknown): string {
  const match = typeof end === 'string' ? end.match(/(?:19|20)\d{2}/) : null
  return match ? match[0] : ''
}

/**
 * What the CV parse produced, which is not the same question as whether it ran.
 *
 * Step 1 used to state "the data below is extracted from your CV" over an empty
 * form whenever parsing failed, because the caller checked `res.ok` and then
 * swallowed everything else. The three outcomes need different sentences: an
 * unreadable CV is the talent's to fix, an unavailable parser is ours, and a
 * form that filled itself needs neither.
 */
type ParseOutcome = 'filled' | 'empty' | 'unavailable'

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
  const [educationYear, setEducationYear] = useState('')
  const [skills, setSkills] = useState('')
  const [links, setLinks] = useState(['', '', ''])

  // What the parse actually produced, which the step 1 banner reports.
  const [parseOutcome, setParseOutcome] = useState<ParseOutcome>('unavailable')
  const [parsedKey, setParsedKey] = useState<{ key: string; token: string } | null>(null)

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

  /**
   * Fill the form from a parsed CV.
   *
   * Returns whether anything was actually filled, which is what separates a CV
   * the parser could not read from one it read successfully.
   */
  const applyParsedCv = (p: Record<string, unknown>): boolean => {
    let filled = false
    const take = <T,>(value: T | undefined | null, apply: (v: T) => void) => {
      if (value === undefined || value === null || value === '') return
      apply(value)
      filled = true
    }

    const education = Array.isArray(p.education) ? (p.education[0] as Record<string, string>) : null
    const experience = Array.isArray(p.experience)
      ? (p.experience[0] as Record<string, string>)
      : null

    take(p.name as string, setFullName)
    take(p.summary as string, setBio)
    take(Array.isArray(p.skills) && p.skills.length ? p.skills.join(', ') : '', setSkills)
    if (education) {
      take(education.university, setUniversity)
      take(education.major, setMajor)
      take(graduationYear(education.end), setEducationYear)
    }
    if (experience) take(experience.position, setRole)
    // The parser reports total years. Counting jobs answered a different
    // question: one ten-year role scored 0-1, four short stints scored 3-5.
    // Left blank when unknown rather than guessed from the job count.
    if (typeof p.years_of_experience === 'number') {
      setYearsOfExperience(experienceBand(p.years_of_experience))
      filled = true
    }

    // Profile URLs the parser found anywhere, then project repos.
    const urls: string[] = [
      ...(Array.isArray(p.portfolio_urls) ? (p.portfolio_urls as string[]) : []),
      ...(Array.isArray(p.projects)
        ? (p.projects as Record<string, string>[]).map((pr) => pr.url)
        : []),
    ].filter((url): url is string => typeof url === 'string' && url.length > 0)
    const unique = [...new Set(urls)].slice(0, 3)
    if (unique.length > 0) {
      setLinks([...unique, '', '', ''].slice(0, 3))
      filled = true
    }

    return filled
  }

  /**
   * Parse an already uploaded CV.
   *
   * Separate from the upload so retrying a parser outage does not re-send the
   * file, and so the outcome is recorded rather than discarded.
   */
  const parseUploadedCv = async (source: { key: string; token: string }, fileName: string) => {
    setParsing(true)
    try {
      const res = await fetch(apiUrl('/api/v1/upload/parse-cv'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          key: source.key,
          token: source.token,
          fileType: fileName.split('.').pop(),
        }),
      })
      if (!res.ok) {
        setParseOutcome('unavailable')
        return
      }
      const data = await res.json()
      const parsed = (data.data?.parsed_data ?? data.parsed_data ?? {}) as Record<string, unknown>
      setParseOutcome(applyParsedCv(parsed) ? 'filled' : 'empty')
    } catch {
      // A parser that cannot be reached is our problem, not a bad CV, and the
      // banner has to say which. Registration continues either way.
      setParseOutcome('unavailable')
    } finally {
      setParsing(false)
    }
  }

  // Upload CV, parse it, move to step 1.
  const handleUploadAndParse = async () => {
    // The continue button stays shut until a file is chosen.
    /* v8 ignore next */
    if (!cvFile) return
    setParsing(true)
    setError('')

    try {
      const presigned = await uploadPresigned.mutateAsync({
        fileName: cvFile.name,
        fileType: cvFile.type,
        folder: 'cv',
        fileSize: cvFile.size,
      })
      await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': presigned.contentType },
        body: cvFile,
      })
      setCvFileUrl(presigned.key)
      const source = { key: presigned.key, token: presigned.token }
      setParsedKey(source)

      await parseUploadedCv(source, cvFile.name)
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload_failed'))
    } finally {
      setParsing(false)
    }
  }

  const handleRetryParse = async () => {
    // Retry is only offered after an upload that stored both.
    /* v8 ignore next */
    if (!parsedKey || !cvFile) return
    await parseUploadedCv(parsedKey, cvFile.name)
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
    // Unreachable: the submit button is disabled while skills is empty, so this
    // message has never been shown. Kept because the gate is the thing that is
    // wrong, not the message.
    /* v8 ignore next 4 */
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
        yearsOfExperience: EXPERIENCE_YEARS[yearsOfExperience],
        location: location || undefined,
        educationUniversity: university || undefined,
        educationMajor: major || undefined,
        educationYear: educationYear ? Number(educationYear) : undefined,
        skills: skillList.map((name) => ({
          name,
          proficiencyLevel: 'intermediate',
          isPrimary: false,
        })),
        portfolioLinks: validLinks,
        domainExpertise: [],
        cvFileUrl,
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
          <span className="text-sm font-bold text-brand-text">
            {t('step_of', { current: step + 1, total: 3 })}
          </span>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-all ${i <= step ? 'bg-brand-muted' : 'bg-outline-dim'}`}
              />
            ))}
          </div>
        </div>

        {/* Step 0: Upload CV */}
        {step === 0 && (
          <div className="animate-fade-in">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-accent/10">
                <Upload className="h-8 w-8 text-brand-accent" />
              </div>
              <h2 className="text-2xl font-extrabold text-brand-text">{t('upload_cv_title')}</h2>
              <p className="mt-2 text-sm text-on-surface-muted">{t('upload_cv_description')}</p>
            </div>

            <div className="mb-5 rounded-3xl border border-outline-dim/20 bg-surface-bright p-7">
              <h4 className="mb-4 flex items-center gap-2 font-bold text-brand-text">
                <FileText className="h-4 w-4" /> {t('cv_resume')}
              </h4>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="mb-3 w-full cursor-pointer rounded-2xl border-2 border-dashed border-outline-dim/40 p-10 text-center transition-colors hover:border-brand-accent/40"
              >
                <Upload className="mx-auto h-12 w-12 text-on-surface-subtle" />
                <p className="mt-3 font-bold text-on-surface">
                  {cvFile ? cvFile.name : t('drag_or_click')}
                </p>
                <p className="mt-1 text-xs text-on-surface-muted">{t('cv_max_size')}</p>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx"
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
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
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-cream-500/30 dark:bg-accent-cream-500/10">
                <CheckCircle className="h-8 w-8 text-accent-cream-600" />
              </div>
              <h2 className="text-2xl font-extrabold text-brand-text">{t('verify_title')}</h2>
              <p className="mt-2 text-sm text-on-surface-muted">
                {parseOutcome === 'filled'
                  ? t('verify_description')
                  : t('verify_description_blank')}
              </p>
            </div>

            <ParseOutcomeBanner
              outcome={parseOutcome}
              onRetry={handleRetryParse}
              retrying={parsing}
              t={t}
            />

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
                <Field
                  label={t('education_year')}
                  value={educationYear}
                  onChange={setEducationYear}
                  placeholder={t('education_year_placeholder')}
                />
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
                      <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-subtle" />
                      <input
                        type="url"
                        value={links[i]}
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
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
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
            <h2 className="mb-3 text-2xl font-extrabold text-brand-text">{t('profile_created')}</h2>
            <p className="mx-auto mb-8 max-w-md text-on-surface-muted">
              {t('profile_active_message')}
            </p>
            <div className="mx-auto mb-8 grid max-w-sm grid-cols-3 gap-4">
              <div className="rounded-2xl bg-surface-container p-4 text-center">
                <FileText className="mx-auto mb-1 h-6 w-6 text-brand-accent" />
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
              className="mx-auto block w-full max-w-sm rounded-2xl bg-brand py-4 font-bold text-white transition-all hover:opacity-90"
            >
              {t('go_to_dashboard')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * What the parse produced, stated rather than assumed.
 *
 * Only the filled case may claim the form came from the CV. An unreadable CV
 * offers no retry because retrying reads the same bytes; an unreachable parser
 * does, because the next attempt may well work.
 */
function ParseOutcomeBanner({
  outcome,
  onRetry,
  retrying,
  t,
}: {
  outcome: ParseOutcome
  onRetry: () => void
  retrying: boolean
  t: TFunction
}) {
  if (outcome === 'filled') {
    return (
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-accent-cream-600/30 bg-accent-cream-500/10 p-4">
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-cream-600" />
        <div>
          <p className="text-sm font-bold text-on-surface">{t('cv_extraction_result')}</p>
          <p className="mt-0.5 text-xs text-on-surface-muted">{t('cv_extraction_hint')}</p>
        </div>
      </div>
    )
  }

  const unavailable = outcome === 'unavailable'

  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-2xl border border-error-600/30 bg-error-500/10 p-4"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error-600" />
      <div className="flex-1">
        <p className="text-sm font-bold text-on-surface">
          {unavailable ? t('cv_parse_unavailable') : t('cv_parse_empty')}
        </p>
        <p className="mt-0.5 text-xs text-on-surface-muted">
          {unavailable ? t('cv_parse_unavailable_hint') : t('cv_parse_empty_hint')}
        </p>
        {unavailable && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/30 px-3 py-1.5 text-xs font-bold text-brand-text transition-colors hover:bg-surface-container disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
            {t('cv_parse_retry')}
          </button>
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
        className="w-full rounded-xl border border-outline-dim/30 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-subtle transition-all focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
      />
    </div>
  )
}
