// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import * as settingsRoute from './settings'

/**
 * Where an account is edited: display name, avatar, notification channels and
 * password.
 *
 * `project-tabs.test.ts` reads this file as text and never mounts it, so every
 * mutation, every validation branch and every optimistic toggle was unexecuted.
 * These are the writes a user makes to their own account, and a save that
 * silently sends the wrong body is invisible until support hears about it.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const USER = {
  id: 'u1',
  email: 'rina@kerjacus.id',
  name: 'Rina Wulandari',
  role: 'owner' as const,
  locale: 'id' as const,
  phone: '+628123456789',
  avatarUrl: null as string | null,
}

function signIn(overrides: Partial<typeof USER> = {}) {
  useAuthStore.setState({
    user: { ...USER, ...overrides },
    isAuthenticated: true,
    isLoading: false,
  })
}

/** Every section talks to PATCH /api/v1/me except the password form. */
function patchCallBodies() {
  return apiFetch.mock.calls
    .filter(([url]) => url === '/api/v1/me')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

const render = () => renderRoute(settingsRoute, { path: '/settings' })

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ success: true, data: null })
  signIn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the account it is editing', () => {
  it('names the page and the account behind it', async () => {
    await render()

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeDefined()
    expect(screen.getByText('Manage your profile and account preferences')).toBeDefined()
    expect(screen.getByText('rina@kerjacus.id')).toBeDefined()
  })

  it('prefills the name field from the signed-in account', async () => {
    await render()

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Rina Wulandari')
  })

  it('shows the email and phone but refuses edits to either', async () => {
    await render()

    const email = screen.getByLabelText<HTMLInputElement>('Email')
    const phone = screen.getByLabelText<HTMLInputElement>('Phone Number')
    expect(email.value).toBe('rina@kerjacus.id')
    expect(email.disabled).toBe(true)
    expect(phone.value).toBe('+628123456789')
    expect(phone.disabled).toBe(true)
  })

  it('shows the uploaded avatar when the account has one', async () => {
    signIn({ avatarUrl: 'https://cdn.example/rina.png' })

    const { container } = await render()

    const img = container.querySelector<HTMLImageElement>('img[alt="Rina Wulandari"]')
    expect(img?.src).toBe('https://cdn.example/rina.png')
  })

  it('falls back to the initial of the name', async () => {
    await render()

    expect(screen.getByText('R')).toBeDefined()
  })

  it('falls back to U for an account with no name', async () => {
    signIn({ name: '' })

    await render()

    expect(screen.getByText('U')).toBeDefined()
  })

  /** The session can still be hydrating; the form must not crash on no user. */
  it('shows a dash for every field when there is no account yet', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true })

    await render()

    expect(screen.getAllByText('-')).toHaveLength(2)
    expect(screen.getByText('U')).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Phone Number').value).toBe('')
  })
})

