// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { StepIndicator } from './step-indicator'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

const LABELS = ['Informasi Dasar', 'Anggaran & Jadwal', 'Preferensi', 'Tinjau & Kirim']

describe('StepIndicator', () => {
  it('names every step of the intake wizard', () => {
    render(<StepIndicator currentStep={0} />)

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeDefined()
    }
  })

  /**
   * Progressive disclosure only works if the user can see where they are and
   * how much is left. Steps already passed are the ones worth going back to,
   * so those are the only ones that stay pressable.
   */
  it('allows going back to a completed step and to the current one', () => {
    render(<StepIndicator currentStep={2} />)

    const buttons = screen.getAllByRole('button')
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false)
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(false)
  })

  it('locks the steps that have not been reached', () => {
    render(<StepIndicator currentStep={1} />)

    const buttons = screen.getAllByRole('button')
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true)
    expect((buttons[3] as HTMLButtonElement).disabled).toBe(true)
  })

  it('locks everything but the first step at the start', () => {
    render(<StepIndicator currentStep={0} />)

    const [first, ...rest] = screen.getAllByRole('button')
    expect((first as HTMLButtonElement).disabled).toBe(false)
    for (const button of rest) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('reports the step the user jumped back to', async () => {
    const user = userEvent.setup()
    const onStepClick = vi.fn()
    render(<StepIndicator currentStep={3} onStepClick={onStepClick} />)

    await user.click(screen.getAllByRole('button')[1])

    expect(onStepClick).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('reports nothing for a step still locked', async () => {
    const user = userEvent.setup()
    const onStepClick = vi.fn()
    render(<StepIndicator currentStep={0} onStepClick={onStepClick} />)

    await user.click(screen.getAllByRole('button')[3])

    expect(onStepClick).not.toHaveBeenCalled()
  })

  it('works without a click handler', async () => {
    const user = userEvent.setup()
    render(<StepIndicator currentStep={1} />)

    await user.click(screen.getAllByRole('button')[0])

    expect(screen.getByText('Informasi Dasar')).toBeDefined()
  })

  /**
   * The completed steps swap their step icon for a tick. That is the only
   * non-colour cue distinguishing done from pending, so it carries the meaning
   * for anyone who cannot separate the two fills.
   */
  it('ticks off the steps already completed', () => {
    const { container } = render(<StepIndicator currentStep={2} />)

    const completed = screen.getAllByRole('button').slice(0, 2)
    for (const button of completed) {
      expect(button.className).toContain('bg-brand')
    }
    // Two ticks for the two completed steps, plus the icons for the rest.
    expect(container.querySelectorAll('button svg')).toHaveLength(4)
  })

  it('highlights the step being filled in', () => {
    render(<StepIndicator currentStep={1} />)

    expect(screen.getAllByRole('button')[1].className).toContain('border-warning-500')
  })

  it('fills the connector up to the current step only', () => {
    const { container } = render(<StepIndicator currentStep={2} />)

    const connectors = Array.from(container.querySelectorAll('.h-0\\.5'))
    expect(connectors).toHaveLength(3)
    expect((connectors[0] as HTMLElement).className).toContain('bg-success-600')
    expect((connectors[1] as HTMLElement).className).toContain('bg-success-600')
    expect((connectors[2] as HTMLElement).className).toContain('bg-outline-dim')
  })
})
