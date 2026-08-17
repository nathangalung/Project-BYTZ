// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './modal'

/**
 * The modal declares `aria-modal="true"`, which tells assistive technology the
 * rest of the page is inert. These pin the behaviour that promise depends on.
 * The sibling modal-focus.test.ts asserts the same contract against the source
 * text; this one drives the DOM, so it also covers the branches that reading
 * cannot reach - an empty dialog, and the difference between a backdrop click
 * and a click on the panel.
 */

function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <Modal
        open={open}
        title="Konfirmasi"
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
      >
        <button type="button">Setuju</button>
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} title="Konfirmasi" onClose={vi.fn()}>
        <p>Isi</p>
      </Modal>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Isi')).toBeNull()
  })

  it('exposes itself as a modal dialog named by its title', () => {
    render(
      <Modal open title="Konfirmasi" onClose={vi.fn()}>
        <p>Isi</p>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Konfirmasi' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Konfirmasi' })).toBeDefined()
  })

  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Buka' }))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))
  })

  /**
   * A dialog whose body holds nothing focusable still has to take focus, or
   * the keyboard user is left on the page behind an overlay they cannot reach.
   * The header close button is always rendered, so it is what focus lands on.
   */
  it('focuses the close button when the body holds nothing focusable', () => {
    render(
      <Modal open title="Pemberitahuan" onClose={vi.fn()}>
        <p>Tidak ada aksi</p>
      </Modal>,
    )

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))
  })

  it('gives the panel a tabindex so it can hold focus itself', () => {
    render(
      <Modal open title="Pemberitahuan" onClose={vi.fn()}>
        <p>Isi</p>
      </Modal>,
    )

    expect(
      (screen.getByRole('dialog').firstElementChild as HTMLElement).getAttribute('tabindex'),
    ).toBe('-1')
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Buka' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open title="Konfirmasi" onClose={onClose}>
        <button type="button">Setuju</button>
      </Modal>,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open title="Konfirmasi" onClose={onClose}>
        <p>Isi</p>
      </Modal>,
    )

    await user.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  /**
   * The overlay is the click target for dismissal, and it is also the ancestor
   * of everything in the dialog. Comparing against the overlay ref rather than
   * using the bubbled target is what stops a click on the body from closing it.
   */
  it('does not close on a click inside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open title="Konfirmasi" onClose={onClose}>
        <p>Isi</p>
      </Modal>,
    )

    await user.click(screen.getByText('Isi'))

    expect(onClose).not.toHaveBeenCalled()
  })

  describe('the tab trap', () => {
    function openTwoControls() {
      render(
        <Modal open title="Konfirmasi" onClose={vi.fn()}>
          <button type="button">Setuju</button>
        </Modal>,
      )
      return {
        close: screen.getByRole('button', { name: 'Close dialog' }),
        agree: screen.getByRole('button', { name: 'Setuju' }),
      }
    }

    it('wraps from the last control back to the first', async () => {
      const user = userEvent.setup()
      const { close, agree } = openTwoControls()

      agree.focus()
      await user.tab()

      expect(document.activeElement).toBe(close)
    })

    it('wraps backwards from the first control to the last', async () => {
      const user = userEvent.setup()
      const { close, agree } = openTwoControls()

      close.focus()
      await user.tab({ shift: true })

      expect(document.activeElement).toBe(agree)
    })

    it('wraps backwards from the panel to the last control', async () => {
      const user = userEvent.setup()
      render(
        <Modal open title="Konfirmasi" onClose={vi.fn()}>
          <button type="button">Setuju</button>
        </Modal>,
      )
      const panel = screen.getByRole('dialog').firstElementChild as HTMLElement
      const agree = screen.getByRole('button', { name: 'Setuju' })

      panel.focus()
      await user.tab({ shift: true })

      expect(document.activeElement).toBe(agree)
    })

    it('moves between controls without wrapping in the middle', async () => {
      const user = userEvent.setup()
      const { close, agree } = openTwoControls()

      close.focus()
      await user.tab()

      expect(document.activeElement).toBe(agree)
    })

    /**
     * The close button is the only control in a dialog whose body has none, so
     * first and last are the same element and Tab has to land back on it
     * rather than walk out to the page behind.
     */
    it('keeps Tab on the sole control and off the page behind', async () => {
      const user = userEvent.setup()
      render(
        <>
          <button type="button">Di belakang</button>
          <Modal open title="Pemberitahuan" onClose={vi.fn()}>
            <p>Tidak ada aksi</p>
          </Modal>
        </>,
      )
      const close = screen.getByRole('button', { name: 'Close dialog' })

      await user.tab()

      expect(document.activeElement).toBe(close)
      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Di belakang' }))
    })

    it('keeps shift-Tab on the sole control too', async () => {
      const user = userEvent.setup()
      render(
        <>
          <button type="button">Di belakang</button>
          <Modal open title="Pemberitahuan" onClose={vi.fn()}>
            <p>Tidak ada aksi</p>
          </Modal>
        </>,
      )
      const close = screen.getByRole('button', { name: 'Close dialog' })

      await user.tab({ shift: true })

      expect(document.activeElement).toBe(close)
    })
  })

  describe('the background scroll lock', () => {
    it('locks the page while open and restores it on close', async () => {
      const user = userEvent.setup()
      render(<Harness />)

      expect(document.body.style.overflow).toBe('')

      await user.click(screen.getByRole('button', { name: 'Buka' }))
      expect(document.body.style.overflow).toBe('hidden')

      await user.click(screen.getByRole('button', { name: 'Close dialog' }))
      expect(document.body.style.overflow).toBe('')
    })

    it('restores it when the modal unmounts while still open', () => {
      const { unmount } = render(
        <Modal open title="Konfirmasi" onClose={vi.fn()}>
          <p>Isi</p>
        </Modal>,
      )
      expect(document.body.style.overflow).toBe('hidden')

      unmount()

      expect(document.body.style.overflow).toBe('')
    })
  })

  it('stops listening for Escape once closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal open title="Konfirmasi" onClose={onClose}>
        <p>Isi</p>
      </Modal>,
    )

    rerender(
      <Modal open={false} title="Konfirmasi" onClose={onClose}>
        <p>Isi</p>
      </Modal>,
    )
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })
  /**
   * Callers pass an inline arrow for onClose, so it is a new function on every
   * render. When handleKeyDown depended on that identity, the focus effect tore
   * down and re-ran on each keystroke and pulled focus out of the field, which
   * meant one character landed and the rest went nowhere. Typing is the cheapest
   * way to see it: a stable modal keeps the caret where the user put it.
   */
  it('keeps focus in a field while the parent re-renders around it', async () => {
    function Typing() {
      const [text, setText] = useState('')
      return (
        <Modal open onClose={() => undefined} title="Alasan">
          <input aria-label="alasan" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      )
    }

    const user = userEvent.setup()
    render(<Typing />)
    const field = screen.getByLabelText<HTMLInputElement>('alasan')

    await user.type(field, 'tidak sesuai')

    expect(field.value).toBe('tidak sesuai')
    expect(document.activeElement).toBe(field)
  })
})
