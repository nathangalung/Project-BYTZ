import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type FormData, INPUT_BASE, INPUT_NORMAL, VISIBILITY_OPTIONS } from './shared'

export function Step3Preferences({
  form,
  updateField,
  skillInput,
  setSkillInput,
  addSkill,
  removeSkill,
  t,
}: {
  form: FormData
  updateField: (field: keyof FormData, value: string | string[]) => void
  skillInput: string
  setSkillInput: (v: string) => void
  addSkill: (skill: string) => void
  removeSkill: (skill: string) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-brand-text">{t('preferences')}</h2>
        <p className="mt-1 text-sm text-on-surface-muted">{t('preferences_optional')}</p>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('visibility')}
        </legend>
        <div className="space-y-2">
          {VISIBILITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                value={opt.value}
                checked={form.visibility === opt.value}
                onChange={() => updateField('visibility', opt.value)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-on-surface">{t(opt.labelKey)}</span>
                <span className="block text-xs text-on-surface-muted">{t(opt.descKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="almamater" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('almamater')}
        </label>
        <input
          id="almamater"
          type="text"
          value={form.almamater}
          onChange={(e) => updateField('almamater', e.target.value)}
          placeholder={t('almamater_placeholder')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label htmlFor="minExperience" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('min_experience')}
        </label>
        <input
          id="minExperience"
          type="number"
          min="0"
          value={form.minExperience}
          onChange={(e) => updateField('minExperience', e.target.value)}
          placeholder={t('min_experience_placeholder')}
          className={cn(INPUT_BASE, INPUT_NORMAL)}
        />
      </div>

      <div>
        <label htmlFor="skillInput" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('required_skills')}
        </label>
        <div className="flex gap-2">
          <input
            id="skillInput"
            type="text"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSkill(skillInput)
              }
            }}
            placeholder={t('required_skills_placeholder')}
            className={cn(INPUT_BASE, INPUT_NORMAL, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => addSkill(skillInput)}
            disabled={!skillInput.trim()}
            className="rounded-lg bg-surface-container px-4 py-2.5 text-sm font-semibold text-on-surface-muted transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40"
          >
            +
          </button>
        </div>
        {form.requiredSkills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {form.requiredSkills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-full bg-brand-accent/10 px-3 py-1 text-xs font-medium text-brand-text"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-brand-accent/10"
                  aria-label={`Remove ${skill}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Step 4: Review ── */
