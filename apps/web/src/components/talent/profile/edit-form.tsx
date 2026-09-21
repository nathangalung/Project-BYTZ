import type { TFunction } from 'i18next'
import { Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useCreateTalentProfile, useUpdateMyName } from '@/hooks/use-talent'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import {
  buildProfilePayload,
  draftFromProfile,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
  type ProfileDraft,
  type TalentProfile,
  validateProfileDraft,
} from './shared'

const INPUT =
  'w-full rounded-lg border border-outline-dim/20 bg-surface px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-subtle focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30'

const CARD = 'rounded-xl border border-outline-dim/20 bg-surface-bright p-6'

/**
 * One edit mode for the whole profile rather than a toggle per card.
 *
 * The read view is what the page shows by default and is untouched; this
 * replaces it wholesale while editing, which keeps the save a single upsert
 * and avoids four independent drafts that could disagree with each other.
 */
export function ProfileEditForm({
  profile,
  userId,
  userName,
  t,
  onClose,
}: {
  profile: TalentProfile
  userId: string
  userName: string
  t: TFunction
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile, userName))
  const [error, setError] = useState('')
  const addToast = useToastStore((s) => s.addToast)
  const saveProfile = useCreateTalentProfile()
  const saveName = useUpdateMyName()

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function handleSave() {
    const failed = validateProfileDraft(draft)
    if (failed) {
      setError(t(failed))
      return
    }
    setError('')

    try {
      const name = draft.name.trim()
      if (name !== userName) {
        await saveName.mutateAsync(name)
        const current = useAuthStore.getState().user
        if (current) useAuthStore.getState().setUser({ ...current, name })
      }
      await saveProfile.mutateAsync(buildProfilePayload(userId, draft))
      addToast('success', t('profile_updated'))
      onClose()
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('profile_update_failed'))
    }
  }

  const saving = saveProfile.isPending || saveName.isPending

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <h2 className="text-base font-semibold text-brand-text">{t('personal_info')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            id="edit-name"
            label={t('full_name')}
            value={draft.name}
            onChange={(v) => set('name', v)}
          />
          <TextField
            id="edit-experience"
            label={t('experience')}
            value={draft.yearsOfExperience}
            onChange={(v) => set('yearsOfExperience', v)}
            inputMode="numeric"
          />
          <TextField
            id="edit-location"
            label={t('location')}
            value={draft.location}
            onChange={(v) => set('location', v)}
            placeholder={t('location_placeholder')}
          />
          <TextField
            id="edit-university"
            label={t('university')}
            value={draft.educationUniversity}
            onChange={(v) => set('educationUniversity', v)}
          />
          <TextField
            id="edit-major"
            label={t('major')}
            value={draft.educationMajor}
            onChange={(v) => set('educationMajor', v)}
          />
          <TextField
            id="edit-education-year"
            label={t('education_year')}
            value={draft.educationYear}
            onChange={(v) => set('educationYear', v)}
            placeholder={t('education_year_placeholder')}
            inputMode="numeric"
          />
        </div>
        <div className="mt-4">
          <FieldLabel htmlFor="edit-bio">{t('bio')}</FieldLabel>
          <textarea
            id="edit-bio"
            rows={3}
            value={draft.bio}
            onChange={(e) => set('bio', e.target.value)}
            placeholder={t('bio_placeholder')}
            className={`${INPUT} resize-none`}
          />
        </div>
      </div>

      <SkillsEditor skills={draft.skills} onChange={(skills) => set('skills', skills)} t={t} />

      <PortfolioEditor
        links={draft.portfolioLinks}
        onChange={(links) => set('portfolioLinks', links)}
        t={t}
      />

      <DomainEditor
        domains={draft.domainExpertise}
        onChange={(domains) => set('domainExpertise', domains)}
        t={t}
      />

      {error && (
        <p role="alert" className="text-sm text-error-600">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-container"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-on-surface-muted"
    >
      {children}
    </label>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputMode?: 'numeric'
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </div>
  )
}

function SkillsEditor({
  skills,
  onChange,
  t,
}: {
  skills: ProfileDraft['skills']
  onChange: (skills: ProfileDraft['skills']) => void
  t: TFunction
}) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState<ProficiencyLevel>('intermediate')

  // The taxonomy resolves case-insensitively and the write de-duplicates, so a
  // repeat would survive the save as one row while showing as two here.
  function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    if (skills.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return
    onChange([
      ...skills,
      { name: trimmed, category: 'other', proficiencyLevel: level, isPrimary: false },
    ])
  }

  return (
    <div className={CARD}>
      <h2 className="text-base font-semibold text-brand-text">{t('skills')}</h2>
      <ul className="mt-4 space-y-2">
        {skills.map((skill, index) => (
          <li
            key={skill.name}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-dim/20 p-3"
          >
            <span className="text-sm font-medium text-brand-text">{skill.name}</span>
            <select
              aria-label={`${t('proficiency')} ${skill.name}`}
              value={skill.proficiencyLevel}
              onChange={(e) =>
                onChange(
                  skills.map((s, i) =>
                    i === index
                      ? { ...s, proficiencyLevel: e.target.value as ProficiencyLevel }
                      : s,
                  ),
                )
              }
              className="rounded-lg border border-outline-dim/20 bg-surface px-2 py-1 text-xs text-brand-text"
            >
              {PROFICIENCY_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {t(`level_${value}`)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-on-surface-muted">
              <input
                type="checkbox"
                checked={skill.isPrimary}
                onChange={(e) =>
                  onChange(
                    skills.map((s, i) => (i === index ? { ...s, isPrimary: e.target.checked } : s)),
                  )
                }
              />
              {t('primary_skill')}
            </label>
            <button
              type="button"
              aria-label={`${t('remove_skill')} ${skill.name}`}
              onClick={() => onChange(skills.filter((_, i) => i !== index))}
              className="ml-auto text-on-surface-muted hover:text-error-600"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label={t('add_skill')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('skill_placeholder')}
          className={`${INPUT} sm:w-48`}
        />
        <select
          aria-label={t('proficiency')}
          value={level}
          onChange={(e) => setLevel(e.target.value as ProficiencyLevel)}
          className="rounded-lg border border-outline-dim/20 bg-surface px-3 py-2 text-sm text-brand-text"
        >
          {PROFICIENCY_LEVELS.map((value) => (
            <option key={value} value={value}>
              {t(`level_${value}`)}
            </option>
          ))}
        </select>
        <AddButton onClick={add} label={t('add_skill')} />
      </div>
    </div>
  )
}

function PortfolioEditor({
  links,
  onChange,
  t,
}: {
  links: ProfileDraft['portfolioLinks']
  onChange: (links: ProfileDraft['portfolioLinks']) => void
  t: TFunction
}) {
  const [platform, setPlatform] = useState('')
  const [url, setUrl] = useState('')

  function add() {
    if (!platform.trim() || !url.trim()) return
    onChange([...links, { platform: platform.trim(), url: url.trim() }])
    setPlatform('')
    setUrl('')
  }

  return (
    <div className={CARD}>
      <h2 className="text-base font-semibold text-brand-text">{t('portfolio_links')}</h2>
      <ul className="mt-4 space-y-2">
        {links.map((link, index) => (
          <li
            key={link.url}
            className="flex items-center gap-3 rounded-lg border border-outline-dim/20 p-3"
          >
            <span className="text-sm font-medium text-brand-text">{link.platform}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-on-surface-muted">
              {link.url}
            </span>
            <button
              type="button"
              aria-label={`${t('remove_link')} ${link.platform}`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
              className="text-on-surface-muted hover:text-error-600"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label={t('platform')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          placeholder={t('select_platform')}
          className={`${INPUT} sm:w-40`}
        />
        <input
          aria-label={t('url')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('enter_url')}
          className={`${INPUT} sm:w-64`}
        />
        <AddButton onClick={add} label={t('add_link')} />
      </div>
    </div>
  )
}

function DomainEditor({
  domains,
  onChange,
  t,
}: {
  domains: string[]
  onChange: (domains: string[]) => void
  t: TFunction
}) {
  const [value, setValue] = useState('')

  function add() {
    const trimmed = value.trim()
    if (!trimmed) return
    onChange([...domains, trimmed])
    setValue('')
  }

  return (
    <div className={CARD}>
      <h2 className="text-base font-semibold text-brand-text">{t('domain_expertise')}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {domains.map((domain, index) => (
          <li
            key={domain}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-sm text-on-surface-muted"
          >
            {domain}
            <button
              type="button"
              aria-label={`${t('remove_domain')} ${domain}`}
              onClick={() => onChange(domains.filter((_, i) => i !== index))}
              className="hover:text-error-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label={t('add_domain')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('domain_placeholder')}
          className={`${INPUT} sm:w-64`}
        />
        <AddButton onClick={add} label={t('add_domain')} />
      </div>
    </div>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-outline-dim/20 px-3 py-2 text-sm font-medium text-brand-text hover:bg-surface-container"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  )
}
