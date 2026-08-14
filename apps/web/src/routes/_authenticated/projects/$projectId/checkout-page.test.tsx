// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RouteModule, renderRoute } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'

/**
 * The page where an owner parts with money.
 *
 * Four checkout types share it and each prices from a different field, so a
 * wrong branch shows an owner one figure and charges another. The server
 * prices the order for real, but the number on this page is what the owner
 * consents to, and a revision fee rendered as the full project price is the
 * difference between a few hundred thousand rupiah and tens of millions.
 *
 * The Snap client key is read at module load, so the module is imported fresh
 * per case with the environment stubbed, as api-url.test.ts does.
 */

vi.setConfig({ testTimeout: 30_000 })

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = {
  id: 'p-1',
  title: 'Toko Online Batik',
  finalPrice: 18_000_000,
  brd: { id: 'b-1', price: 500_000 },
  prd: { id: 'd-1', price: 1_500_000 },
}

const MILESTONE = { id: 'm-1', title: 'Autentikasi', amount: 4_000_001, status: 'submitted' }

function stubApi(project: unknown = PROJECT, milestones: unknown[] = [MILESTONE]) {
  apiFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/milestones')) return { success: true, data: milestones }
    if (String(url).includes('create-snap-token'))
      return { success: true, data: { token: 'snap-token' } }
    return { success: true, data: project }
  })
}

/** Load the route with the Snap key present or absent, as this case needs. */
async function loadRoute(clientKey: string) {
  vi.resetModules()
  vi.stubEnv('VITE_MIDTRANS_CLIENT_KEY', clientKey)
  return (await import('./checkout')) as unknown as RouteModule
}

function render(mod: RouteModule, search = '') {
  return renderRoute(mod, {
    path: '/projects/$projectId/checkout',
    entry: `/projects/p-1/checkout${search}`,
    destinations: ['/projects/$projectId'],
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  stubApi()
  window.snap = undefined
  useAuthStore.setState({
    user: { id: 'u1', email: 'rina@kerjacus.id', name: 'Rina', role: 'owner', locale: 'id' },
    isAuthenticated: true,
    isLoading: false,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  window.snap = undefined
})

describe('loading the project being paid for', () => {
  it('says it is loading rather than showing a zero total', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))
    const mod = await loadRoute('')

    await render(mod)

    expect(screen.getByText('Loading project...')).toBeDefined()
    expect(screen.queryByText(/Pay Now/)).toBeNull()
  })

  it('reports a failed load and offers the way back', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    const mod = await loadRoute('')

    await render(mod)

    expect(await screen.findByText('Failed to load project')).toBeDefined()
    expect(screen.getByRole('link', { name: /back to project/i }).getAttribute('href')).toBe(
      '/projects/p-1',
    )
  })

  /** A 200 with no body is not a project; it must not render a payable form. */
  it('treats an empty reply as a failed load', async () => {
    stubApi(null)
    const mod = await loadRoute('')

    await render(mod)

    expect(await screen.findByText('Failed to load project')).toBeDefined()
  })
})

/**
 * The figure on the button.
 *
 * Each checkout type reads a different field, and the revision fee is derived
 * rather than stored — ceil(10% of the milestone), mirroring the server.
 */
describe('what the owner is asked to pay', () => {
  async function amountFor(search: string) {
    const mod = await loadRoute('')
    await render(mod, search)
    const button = await screen.findByRole('button', { name: /Pay Now/ })
    return button.textContent ?? ''
  }

  it('charges the project price for an escrow deposit', async () => {
    expect(await amountFor('')).toContain('18.000.000')
  })

  it('charges the BRD price for a BRD purchase', async () => {
    expect(await amountFor('?type=brd')).toContain('500.000')
  })

  it('charges the PRD price for a PRD purchase', async () => {
    expect(await amountFor('?type=prd')).toContain('1.500.000')
  })

  /** Ten percent of 4,000,001 rounds up, so the platform is never short a rupiah. */
  it('charges a tenth of the milestone, rounded up, for a revision', async () => {
    expect(await amountFor('?type=revision&milestoneId=m-1')).toContain('400.001')
  })

  it('charges nothing rather than the project price for an unknown milestone', async () => {
    expect(await amountFor('?type=revision&milestoneId=m-nope')).toContain('0')
  })

  it('falls back to zero when the document carries no price', async () => {
    stubApi({ ...PROJECT, brd: null })

    expect(await amountFor('?type=brd')).toContain('0')
  })
})