describe('saving the display name', () => {
  it('sends the new name and confirms the save', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({ success: true, data: { ...USER, name: 'Rina W.' } })
    await render()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Rina W.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('Saved')).toBeDefined())
    expect(patchCallBodies()).toEqual([{ name: 'Rina W.' }])
    expect(useAuthStore.getState().user?.name).toBe('Rina W.')
  })

  it('trims the surrounding whitespace before sending', async () => {
    const user = userEvent.setup()
    await render()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '   Budi   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchCallBodies()).toEqual([{ name: 'Budi' }]))
  })

  /** An empty field must not blank the account's name. */
  it('keeps the current name when the field is cleared', async () => {
    const user = userEvent.setup()
    await render()

    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchCallBodies()).toEqual([{ name: 'Rina Wulandari' }]))
  })

  it('sends an empty name when there is neither a field value nor an account', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true })
    await render()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchCallBodies()).toEqual([{ name: '' }]))
  })

  it('leaves the stored account alone when the response carries no user', async () => {
    const user = userEvent.setup()
    apiFetch.mockResolvedValue({ success: true, data: null })
    await render()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText('Saved')).toBeDefined())
    expect(useAuthStore.getState().user?.name).toBe('Rina Wulandari')
  })

  it('disables the button and says so while the save is in flight', async () => {
    const user = userEvent.setup()
    apiFetch.mockReturnValue(new Promise(() => {}))
    await render()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const button = await screen.findByRole('button', { name: 'Loading...' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('replacing the avatar', () => {
  /**
   * Three calls in order: a presigned URL, a direct PUT to storage, then the
   * account update carrying the URL with its signature stripped off. Storing
   * the signed URL would give every viewer a link that expires.
   */
  it('presigns, uploads to storage, then stores the unsigned URL', async () => {
    const user = userEvent.setup()
    const put = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', put)
    apiFetch.mockImplementation((url: string) => {
      if (url === '/api/v1/upload/presigned-url') {
        return Promise.resolve({ data: { url: 'https://s3.example/avatar/u1.png?sig=abc' } })
      }
      return Promise.resolve({ success: true, data: { ...USER, avatarUrl: 'stored' } })
    })
    const { container } = await render()

    const file = new File(['x'], 'me.png', { type: 'image/png' })
    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLElement,
      file,
    )

    await waitFor(() => expect(useAuthStore.getState().user?.avatarUrl).toBe('stored'))
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/upload/presigned-url')
    expect(JSON.parse(String(apiFetch.mock.calls[0][1].body))).toEqual({
      fileName: 'me.png',
      fileType: 'image/png',
      folder: 'avatar',
    })
    expect(put).toHaveBeenCalledWith(
      'https://s3.example/avatar/u1.png?sig=abc',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(patchCallBodies()).toEqual([{ avatarUrl: 'https://s3.example/avatar/u1.png' }])
  })

  /** The visible control is the camera badge; the file input is hidden. */
  it('opens the file picker from the camera badge', async () => {
    const user = userEvent.setup()
    const { container } = await render()
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    ) as HTMLInputElement
    const opened = vi.fn()
    input.addEventListener('click', opened)

    await user.click(screen.getByRole('button', { name: 'Change Photo' }))

    expect(opened).toHaveBeenCalled()
  })

  it('does nothing when the picker closes without a file', async () => {
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLElement,
      [],
    )

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('keeps the stored account alone when the update returns no user', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    apiFetch.mockImplementation((url: string) =>
      url === '/api/v1/upload/presigned-url'
        ? Promise.resolve({ data: { url: 'https://s3.example/a.png?sig=x' } })
        : Promise.resolve({ success: true, data: null }),
    )
    const { container } = await render()

    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLElement,
      new File(['x'], 'a.png', { type: 'image/png' }),
    )

    await waitFor(() => expect(patchCallBodies()).toHaveLength(1))
    expect(useAuthStore.getState().user?.avatarUrl).toBeNull()
  })

  it('labels the avatar generically when the account has no name', async () => {
    signIn({ name: '', avatarUrl: 'https://cdn.example/x.png' })
    useAuthStore.setState({
      user: {
        ...USER,
        name: undefined as unknown as string,
        avatarUrl: 'https://cdn.example/x.png',
      },
    })

    const { container } = await render()

    expect(container.querySelector('img')?.alt).toBe('avatar')
  })

  it('offers the camera control by its accessible name', async () => {
    await render()

    expect(screen.getByRole('button', { name: 'Change Photo' })).toBeDefined()
  })
})

describe('the notification channels', () => {
  const CHANNELS = ['Email Notifications', 'Project Updates', 'Payment Alerts'] as const

  const toggle = (name: string) => screen.getByRole('switch', { name })

  it('starts with all three channels on', async () => {
    await render()

    expect(CHANNELS.map((c) => toggle(c).getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
    ])
    expect(screen.getByText('Receive important updates via email')).toBeDefined()
  })

  it('turns email off and sends the whole set, not just the change', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(toggle('Email Notifications'))

    expect(toggle('Email Notifications').getAttribute('aria-checked')).toBe('false')
    await waitFor(() =>
      expect(patchCallBodies()).toEqual([
        {
          notificationPreferences: {
            emailNotifications: false,
            projectUpdates: true,
            paymentAlerts: true,
          },
        },
      ]),
    )
  })

  it('turns payment alerts off without disturbing the other two', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(toggle('Payment Alerts'))

    await waitFor(() =>
      expect(patchCallBodies().at(-1)).toEqual({
        notificationPreferences: {
          emailNotifications: true,
          projectUpdates: true,
          paymentAlerts: false,
        },
      }),
    )
  })

  it('turns a channel back on after turning it off', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(toggle('Project Updates'))
    await user.click(toggle('Project Updates'))

    expect(toggle('Project Updates').getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(patchCallBodies()).toHaveLength(2))
    expect(patchCallBodies().at(-1)).toEqual({
      notificationPreferences: {
        emailNotifications: true,
        projectUpdates: true,
        paymentAlerts: true,
      },
    })
  })
})

