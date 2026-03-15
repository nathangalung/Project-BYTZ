import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Briefcase,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Plus,
  Send,
  Star,
  Trash2,
  Upload,
  User,
  Wrench,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateWorkerProfile, useUploadPresignedUrl } from '@/hooks/use-workers'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/worker/register')({
  component: WorkerRegisterPage,
})

const TOTAL_STEPS = 4

const SKILL_CATEGORIES = [
  {
    key: 'frontend',
    skills: ['React', 'Vue.js', 'Angular', 'Next.js', 'TypeScript', 'Tailwind CSS', 'HTML/CSS'],
  },
  {
    key: 'backend',
    skills: ['Node.js', 'Python', 'Go', 'Java', 'PHP', 'Ruby', 'Rust', 'Hono', 'Express'],
  },
  {
    key: 'mobile',
    skills: ['React Native', 'Flutter', 'Swift', 'Kotlin', 'Expo'],
  },
  {
    key: 'design',
    skills: ['Figma', 'Adobe XD', 'Sketch', 'Photoshop', 'Illustrator'],
  },
  {
    key: 'data',
    skills: ['Python', 'TensorFlow', 'PyTorch', 'SQL', 'Pandas', 'Scikit-learn'],
  },
  {
    key: 'devops',
    skills: ['Docker', 'Kubernetes', 'AWS', 'GCP', 'CI/CD', 'Terraform', 'Linux'],
  },
] as const

const PROFICIENCY_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const

const PORTFOLIO_PLATFORMS = ['GitHub', 'Dribbble', 'Behance', 'LinkedIn', 'Website'] as const

type SelectedSkill = {
  name: string
  category: string
  proficiency: (typeof PROFICIENCY_LEVELS)[number]
  isPrimary: boolean
}

type PortfolioLink = {
  id: string
  platform: string
  url: string
}