/**
 * The gate in front of the money.
 *
 * Pay stays disabled until the owner has agreed and the gateway is loaded.
 * Either half missing and a click would either charge without consent or fail
 * with a broken popup.
 */
describe('the consent gate', () => {
  it('keeps Pay disabled while the terms are unchecked', async () => {
    const mod = await loadRoute('SB-Mid-client-test')
    window.snap = { pay: vi.fn() }

    await render(mod)

    const pay = await screen.findByRole<HTMLButtonElement>('button', { name: /Pay Now/ })
    expect(pay.disabled).toBe(true)
  })

  it('warns and stays disabled when the gateway key is not configured', async () => {
    const mod = await loadRoute('')
    const user = userEvent.setup()

    await render(mod)
    await user.click(await screen.findByRole('checkbox'))

    const pay = screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ })
    expect(pay.disabled).toBe(true)
    expect(
      screen.getByText(
        'Payment gateway configuration is incomplete. Please contact administrator.',
      ),
    ).toBeDefined()
  })

  it('enables Pay once the terms are agreed and the gateway is ready', async () => {
    window.snap = { pay: vi.fn() }
    const mod = await loadRoute('SB-Mid-client-test')
    const user = userEvent.setup()

    await render(mod)
    await user.click(await screen.findByRole('checkbox'))

    await waitFor(() => {
      const pay = screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ })
      expect(pay.disabled).toBe(false)
    })
  })
})

/**
 * What the Snap popup reports back.
 *
 * Each outcome puts the page in a different state, and mistaking pending for
 * success tells an owner their escrow is funded when the bank has not moved.
 */
describe('the outcome of the payment popup', () => {
  async function payWith(outcome: 'onSuccess' | 'onPending' | 'onError' | 'onClose') {
    const pay = vi.fn<NonNullable<Window['snap']>['pay']>((_token, handlers) => {
      const handler = handlers[outcome]
      handler?.({})
    })
    window.snap = { pay }
    const mod = await loadRoute('SB-Mid-client-test')
    const user = userEvent.setup()

    await render(mod)
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(
        false,
      )
    })
    await user.click(screen.getByRole('button', { name: /Pay Now/ }))
    return pay
  }

  it('confirms a completed payment', async () => {
    await payWith('onSuccess')

    expect(await screen.findByText('Payment processed successfully')).toBeDefined()
  })

  it('says the money has not arrived yet on a pending result', async () => {
    await payWith('onPending')

    expect(await screen.findByText(/waiting|menunggu/i)).toBeDefined()
    expect(screen.queryByText('Payment processed successfully')).toBeNull()
  })

  it('reports a rejected payment and offers a retry back to the form', async () => {
    const user = userEvent.setup()
    await payWith('onError')

    expect(await screen.findByRole('heading', { name: /payment failed/i })).toBeDefined()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('button', { name: /Pay Now/ })).toBeDefined()
  })

  it('sends the order with the customer and the project title', async () => {
    const pay = await payWith('onSuccess')

    expect(pay).toHaveBeenCalledWith('snap-token', expect.any(Object))
    const snapCall = apiFetch.mock.calls.find(([u]) => String(u).includes('create-snap-token'))
    const body = String((snapCall?.[1] as RequestInit)?.body)
    expect(body).toContain('Toko Online Batik')
    expect(body).toContain('rina@kerjacus.id')
    expect(body).toContain('ESC-')
  })

  /** Revision orders carry the milestone id so the callback can grant credit. */
  it('marks a revision order with the milestone it belongs to', async () => {
    window.snap = {
      pay: vi.fn<NonNullable<Window['snap']>['pay']>((_t, handlers) => {
        handlers.onSuccess?.({})
      }),
    }
    const mod = await loadRoute('SB-Mid-client-test')
    const user = userEvent.setup()

    await render(mod, '?type=revision&milestoneId=m-1')
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(
        false,
      )
    })
    await user.click(screen.getByRole('button', { name: /Pay Now/ }))

    await waitFor(() => {
      const snapCall = apiFetch.mock.calls.find(([u]) => String(u).includes('create-snap-token'))
      expect(String((snapCall?.[1] as RequestInit)?.body)).toContain('REV-m-1-')
    })
  })
})

