// @vitest-environment jsdom
import { ProjectVisibility } from '@kerjacus/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { useCreateProject } from '@/hooks/use-projects'
import i18n from '@/lib/i18n'
import { PathAForm } from './path-a-form'
import type { FormData } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

function form(overrides: Partial<FormData> = {}): FormData {
  return {
    title: 'Marketplace UMKM',
    description: 'Toko online untuk UMKM lokal',
    category: 'web_app',
    budgetMin: '10000000',
    budgetMax: '50000000',
    estimatedTimelineDays: '60',
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

function createProject(isPending = false) {
  return { isPending } as ReturnType<typeof useCreateProject>
}

function renderForm(props: Partial<Parameters<typeof PathAForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PathAForm
        currentStep={0}
        setCurrentStep={vi.fn()}
        form={form()}
        errors={{}}
        updateField={vi.fn()}
        skillInput=""
        setSkillInput={vi.fn()}
        addSkill={vi.fn()}
        removeSkill={vi.fn()}
        handleNext={vi.fn()}
        handleBack={vi.fn()}
        handleSubmit={vi.fn()}
        handleBackToChooser={vi.fn()}
        createProject={createProject()}
        projectType="individual"
        setProjectType={vi.fn()}
        companyName=""
        setCompanyName={vi.fn()}
        companyRole=""
        setCompanyRole={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('PathAForm', () => {
  /**
   * One step is mounted at a time. Rendering all four and hiding three would
   * put every field in the tab order and in the accessibility tree at once,
   * which is the opposite of what a wizard is for.
   */
  it.each([
    [0, /Judul Proyek/],
    [1, /Anggaran Minimum/],
    [2, /Preferensi Almamater/],
  ] as const)('mounts only step %i', async (currentStep, label) => {
    renderForm({ currentStep })

    expect(screen.getByLabelText(label)).toBeDefined()
    expect(screen.queryByLabelText(/Estimasi Timeline/)).toBe(
      currentStep === 1 ? screen.queryByLabelText(/Estimasi Timeline/) : null,
    )
  })

  it('shows the review summary on the last step', () => {
    renderForm({ currentStep: 3 })

    expect(screen.getByText('Marketplace UMKM')).toBeDefined()
    expect(screen.queryByLabelText(/Judul Proyek/)).toBeNull()
  })

  describe('the navigation', () => {
    /**
     * There is nowhere to go back to from the first step, so the control is
     * left out rather than rendered disabled - a disabled button still lands
     * in the reading order announcing an action that does not exist.
     */
    it('offers no back control on the first step', () => {
      renderForm({ currentStep: 0 })

      expect(screen.queryByRole('button', { name: /Kembali/ })).toBeNull()
    })

    it('offers back from any later step', async () => {
      const user = userEvent.setup()
      const handleBack = vi.fn()
      renderForm({ currentStep: 2, handleBack })

      await user.click(screen.getByRole('button', { name: /Kembali/ }))

      expect(handleBack).toHaveBeenCalledTimes(1)
    })

    it('advances from a middle step', async () => {
      const user = userEvent.setup()
      const handleNext = vi.fn()
      renderForm({ currentStep: 1, handleNext })

      await user.click(screen.getByRole('button', { name: /Selanjutnya/ }))

      expect(handleNext).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /Kirim|Buat/ })).toBeNull()
    })

    it('submits from the last step instead of advancing', async () => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn()
      renderForm({ currentStep: 3, handleSubmit })

      expect(screen.queryByRole('button', { name: /Selanjutnya/ })).toBeNull()
      await user.click(screen.getByRole('button', { name: /Kirim|Buat/ }))

      expect(handleSubmit).toHaveBeenCalledTimes(1)
    })

    /**
     * Creating a project is not idempotent, so a second press while the first
     * is in flight has to be refused rather than merely discouraged.
     */
    it('refuses a second submit while the first is in flight', async () => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn()
      renderForm({ currentStep: 3, handleSubmit, createProject: createProject(true) })

      const submit = screen.getByRole('button', { name: /Mengirim|Kirim|Buat/ })
      expect((submit as HTMLButtonElement).disabled).toBe(true)
      await user.click(submit)

      expect(handleSubmit).not.toHaveBeenCalled()
    })

    it('leaves the path chooser reachable', async () => {
      const user = userEvent.setup()
      const handleBackToChooser = vi.fn()
      const { container } = renderForm({ handleBackToChooser })

      await user.click(container.querySelectorAll('button')[0])

      expect(handleBackToChooser).toHaveBeenCalledTimes(1)
    })
  })

  it('jumps to a completed step from the indicator', async () => {
    const user = userEvent.setup()
    const setCurrentStep = vi.fn()
    const { container } = renderForm({ currentStep: 3, setCurrentStep })

    // The chooser arrow is first; the four step circles follow it.
    await user.click(container.querySelectorAll('button')[1])

    expect(setCurrentStep).toHaveBeenCalledExactlyOnceWith(0)
  })

  /**
   * A failed create is reported on the step the owner is standing on, not
   * swallowed. Without it the submit button simply stops responding.
   */
  it('surfaces a failed submission', () => {
    renderForm({ currentStep: 3, errors: { submit: 'Gagal membuat proyek' } })

    expect(screen.getByText('Gagal membuat proyek')).toBeDefined()
  })

  it('shows no error line when the submission is clean', () => {
    const { container } = renderForm({ currentStep: 3 })

    expect(container.querySelector('p.text-error-500')).toBeNull()
  })
})
