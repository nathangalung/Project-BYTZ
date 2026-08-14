// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { PathBForm } from './path-b-form'
import type { BriefFormData } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

function brief(overrides: Partial<BriefFormData> = {}): BriefFormData {
  return {
    title: '',
    industry: '',
    problem: '',
    targetUsers: '',
    mainFeatures: '',
    budgetRange: '',
    deadlineRange: '',
    platforms: [],
    ...overrides,
  }
}

function renderForm(props: Partial<Parameters<typeof PathBForm>[0]> = {}) {
  return render(
    <PathBForm
      briefForm={brief()}
      briefErrors={{}}
      updateBriefField={vi.fn()}
      togglePlatform={vi.fn()}
      handleBriefSubmit={vi.fn()}
      handleBackToChooser={vi.fn()}
      {...props}
    />,
  )
}

describe('PathBForm', () => {
  it('says up front that the AI writes the BRD from these answers', () => {
    renderForm()

    expect(screen.getByText('AI akan membuat BRD berdasarkan informasi ini')).toBeDefined()
  })

  it('labels every field so it is reachable by name', () => {
    renderForm()

    for (const label of [
      /Nama \/ Judul Proyek/,
      /Industri/,
      /Masalah Bisnis/,
      /Target Pengguna/,
      /Fitur Utama/,
      /Estimasi Budget/,
      /Target Deadline/,
    ]) {
      expect(screen.getByLabelText(label)).toBeDefined()
    }
  })

  it.each([
    ['title', /Nama \/ Judul Proyek/],
    ['industry', /Industri/],
    ['problem', /Masalah Bisnis/],
    ['targetUsers', /Target Pengguna/],
    ['mainFeatures', /Fitur Utama/],
  ] as const)('reports what was typed into %s', async (field, label) => {
    const user = userEvent.setup()
    const updateBriefField = vi.fn()
    renderForm({ updateBriefField })

    await user.type(screen.getByLabelText(label), 'A')

    expect(updateBriefField).toHaveBeenCalledExactlyOnceWith(field, 'A')
  })

  it('renders the values it was given', () => {
    renderForm({
      briefForm: brief({ title: 'Marketplace UMKM', problem: 'Sulit menjangkau pasar' }),
    })

    expect((screen.getByLabelText(/Nama \/ Judul Proyek/) as HTMLInputElement).value).toBe(
      'Marketplace UMKM',
    )
    expect((screen.getByLabelText(/Masalah Bisnis/) as HTMLTextAreaElement).value).toBe(
      'Sulit menjangkau pasar',
    )
  })

  describe('the range selects', () => {
    /**
     * "Not decided" and "flexible" are the empty value rather than options of
     * their own, so an owner who has not decided is not forced to invent a
     * bracket - and the list never shows the same choice twice.
     */
    it('offers the undecided budget once, as the empty value', () => {
      renderForm()

      const options = Array.from(
        (screen.getByLabelText(/Estimasi Budget/) as HTMLSelectElement).options,
      )
      expect(options[0].value).toBe('')
      expect(options.filter((o) => o.value === 'budget_not_decided')).toHaveLength(0)
    })

    it('offers the flexible deadline once, as the empty value', () => {
      renderForm()

      const options = Array.from(
        (screen.getByLabelText(/Target Deadline/) as HTMLSelectElement).options,
      )
      expect(options[0].value).toBe('')
      expect(options.filter((o) => o.value === 'deadline_flexible')).toHaveLength(0)
    })

    it.each([
      ['budgetRange', /Estimasi Budget/, 'budget_20_50m'],
      ['deadlineRange', /Target Deadline/, 'deadline_2_4_months'],
    ] as const)('reports the %s that was chosen', async (field, label, value) => {
      const user = userEvent.setup()
      const updateBriefField = vi.fn()
      renderForm({ updateBriefField })

      await user.selectOptions(screen.getByLabelText(label), value)

      expect(updateBriefField).toHaveBeenCalledExactlyOnceWith(field, value)
    })
  })

  describe('the platform checkboxes', () => {
    it('offers the five platforms as a multiple choice', () => {
      renderForm()

      expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    })

    it('checks the ones already chosen', () => {
      renderForm({ briefForm: brief({ platforms: ['Web App', 'Desktop'] }) })

      expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2)
      expect((screen.getByLabelText('Web App') as HTMLInputElement).checked).toBe(true)
    })

    /**
     * Toggling reports the platform rather than the next state, so the caller
     * owns the list and adding is symmetric with removing.
     */
    it('reports the platform that was toggled on', async () => {
      const user = userEvent.setup()
      const togglePlatform = vi.fn()
      renderForm({ togglePlatform })

      await user.click(screen.getByLabelText('Mobile (iOS)'))

      expect(togglePlatform).toHaveBeenCalledExactlyOnceWith('Mobile (iOS)')
    })

    it('reports the platform that was toggled off', async () => {
      const user = userEvent.setup()
      const togglePlatform = vi.fn()
      renderForm({ briefForm: brief({ platforms: ['Desktop'] }), togglePlatform })

      await user.click(screen.getByLabelText('Desktop'))

      expect(togglePlatform).toHaveBeenCalledExactlyOnceWith('Desktop')
    })
  })

  it('hands the brief to the AI when the generate control is pressed', async () => {
    const user = userEvent.setup()
    const handleBriefSubmit = vi.fn()
    renderForm({ handleBriefSubmit })

    await user.click(screen.getByRole('button', { name: /BRD/ }))

    expect(handleBriefSubmit).toHaveBeenCalledTimes(1)
  })

  it('leaves the path chooser reachable', async () => {
    const user = userEvent.setup()
    const handleBackToChooser = vi.fn()
    const { container } = renderForm({ handleBackToChooser })

    await user.click(container.querySelectorAll('button')[0])

    expect(handleBackToChooser).toHaveBeenCalledTimes(1)
  })

  describe('the validation messages', () => {
    it.each([
      ['title', /Nama \/ Judul Proyek/],
      ['problem', /Masalah Bisnis/],
      ['targetUsers', /Target Pengguna/],
      ['mainFeatures', /Fitur Utama/],
    ] as const)('marks the %s field and shows its message', (field, label) => {
      renderForm({ briefErrors: { [field]: 'Wajib diisi' } })

      expect(screen.getByText('Wajib diisi')).toBeDefined()
      expect(screen.getByLabelText(label).className).toContain('border-error-500')
    })

    it('shows nothing when the brief is clean', () => {
      const { container } = renderForm()

      expect(container.querySelector('p.text-error-500')).toBeNull()
    })

    /**
     * The four required answers are marked. Industry, budget, deadline and
     * platforms are optional, so the AI can scope from what the owner knows.
     */
    it('marks exactly the four required answers', () => {
      const { container } = renderForm()

      expect(container.querySelectorAll('label .text-error-500')).toHaveLength(4)
    })
  })
})
