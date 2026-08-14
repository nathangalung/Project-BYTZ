// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import type { FormData } from './shared'
import { Step2BudgetTimeline } from './step-budget-timeline'

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
    visibility: 'public_summary' as FormData['visibility'],
    documentFileKey: '',
    documentType: '',
    ...overrides,
  }
}

function renderStep(props: Partial<Parameters<typeof Step2BudgetTimeline>[0]> = {}) {
  return render(
    <Step2BudgetTimeline form={form()} errors={{}} updateField={vi.fn()} t={t} {...props} />,
  )
}

describe('Step2BudgetTimeline', () => {
  it('labels every field so it is reachable by name', () => {
    renderStep()

    expect(screen.getByLabelText(/Anggaran Minimum/)).toBeDefined()
    expect(screen.getByLabelText(/Anggaran Maksimum/)).toBeDefined()
    expect(screen.getByLabelText(/Estimasi Timeline/)).toBeDefined()
    expect(screen.getByLabelText('Deadline')).toBeDefined()
  })

  describe('the budget fields', () => {
    /**
     * The field shows grouped digits but the form holds raw ones. Sending the
     * formatted string upward would put dots into a value parseBudget then has
     * to undo, and Number('10.000.000') is NaN.
     */
    it('reports the raw digits while showing them grouped', async () => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      await user.type(screen.getByLabelText(/Anggaran Minimum/), '1')

      expect(updateField).toHaveBeenCalledExactlyOnceWith('budgetMin', '1')
    })

    it('renders a stored raw value with thousands separators', () => {
      renderStep({ form: form({ budgetMin: '10000000', budgetMax: '50000000' }) })

      expect((screen.getByLabelText(/Anggaran Minimum/) as HTMLInputElement).value).toBe(
        '10.000.000',
      )
      expect((screen.getByLabelText(/Anggaran Maksimum/) as HTMLInputElement).value).toBe(
        '50.000.000',
      )
    })

    it('strips anything that is not a digit before reporting it', async () => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      await user.type(screen.getByLabelText(/Anggaran Maksimum/), 'a')

      expect(updateField).toHaveBeenCalledExactlyOnceWith('budgetMax', '')
    })

    it('asks for a numeric keypad on a phone', () => {
      renderStep()

      expect(screen.getByLabelText(/Anggaran Minimum/).getAttribute('inputmode')).toBe('numeric')
    })

    it('prefixes both amounts with the currency', () => {
      renderStep()

      expect(screen.getAllByText('Rp')).toHaveLength(2)
    })
  })

  describe('the timeline field', () => {
    it('reports what was typed', async () => {
      const user = userEvent.setup()
      const updateField = vi.fn()
      renderStep({ updateField })

      await user.type(screen.getByLabelText(/Estimasi Timeline/), '3')

      expect(updateField).toHaveBeenCalledExactlyOnceWith('estimatedTimelineDays', '3')
    })

    it('refuses a timeline below one day at the field level', () => {
      renderStep()

      const input = screen.getByLabelText(/Estimasi Timeline/) as HTMLInputElement
      expect(input.type).toBe('number')
      expect(input.min).toBe('1')
    })
  })

  it('reports the deadline that was picked', async () => {
    const user = userEvent.setup()
    const updateField = vi.fn()
    renderStep({ updateField })

    await user.type(screen.getByLabelText('Deadline'), '2026-12-31')

    expect(updateField).toHaveBeenLastCalledWith('deadline', '2026-12-31')
  })

  describe('the validation messages', () => {
    /**
     * The error text and the red border have to arrive together. A red field
     * with no message leaves the owner guessing what is wrong with it, and a
     * message on an unmarked field is easy to miss.
     */
    it('shows the message and marks the field it belongs to', () => {
      renderStep({ errors: { budgetMin: 'Anggaran minimum wajib diisi' } })

      expect(screen.getByText('Anggaran minimum wajib diisi')).toBeDefined()
      expect(screen.getByLabelText(/Anggaran Minimum/).className).toContain('border-error-500')
    })

    it('leaves the other fields unmarked', () => {
      renderStep({ errors: { budgetMin: 'Wajib diisi' } })

      expect(screen.getByLabelText(/Anggaran Maksimum/).className).not.toContain('border-error-500')
    })

    it.each(['budgetMax', 'estimatedTimelineDays'])('surfaces the %s message', (field) => {
      renderStep({ errors: { [field]: 'Nilai tidak valid' } })

      expect(screen.getByText('Nilai tidak valid')).toBeDefined()
    })

    it('shows nothing when the step is clean', () => {
      const { container } = renderStep()

      expect(container.querySelectorAll('.text-error-500')).toHaveLength(3)
      expect(container.querySelector('p.text-error-500')).toBeNull()
    })
  })

  /**
   * The deadline is the only optional field here, and the three required ones
   * are marked so the owner can see what has to be filled before continuing.
   */
  it('marks the three required fields and leaves the deadline unmarked', () => {
    const { container } = renderStep()

    expect(container.querySelectorAll('label .text-error-500')).toHaveLength(3)
    expect(screen.getByText('Deadline').querySelector('.text-error-500')).toBeNull()
  })
})
