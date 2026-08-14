// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useToastStore } from '@/stores/toast'
import { ToastContainer } from './toast-container'

afterEach(() => {
  useToastStore.setState({ toasts: [] })
})

function addToast(type: 'success' | 'error' | 'warning' | 'info', message: string) {
  act(() => {
    useToastStore.getState().addToast(type, message)
  })
}

describe('ToastContainer', () => {
  /**
   * Returning null rather than an empty positioned div matters: the container
   * is fixed at the top right with a z-index above everything, so an empty one
   * would sit over the page swallowing clicks in that corner.
   */
  it('renders nothing while there is nothing to show', () => {
    const { container } = render(<ToastContainer />)

    expect(container.firstChild).toBeNull()
  })

  it('shows a toast the moment the store gains one', () => {
    render(<ToastContainer />)

    addToast('success', 'Proyek tersimpan')

    expect(screen.getByRole('alert').textContent).toContain('Proyek tersimpan')
  })

  it('stacks several toasts at once', () => {
    render(<ToastContainer />)

    addToast('success', 'Pertama')
    addToast('error', 'Kedua')

    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(alerts.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Pertama'),
      expect.stringContaining('Kedua'),
    ])
  })

  /**
   * Dismissal has to remove the row from the store, not merely hide it, or the
   * next render brings it back. Removing by id is what keeps the other toasts
   * on screen - filtering by message or index drops the wrong one.
   */
  it('removes only the dismissed toast from the store', async () => {
    const user = userEvent.setup()
    render(<ToastContainer />)
    addToast('success', 'Pertama')
    addToast('error', 'Kedua')

    const [firstDismiss] = screen.getAllByRole('button', { name: 'Dismiss notification' })
    await user.click(firstDismiss)

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain('Kedua')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('goes back to rendering nothing once the last toast is dismissed', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToastContainer />)
    addToast('info', 'Satu-satunya')

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(container.firstChild).toBeNull()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  /**
   * Two toasts raised in the same millisecond used to collide on a timestamp
   * id, and removing one then removed both. Distinct ids are what keep them
   * independent.
   */
  it('keeps toasts raised in the same tick independent', async () => {
    const user = userEvent.setup()
    render(<ToastContainer />)
    act(() => {
      useToastStore.getState().addToast('info', 'A')
      useToastStore.getState().addToast('info', 'B')
    })

    const ids = useToastStore.getState().toasts.map((toast) => toast.id)
    expect(new Set(ids).size).toBe(2)

    await user.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])

    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('passes the type through so the toast is tinted for it', () => {
    render(<ToastContainer />)

    addToast('error', 'Gagal menyimpan')

    expect(screen.getByRole('alert').className).toContain('bg-error-500/10')
  })
})
