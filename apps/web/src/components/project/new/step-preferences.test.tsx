// @vitest-environment jsdom
import { ProjectVisibility } from '@kerjacus/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import type { FormData } from './shared'
import { Step3Preferences } from './step-preferences'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const t = i18n.getFixedT('id', 'project')

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: '',
    description: '',
    category: 'web_app',
    budgetMin: '',
    budgetMax: '',
    estimatedTimelineDays: '',
    deadline: '',
    almamater: '',
    minExperience: '',
    requiredSkills: [],
    visibility: ProjectVisibility.PUBLIC_SUMMARY,
    documentFileKey: '',
    documentType: '',
    ...overrides,
  }
}

function renderStep(props: Partial<Parameters<typeof Step3Preferences>[0]> = {}) {
  return render(
    <Step3Preferences
      form={form()}
      updateField={vi.fn()}
      skillInput=""
      setSkillInput={vi.fn()}
      addSkill={vi.fn()}
      removeSkill={vi.fn()}
      t={t}
      {...props}
    />,
  )
}

describe('Step3Preferences', () => {
  it('says up front that the whole step can be skipped', () => {
    renderStep()

    expect(screen.getByText(/Bagian ini opsional/)).toBeDefined()
  })

  describe('the visibility choice', () => {
    /**
     * The three options are radios in one named group, so a screen reader
     * announces them as one choice of three rather than as three unrelated
     * checkboxes - and exactly one is selected at a time.
     */
    it('offers the three visibility levels as one group', () => {
      renderStep()

      const radios = screen.getAllByRole('radio')
      expect(radios).toHaveLength(3)
      expect(radios.every((r) => r.getAttribute('name') === 'visibility')).toBe(true)
    })

    it('preselects the level the form holds', () => {
      renderStep({ form: form({ visibility: ProjectVisibility.PRIVATE }) })

      expect((screen.getByLabelText(/Privat/) as HTMLInputElement).checked).toBe(true)
      expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
    })

    it('reports the level that was chosen', async () => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      await user.click(screen.getByLabelText(/Publik \(Detail\)/))

      expect(updateField).toHaveBeenCalledExactlyOnceWith(
        'visibility',
        ProjectVisibility.PUBLIC_DETAIL,
      )
    })

    it('explains what each level means rather than just naming it', () => {
      renderStep()

      expect(screen.getByText(/Semua orang bisa melihat detail proyek/)).toBeDefined()
    })
  })

  it('reports the almamater preference', async () => {
    const user = userEvent.setup()
    const updateField = vi.fn()
    renderStep({ updateField })

    await user.type(screen.getByLabelText(/Preferensi Almamater/), 'I')

    expect(updateField).toHaveBeenCalledExactlyOnceWith('almamater', 'I')
  })

  it('refuses a negative minimum experience at the field level', () => {
    renderStep()

    const input = screen.getByLabelText(/Pengalaman Minimum/) as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.min).toBe('0')
  })

  describe('the skill entry', () => {
    it('reports each keystroke to the caller', async () => {
      const user = userEvent.setup()
      const setSkillInput = vi.fn()
      renderStep({ setSkillInput })

      await user.type(screen.getByLabelText(/Keahlian yang Dibutuhkan/), 'R')

      expect(setSkillInput).toHaveBeenCalledExactlyOnceWith('R')
    })

    /**
     * Enter is the documented way to add a skill, and it has to be swallowed:
     * the field sits inside the wizard form, so a bare Enter would submit the
     * step instead of adding the tag.
     */
    it('adds the skill on Enter without submitting the step', async () => {
      const user = userEvent.setup()
      const addSkill = vi.fn()
      const onSubmit = vi.fn((e: React.FormEvent) => {
        e.preventDefault()
      })
      render(
        <form onSubmit={onSubmit}>
          <Step3Preferences
            form={form()}
            updateField={vi.fn()}
            skillInput="React"
            setSkillInput={vi.fn()}
            addSkill={addSkill}
            removeSkill={vi.fn()}
            t={t}
          />
        </form>,
      )

      await user.type(screen.getByLabelText(/Keahlian yang Dibutuhkan/), '{Enter}')

      expect(addSkill).toHaveBeenCalledExactlyOnceWith('React')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('adds the skill from the add button too', async () => {
      const user = userEvent.setup()
      const addSkill = vi.fn()
      renderStep({ skillInput: 'Go', addSkill })

      await user.click(screen.getByRole('button', { name: '+' }))

      expect(addSkill).toHaveBeenCalledExactlyOnceWith('Go')
    })

    it('refuses to add an empty skill', async () => {
      const user = userEvent.setup()
      const addSkill = vi.fn()
      renderStep({ skillInput: '   ', addSkill })

      const button = screen.getByRole('button', { name: '+' })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      await user.click(button)

      expect(addSkill).not.toHaveBeenCalled()
    })

    it('shows nothing where the tags go until there is one', () => {
      renderStep({ form: form({ requiredSkills: [] }) })

      expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    })

    it('lists the chosen skills as tags', () => {
      renderStep({ form: form({ requiredSkills: ['React', 'Go'] }) })

      expect(screen.getByText('React')).toBeDefined()
      expect(screen.getByText('Go')).toBeDefined()
    })

    /**
     * The remove control is an icon-only button inside the tag, so its
     * accessible name has to say which skill it drops - five buttons all
     * called "remove" are indistinguishable to a screen reader.
     */
    it('names each remove control after the skill it drops', async () => {
      const user = userEvent.setup()
      const removeSkill = vi.fn()
      renderStep({ form: form({ requiredSkills: ['React', 'Go'] }), removeSkill })

      await user.click(screen.getByRole('button', { name: 'Remove Go' }))

      expect(removeSkill).toHaveBeenCalledExactlyOnceWith('Go')
    })
  })
})