function WorkerRegisterPage() {
  const { t } = useTranslation('worker')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const createProfile = useCreateWorkerProfile()
  const uploadPresigned = useUploadPresignedUrl()

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Step 1: Personal Info
  const [bio, setBio] = useState('')
  const [yearsOfExperience, setYearsOfExperience] = useState('')
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [graduationYear, setGraduationYear] = useState('')

  // Step 2: Skills
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('frontend')

  // Step 3: Portfolio
  const [portfolioLinks, setPortfolioLinks] = useState<PortfolioLink[]>([
    { id: crypto.randomUUID(), platform: '', url: '' },
  ])
  const [cvFile, setCvFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canNext = (): boolean => {
    switch (step) {
      case 1:
        return bio.trim().length > 0 && yearsOfExperience !== ''
      case 2:
        return selectedSkills.length > 0
      case 3:
        return true
      case 4:
        return true
      default:
        return false
    }
  }

  const handleToggleSkill = (skillName: string, category: string) => {
    setSelectedSkills((prev) => {
      const exists = prev.find((s) => s.name === skillName)
      if (exists) {
        return prev.filter((s) => s.name !== skillName)
      }
      return [
        ...prev,
        {
          name: skillName,
          category,
          proficiency: 'intermediate',
          isPrimary: false,
        },
      ]
    })
  }

  const handleSkillProficiency = (
    skillName: string,
    proficiency: (typeof PROFICIENCY_LEVELS)[number],
  ) => {
    setSelectedSkills((prev) => prev.map((s) => (s.name === skillName ? { ...s, proficiency } : s)))
  }

  const handleTogglePrimary = (skillName: string) => {
    setSelectedSkills((prev) =>
      prev.map((s) => (s.name === skillName ? { ...s, isPrimary: !s.isPrimary } : s)),
    )
  }

  const handleAddLink = () => {
    setPortfolioLinks((prev) => [...prev, { id: crypto.randomUUID(), platform: '', url: '' }])
  }

  const handleRemoveLink = (index: number) => {
    setPortfolioLinks((prev) => prev.filter((_, i) => i !== index))
  }

  const handleLinkChange = (index: number, field: keyof PortfolioLink, value: string) => {
    setPortfolioLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, [field]: value } : link)),
    )
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      setError(t('cv_formats', 'Format: PDF, DOCX, PPTX (maks 5MB)'))
      return
    }
    setCvFile(file)
    setError('')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const maxSize = 5 * 1024 * 1024
    if (file.size > maxSize) {
      setError(t('cv_formats', 'Format: PDF, DOCX, PPTX (maks 5MB)'))
      return
    }
    setCvFile(file)
    setError('')
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    const validLinks = portfolioLinks.filter((l) => l.platform && l.url)

    try {
      let cvFileUrl: string | undefined

      if (cvFile) {
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
        cvFileUrl = presigned.key
      }

      await createProfile.mutateAsync({
        userId: user?.id,
        bio,
        yearsOfExperience: Number(yearsOfExperience),
        educationUniversity: university || undefined,
        educationMajor: major || undefined,
        educationYear: graduationYear ? Number(graduationYear) : undefined,
        skills: selectedSkills.map((s) => ({
          name: s.name,
          proficiencyLevel: s.proficiency,
          isPrimary: s.isPrimary,
        })),
        portfolioLinks: validLinks,
        domainExpertise: [],
        cvFileUrl,
      })

      navigate({ to: '/worker' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit profile')
    } finally {
      setLoading(false)
    }
  }

  const stepIcons = [
    <User key="user" className="h-5 w-5" />,
    <Wrench key="wrench" className="h-5 w-5" />,
    <Briefcase key="briefcase" className="h-5 w-5" />,
    <CheckCircle key="check" className="h-5 w-5" />,
  ]

  const stepLabels = [
    t('personal_info', 'Info Pribadi'),
    t('skills', 'Keahlian'),
    t('portfolio', 'Portfolio'),
    t('review', 'Review'),
  ]

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-center text-2xl font-semibold text-neutral-800">
          {t('register_title', 'Lengkapi Profil Worker')}
        </h1>
        <p className="mb-8 text-center text-sm text-neutral-500">
          {t('step_of', 'Langkah {{current}} dari {{total}}', {
            current: step,
            total: TOTAL_STEPS,
          })}
        </p>

        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
            const stepNum = i + 1
            const isActive = stepNum === step
            const isCompleted = stepNum < step
            return (
              <div key={`step-${String(stepNum)}`} className="flex items-center gap-2">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    isActive
                      ? 'border-accent-teal-500 bg-accent-teal-500 text-white'
                      : isCompleted
                        ? 'border-success-500 bg-success-500 text-white'
                        : 'border-neutral-300 bg-white text-neutral-400'
                  }`}
                >
                  {stepIcons[i]}
                </div>
                <span
                  className={`hidden text-xs font-medium sm:block ${
                    isActive
                      ? 'text-accent-teal-600'
                      : isCompleted
                        ? 'text-success-600'
                        : 'text-neutral-400'
                  }`}
                >
                  {stepLabels[i]}
                </span>
                {i < TOTAL_STEPS - 1 && (
                  <div
                    className={`h-0.5 w-8 ${isCompleted ? 'bg-success-500' : 'bg-neutral-200'}`}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          {error && (
            <div className="mb-4 rounded-lg bg-error-500/10 p-3 text-sm text-error-600">
              {error}
            </div>
          )}

          {/* Step 1: Personal Info */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="bio" className="mb-1 block text-sm font-medium text-neutral-700">
                  {t('bio', 'Bio')}
                </label>
                <textarea
                  id="bio"
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('bio_placeholder', 'Ceritakan tentang diri Anda...')}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="experience"
                  className="mb-1 block text-sm font-medium text-neutral-700"
                >
                  {t('experience', 'Pengalaman (tahun)')}
                </label>
                <input
                  id="experience"
                  type="number"
                  min={0}
                  max={50}
                  value={yearsOfExperience}
                  onChange={(e) => setYearsOfExperience(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>

              <div>
                <span className="mb-3 flex items-center gap-1.5 text-sm font-medium text-neutral-700">
                  <GraduationCap className="h-4 w-4" />
                  {t('education', 'Pendidikan')}
                </span>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="university" className="mb-1 block text-xs text-neutral-500">
                      {t('university', 'Universitas')}
                    </label>
                    <input
                      id="university"
                      type="text"
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="major" className="mb-1 block text-xs text-neutral-500">
                        {t('major', 'Jurusan')}
                      </label>
                      <input
                        id="major"
                        type="text"
                        value={major}
                        onChange={(e) => setMajor(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </div>
                    <div>
                      <label htmlFor="grad-year" className="mb-1 block text-xs text-neutral-500">
                        {t('graduation_year', 'Tahun Lulus')}
                      </label>
                      <input
                        id="grad-year"
                        type="number"
                        min={1970}
                        max={2030}
                        value={graduationYear}
                        onChange={(e) => setGraduationYear(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Skills */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-sm font-medium text-neutral-700">
                  {t('select_skills', 'Pilih Keahlian')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SKILL_CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setActiveCategory(cat.key)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        activeCategory === cat.key
                          ? 'bg-accent-teal-500 text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {t(`category_${cat.key}`, cat.key)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {SKILL_CATEGORIES.find((c) => c.key === activeCategory)?.skills.map((skill) => {
                  const isSelected = selectedSkills.some((s) => s.name === skill)
                  return (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => handleToggleSkill(skill, activeCategory)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        isSelected
                          ? 'border-accent-teal-500 bg-accent-teal-500/10 text-accent-teal-600'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
                      }`}
                    >
                      {skill}
                    </button>
                  )
                })}
              </div>

              {selectedSkills.length > 0 && (
                <div className="space-y-3 border-t border-neutral-200 pt-4">
                  <p className="text-sm font-medium text-neutral-700">
                    {t('proficiency', 'Tingkat Kemahiran')}
                  </p>
                  {selectedSkills.map((skill) => (
                    <div
                      key={skill.name}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3"
                    >
                      <span className="min-w-[100px] text-sm font-medium text-neutral-800">
                        {skill.name}
                      </span>
                      <select
                        value={skill.proficiency}
                        onChange={(e) =>
                          handleSkillProficiency(
                            skill.name,
                            e.target.value as (typeof PROFICIENCY_LEVELS)[number],
                          )
                        }
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none"
                      >
                        {PROFICIENCY_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {t(`level_${level}`, level)}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <input
                          type="checkbox"
                          checked={skill.isPrimary}
                          onChange={() => handleTogglePrimary(skill.name)}
                          className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                        <Star className="h-3 w-3" />
                        {t('primary_skill', 'Skill Utama')}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Portfolio */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-sm font-medium text-neutral-700">
                  {t('portfolio_links', 'Link Portfolio')}
                </p>
                <div className="space-y-3">
                  {portfolioLinks.map((link, i) => (
                    <div key={link.id} className="flex items-start gap-2">
                      <select
                        value={link.platform}
                        onChange={(e) => handleLinkChange(i, 'platform', e.target.value)}
                        className="w-32 shrink-0 rounded-lg border border-neutral-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none"
                      >
                        <option value="">{t('select_platform', 'Pilih platform')}</option>
                        {PORTFOLIO_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        type="url"
                        value={link.url}
                        onChange={(e) => handleLinkChange(i, 'url', e.target.value)}
                        placeholder={t('enter_url', 'Masukkan URL')}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                      {portfolioLinks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLink(i)}
                          className="shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-error-500"
                          title={t('remove_link', 'Hapus Link')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddLink}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    <Plus className="h-4 w-4" />
                    {t('add_link', 'Tambah Link')}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-neutral-700">
                  {t('upload_cv', 'Upload CV')}
                </p>
                <button
                  type="button"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full cursor-pointer rounded-lg border-2 border-dashed border-neutral-300 p-8 text-center transition-colors hover:border-primary-400 hover:bg-primary-50/30"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.pptx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {cvFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="h-6 w-6 text-primary-500" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-neutral-800">{cvFile.name}</p>
                        <p className="text-xs text-neutral-400">
                          {(cvFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="mx-auto h-8 w-8 text-neutral-400" />
                      <p className="mt-2 text-sm text-neutral-500">
                        {t('drag_drop', 'Drag & drop file atau klik untuk upload')}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {t('cv_formats', 'Format: PDF, DOCX, PPTX (maks 5MB)')}
                      </p>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="rounded-lg bg-neutral-50 p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                  <User className="h-4 w-4" />
                  {t('personal_info', 'Info Pribadi')}
                </h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex">
                    <dt className="w-32 text-neutral-500">{t('bio', 'Bio')}</dt>
                    <dd className="text-neutral-800">{bio || '-'}</dd>
                  </div>
                  <div className="flex">
                    <dt className="w-32 text-neutral-500">
                      {t('experience', 'Pengalaman (tahun)')}
                    </dt>
                    <dd className="text-neutral-800">{yearsOfExperience || '-'}</dd>
                  </div>
                  <div className="flex">
                    <dt className="w-32 text-neutral-500">{t('university', 'Universitas')}</dt>
                    <dd className="text-neutral-800">{university || '-'}</dd>
                  </div>
                  <div className="flex">
                    <dt className="w-32 text-neutral-500">{t('major', 'Jurusan')}</dt>
                    <dd className="text-neutral-800">{major || '-'}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg bg-neutral-50 p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                  <Wrench className="h-4 w-4" />
                  {t('skills', 'Keahlian')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((skill) => (
                    <span
                      key={skill.name}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                        skill.isPrimary
                          ? 'bg-accent-teal-500/10 text-accent-teal-600'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {skill.isPrimary && <Star className="h-3 w-3" />}
                      {skill.name}
                      <span className="text-neutral-400">
                        ({t(`level_${skill.proficiency}`, skill.proficiency)})
                      </span>
                    </span>
                  ))}
                  {selectedSkills.length === 0 && (
                    <span className="text-sm text-neutral-400">-</span>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-neutral-50 p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                  <Briefcase className="h-4 w-4" />
                  {t('portfolio', 'Portfolio')}
                </h3>
                <div className="space-y-1 text-sm">
                  {portfolioLinks.filter((l) => l.platform && l.url).length > 0 ? (
                    portfolioLinks
                      .filter((l) => l.platform && l.url)
                      .map((link) => (
                        <div key={link.id} className="flex gap-2">
                          <span className="font-medium text-neutral-600">{link.platform}:</span>
                          <span className="truncate text-primary-600">{link.url}</span>
                        </div>
                      ))
                  ) : (
                    <span className="text-neutral-400">-</span>
                  )}
                </div>
                {cvFile && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-primary-500" />
                    <span className="text-neutral-800">{cvFile.name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-6 flex items-center justify-between">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {tCommon('previous', 'Sebelumnya')}
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS ? (
              <button
                type="button"
                disabled={!canNext()}
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-teal-600 disabled:opacity-50"
              >
                {tCommon('next', 'Selanjutnya')}
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={handleSubmit}
                className="inline-flex items-center gap-1 rounded-lg bg-accent-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-teal-600 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {loading ? '...' : t('submit_profile', 'Kirim Profil')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
