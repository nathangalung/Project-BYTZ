import { beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectCentrifugo = vi.fn()
const clear = vi.fn()

vi.mock('@/lib/centrifugo', () => ({ disconnectCentrifugo }))
vi.mock('@/lib/query-client', () => ({ queryClient: { clear } }))

const { useAuthStore } = await import('./auth')

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn(
    async () => new Response('{}', { status: 200 }),
  ) as unknown as typeof fetch
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

/**
 * Logout runs on shared machines. Anything still keyed to the previous
 * identity is either readable by the next user or blocks them.
 */
describe('logout teardown', () => {
  it('clears the query cache so the next user cannot read cached account data', async () => {
    await useAuthStore.getState().logout()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('drops the Centrifugo connection held on the old token', async () => {
    await useAuthStore.getState().logout()
    expect(disconnectCentrifugo).toHaveBeenCalledTimes(1)
  })

  it('resets auth state', async () => {
    await useAuthStore.getState().logout()
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  /**
   * A sign-out request that fails must not leave the browser holding the old
   * session's cache and socket - the local teardown has to happen regardless.
   */
  it('tears down even when the sign-out request fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    await useAuthStore.getState().logout()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(disconnectCentrifugo).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