describe('failures on the way to the popup', () => {
  async function clickPay(mod: RouteModule) {
    const user = userEvent.setup()
    await render(mod)
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(
        false,
      )
    })
    await user.click(screen.getByRole('button', { name: /Pay Now/ }))
  }

  /** The token arrived but the gateway script did not; say so rather than hang. */
  it('names a gateway that never finished loading', async () => {
    window.snap = { pay: vi.fn() }
    const mod = await loadRoute('SB-Mid-client-test')
    await render(mod)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(
        false,
      )
    })
    window.snap = undefined
    await user.click(screen.getByRole('button', { name: /Pay Now/ }))

    expect(
      await screen.findByText('Payment gateway is not ready. Please reload the page.'),
    ).toBeDefined()
  })

  it('surfaces the reason the token was refused', async () => {
    window.snap = { pay: vi.fn() }
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('create-snap-token')) throw new Error('Escrow already funded')
      if (String(url).includes('/milestones')) return { success: true, data: [MILESTONE] }
      return { success: true, data: PROJECT }
    })
    const mod = await loadRoute('SB-Mid-client-test')

    await clickPay(mod)

    expect(await screen.findByText('Escrow already funded')).toBeDefined()
  })
})

/**
 * Loading the gateway script.
 *
 * The promise is cached on the module rather than the component, because
 * listening for `load` on a tag that already finished never fires and left Pay
 * permanently disabled after a remount. A failed load has to drop the cache so
 * the next mount retries rather than inheriting the rejection forever.
 */
describe('the Snap script tag', () => {
  function scriptTag() {
    return document.querySelector<HTMLScriptElement>('script[data-client-key]')
  }

  afterEach(() => {
    for (const s of document.querySelectorAll('script[data-client-key]')) s.remove()
  })

  it('injects the tag with the client key when the gateway is not already present', async () => {
    const mod = await loadRoute('SB-Mid-client-test')

    await render(mod)

    await waitFor(() => expect(scriptTag()).not.toBeNull())
    expect(scriptTag()?.getAttribute('data-client-key')).toBe('SB-Mid-client-test')
    expect(scriptTag()?.src).toContain('snap.js')
  })

  it('enables Pay once the tag reports it loaded', async () => {
    const mod = await loadRoute('SB-Mid-client-test')
    const user = userEvent.setup()
    await render(mod)
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(scriptTag()).not.toBeNull())

    scriptTag()?.onload?.(new Event('load'))

    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(
        false,
      )
    })
  })

  it('leaves Pay disabled and removes the tag when the script fails', async () => {
    const mod = await loadRoute('SB-Mid-client-test')
    const user = userEvent.setup()
    await render(mod)
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(scriptTag()).not.toBeNull())

    scriptTag()?.onerror?.(new Event('error'))

    await waitFor(() => expect(scriptTag()).toBeNull())
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay Now/ }).disabled).toBe(true)
  })

  /** Already loaded in this tab: resolve straight away rather than wait forever. */
  it('injects no tag when the gateway is already on the page', async () => {
    window.snap = { pay: vi.fn() }
    const mod = await loadRoute('SB-Mid-client-test')

    await render(mod)
    await screen.findByRole('checkbox')

    expect(scriptTag()).toBeNull()
  })

  it('injects no tag at all without a client key', async () => {
    const mod = await loadRoute('')

    await render(mod)
    await screen.findByRole('checkbox')

    expect(scriptTag()).toBeNull()
  })
})
