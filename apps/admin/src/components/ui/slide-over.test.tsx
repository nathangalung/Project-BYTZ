// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SlideOver } from './slide-over'

/**
 * Every admin detail panel is this component, and it declares
 * aria-modal="true", which promises assistive technology that the table behind
 * it is inert. The existing tests assert the trap was written; these assert it
 * holds, which is the only version that fails when a refactor drops it.
 */

function renderPanel(props: Partial<React.ComponentProps<typeof SlideOver>> = {}) {
  const onClose = vi.fn()
  const result = render(
    <SlideOver open onClose={onClose} title="Budi" closeLabel="Tutup panel" {...props}>
      <button type="button">Suspend</button>
      <button type="button">Aktifkan</button>
    </SlideOver>,
  )
  return { onClose, ...result }
}

describe('SlideOver rendering', () => {
  it('renders nothing while closed', () => {
    renderPanel({ open: false })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('announces itself as a modal dialog', () => {
    renderPanel()

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('renders title, subtitle, icon and children', () => {
    renderPanel({ subtitle: 'budi@bytz.id', icon: <span>BU</span> })

    expect(screen.getByRole('heading', { name: 'Budi' })).toBeDefined()
    expect(screen.getByText('budi@bytz.id')).toBeDefined()
    expect(screen.getByText('BU')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeDefined()
  })

  it('omits the subtitle line when none is given', () => {
    renderPanel()

    expect(screen.queryByText('budi@bytz.id')).toBeNull()
  })

  it('renders a footer only when one is supplied', () => {
    const { unmount } = renderPanel()
    expect(screen.queryByText('Simpan')).toBeNull()
    unmount()

    renderPanel({ footer: <button type="button">Simpan</button> })
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeDefined()
  })

  it('applies the caller width and keeps the default otherwise', () => {
    const { unmount } = renderPanel()
    expect(screen.getByRole('dialog').className).toContain('max-w-xl')
    unmount()

    renderPanel({ widthClassName: 'max-w-2xl' })
    expect(screen.getByRole('dialog').className).toContain('max-w-2xl')
  })
})

describe('SlideOver dismissal', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPanel()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the labelled close control', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPanel()

    // Both the backdrop and the header X carry the label; either must close.
    await user.click(screen.getAllByRole('button', { name: 'Tutup panel' })[0])

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(
      <SlideOver open onClose={onClose} title="Budi" closeLabel="Tutup panel">
        <button type="button">Suspend</button>
      </SlideOver>,
    )

    rerender(
      <SlideOver open={false} onClose={onClose} title="Budi" closeLabel="Tutup panel">
        <button type="button">Suspend</button>
      </SlideOver>,
    )
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('SlideOver focus handling', () => {
  it('moves focus to the first control rather than the bare panel', () => {
    renderPanel()

    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Tutup panel' })[1])
  })

  it('falls back to the panel when it holds nothing focusable', () => {
    render(
      <SlideOver open onClose={vi.fn()} title="Kosong" closeLabel="Tutup">
        <p>tidak ada kontrol</p>
      </SlideOver>,
    )

    // The header close button is itself focusable, so it takes focus.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Tutup')
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<button type="button">Buka</button>)
    const trigger = screen.getByRole('button', { name: 'Buka' })
    trigger.focus()

    const { unmount } = render(
      <SlideOver open onClose={vi.fn()} title="Budi" closeLabel="Tutup panel">
        <button type="button">Suspend</button>
      </SlideOver>,
    )
    await user.keyboard('{Escape}')
    unmount()

    expect(document.activeElement).toBe(trigger)
  })

  /**
   * aria-modal promises focus stays inside. Without the trap the next Tab
   * lands on the table behind a dialog still announced as modal.
   */
  it('wraps Tab from the last control back to the first', async () => {
    const user = userEvent.setup()
    renderPanel()
    const last = screen.getByRole('button', { name: 'Aktifkan' })
    last.focus()

    await user.tab()

    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Tutup panel' })[1])
  })

  it('wraps Shift+Tab from the first control round to the last', async () => {
    const user = userEvent.setup()
    renderPanel()
    screen.getAllByRole('button', { name: 'Tutup panel' })[1].focus()

    await user.tab({ shift: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aktifkan' }))
  })

  it('leaves an interior Tab alone so the panel is still traversable', async () => {
    const user = userEvent.setup()
    renderPanel()
    screen.getByRole('button', { name: 'Suspend' }).focus()

    await user.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aktifkan' }))
  })
})
