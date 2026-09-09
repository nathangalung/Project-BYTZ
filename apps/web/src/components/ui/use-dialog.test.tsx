// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDialog } from './use-dialog'

vi.setConfig({ testTimeout: 30_000 })

/**
 * Behaviour, not source text.
 *
 * The predecessor asserted that modal.tsx contained certain strings, so moving
 * the same logic into this hook broke it while the behaviour was intact. What
 * matters is that focus enters, stays, and comes back.
 */

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
    onClose?.()
  }
  const panelRef = useDialog(open, close)

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <button type="button">Di luar</button>
      {open && (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <button type="button">Pertama</button>
          <button type="button">Kedua</button>
        </div>
      )}
    </div>
  )
}

function ClosableHarness({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  const panelRef = useDialog(open, () => setOpen(false))
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>{`Buka ${label}`}</button>
      {open && (
        <div ref={panelRef} tabIndex={-1}>
          <button type="button" onClick={() => setOpen(false)}>{`Tutup ${label}`}</button>
        </div>
      )}
    </div>
  )
}

function EmptyHarness() {
  const [open, setOpen] = useState(false)
  const panelRef = useDialog(open, () => setOpen(false))
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      {open && <div ref={panelRef} tabIndex={-1} data-testid="panel" />}
    </div>
  )
}

describe('useDialog', () => {
  it('focuses the first control when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Buka' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pertama' }))
  })

  it('wraps Tab from the last control to the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Buka' }))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kedua' }))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pertama' }))
  })

  it('wraps Shift+Tab from the first control to the last', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Buka' }))

    await user.tab({ shift: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kedua' }))
  })

  it('pulls focus back when it has escaped the panel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Buka' }))

    screen.getByRole('button', { name: 'Di luar' }).focus()
    await user.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pertama' }))
  })

  it('holds focus on an empty panel rather than letting Tab out', async () => {
    const user = userEvent.setup()
    render(<EmptyHarness />)
    await user.click(screen.getByRole('button', { name: 'Buka' }))

    await user.tab()

    expect(document.activeElement).toBe(screen.getByTestId('panel'))
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Buka' }))

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Buka' })
    await user.click(trigger)

    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(trigger)
  })

  it('releases the scroll lock only when the last dialog closes', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ClosableHarness label="A" />
        <ClosableHarness label="B" />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Buka A' }))
    await user.click(screen.getByRole('button', { name: 'Buka B' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'Tutup B' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'Tutup A' }))
    expect(document.body.style.overflow).toBe('')
  })
})