describe('changing the password', () => {
  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    current: string,
    next: string,
    confirm: string,
  ) {
    if (current) await user.type(screen.getByLabelText('Current Password'), current)
    if (next) await user.type(screen.getByLabelText('New Password'), next)
    if (confirm) await user.type(screen.getByLabelText('Confirm New Password'), confirm)
  }

  function submitButton() {
    return screen.getByRole('button', { name: 'Change Password' }) as HTMLButtonElement
  }

  it('refuses to submit an empty form', async () => {
    await render()

    expect(submitButton().disabled).toBe(true)
  })

  it('stays disabled while the new password is under eight characters', async () => {
    const user = userEvent.setup()
    await render()

    await fill(user, 'oldpass1', 'short', 'short')

    expect(submitButton().disabled).toBe(true)
    expect(screen.getByText('Minimum 8 characters')).toBeDefined()
  })

  it('stays disabled until the confirmation is filled in', async () => {
    const user = userEvent.setup()
    await render()

    await fill(user, 'oldpass1', 'newpassword1', '')

    expect(submitButton().disabled).toBe(true)
  })

  it('rejects a confirmation that does not match, without calling the API', async () => {
    const user = userEvent.setup()
    await render()

    await fill(user, 'oldpass1', 'newpassword1', 'newpassword2')
    await user.click(submitButton())

    expect(await screen.findByText('New passwords do not match')).toBeDefined()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the change and clears every field on success', async () => {
    const user = userEvent.setup()
    await render()

    await fill(user, 'oldpass1', 'newpassword1', 'newpassword1')
    await user.click(submitButton())

    expect(await screen.findByText('Password changed successfully')).toBeDefined()
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'oldpass1',
        newPassword: 'newpassword1',
        revokeOtherSessions: false,
      }),
    })
    expect(screen.getByLabelText<HTMLInputElement>('Current Password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('New Password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Confirm New Password').value).toBe('')
  })

  it('reports a rejected change and keeps what the user typed', async () => {
    const user = userEvent.setup()
    apiFetch.mockRejectedValue(new Error('wrong password'))
    await render()

    await fill(user, 'wrongpass', 'newpassword1', 'newpassword1')
    await user.click(submitButton())

    expect(await screen.findByText('Failed to change password')).toBeDefined()
    expect(screen.queryByText('Password changed successfully')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('New Password').value).toBe('newpassword1')
  })

  it('clears a mismatch warning once the passwords agree', async () => {
    const user = userEvent.setup()
    await render()

    await fill(user, 'oldpass1', 'newpassword1', 'newpassword2')
    await user.click(submitButton())
    expect(await screen.findByText('New passwords do not match')).toBeDefined()

    await user.type(screen.getByLabelText('Confirm New Password'), '{backspace}1')
    await user.click(submitButton())

    expect(await screen.findByText('Password changed successfully')).toBeDefined()
    expect(screen.queryByText('New passwords do not match')).toBeNull()
  })

  it('says Loading while the change is in flight', async () => {
    const user = userEvent.setup()
    apiFetch.mockReturnValue(new Promise(() => {}))
    await render()

    await fill(user, 'oldpass1', 'newpassword1', 'newpassword1')
    await user.click(submitButton())

    const pending = await screen.findByRole('button', { name: 'Loading...' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
  })

  it('reveals and re-hides the current password', async () => {
    const user = userEvent.setup()
    await render()

    const field = screen.getByLabelText<HTMLInputElement>('Current Password')
    expect(field.type).toBe('password')

    await user.click(screen.getAllByRole('button', { name: 'Show Password' })[0])
    expect(field.type).toBe('text')

    await user.click(screen.getByRole('button', { name: 'Hide Password' }))
    expect(field.type).toBe('password')
  })

  it('reveals the new password independently of the current one', async () => {
    const user = userEvent.setup()
    await render()

    await user.click(screen.getAllByRole('button', { name: 'Show Password' })[1])

    expect(screen.getByLabelText<HTMLInputElement>('New Password').type).toBe('text')
    expect(screen.getByLabelText<HTMLInputElement>('Current Password').type).toBe('password')
  })

  /** The confirmation field has no reveal control, by design. */
  it('never reveals the confirmation field', async () => {
    await render()

    expect(screen.getAllByRole('button', { name: 'Show Password' })).toHaveLength(2)
    expect(screen.getByLabelText<HTMLInputElement>('Confirm New Password').type).toBe('password')
  })
})
