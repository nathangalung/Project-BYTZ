// @vitest-environment jsdom
import { PLATFORM_FEE_BRACKETS, PLATFORM_FEE_TOP_BRACKET } from '@kerjacus/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { Route } from './settings'

/**
 * Two very different things share this screen.
 *
 * The matching weights are writable and decide who gets offered work: raising
 * skill_match against pemerataan is the difference between the platform's
 * fairness policy holding and a rich-get-richer distribution. They are stored
 * as percentages that have to sum to 100, and the save is gated on that.
 *
 * The fee bracket table is read-only, because pricing.ts owns it. Its fallback
 * is derived from those constants rather than retyped, so the assertion that
 * matters is that a rate the engine changed shows up here too.
 */

const SETTINGS = [
  {
    id: 's-1',
    key: 'matching_weights',
    value: { skill_match: 30, pemerataan: 35, track_record: 20, rating: 15 },
    description: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    id: 's-2',
    key: 'exploration_rate',
    value: 0.3,
    description: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    id: 's-3',
    key: 'auto_release_days',
    value: 14,
    description: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    id: 's-4',
    key: 'free_revision_rounds',
    value: 2,
    description: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    id: 's-5',
    key: 'max_team_size',
    value: 8,
    description: null,
    updatedBy: null,
    updatedAt: null,
  },
]

type Options = { settings?: unknown[]; listFails?: boolean; saveFails?: boolean }

function stubFetch(options: Options = {}) {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (options.saveFails) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => ({ success: true, data: {} }) }
    }
    if (options.listFails) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ success: true, data: options.settings ?? SETTINGS }) }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

async function renderPage() {
  const lazy = Route.options.component as unknown as { preload: () => Promise<unknown> }
  await lazy.preload()
  const Component = Route.options.component as () => React.ReactNode
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  )
}

function patchCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
}

/** Range and controlled number inputs both ignore typing; fire the change. */
function setField(label: string | RegExp, value: number) {
  fireEvent.change(screen.getByLabelText<HTMLInputElement>(label), {
    target: { value: String(value) },
  })
}

/**
 * The stored settings arrive after first paint and an effect overwrites local
 * state with them, so editing before that lands is silently undone.
 */
async function waitForHydration() {
  await waitFor(() => expect(screen.queryByText('Memuat...')).toBeNull())
}

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

beforeEach(() => {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'admin-1', email: 'admin@bytz.id', name: 'Admin', role: 'admin', locale: 'id' },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await i18n.changeLanguage('id')
})

describe('settings load states', () => {
  it('hydrates every control from the stored settings', async () => {
    stubFetch()
    await renderPage()

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Kecocokan Skill').value).toBe('30'),
    )
    expect(screen.getByLabelText<HTMLInputElement>('Pemerataan (Fairness)').value).toBe('35')
    expect(screen.getByLabelText<HTMLInputElement>('Track Record').value).toBe('20')
    expect(screen.getByLabelText<HTMLInputElement>('Rating').value).toBe('15')
    expect(screen.getByLabelText<HTMLInputElement>(/Timer Auto-Release/).value).toBe('14')
    expect(screen.getByLabelText<HTMLInputElement>(/Putaran Revisi Gratis/).value).toBe('2')
    expect(screen.getByLabelText<HTMLInputElement>(/Ukuran Tim Maksimal/).value).toBe('8')
  })

  /** Stored as a 0-1 rate, shown and saved as a percentage. */
  it('scales the exploration rate from a fraction to a percentage', async () => {
    stubFetch()
    await renderPage()

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Exploration Rate').value).toBe('30'),
    )
  })

  it('says it is loading before the settings arrive', async () => {
    stubFetch()
    await renderPage()

    expect(screen.getByText('Memuat...')).toBeDefined()
  })

  it('reports a failed load without blanking the form', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
    expect(screen.getByLabelText('Kecocokan Skill')).toBeDefined()
  })

  it('falls back to the documented defaults when a row is missing', async () => {
    stubFetch({ settings: [] })
    await renderPage()

    expect(screen.getByLabelText<HTMLInputElement>('Kecocokan Skill').value).toBe('30')
    expect(screen.getByLabelText<HTMLInputElement>('Pemerataan (Fairness)').value).toBe('35')
  })

  it('ignores a stored value of the wrong type rather than rendering NaN', async () => {
    stubFetch({
      settings: [
        { ...SETTINGS[2], value: 'fourteen' },
        { ...SETTINGS[0], value: { skill_match: 40 } },
      ],
    })
    await renderPage()

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Kecocokan Skill').value).toBe('40'),
    )
    // The other three weights keep their defaults rather than becoming undefined.
    expect(screen.getByLabelText<HTMLInputElement>('Rating').value).toBe('15')
    expect(screen.getByLabelText<HTMLInputElement>(/Timer Auto-Release/).value).toBe('14')
  })
})

describe('matching weights', () => {
  /**
   * The four weights are a distribution. Saving a set that does not sum to 100
   * would silently rescale every recommendation score.
   */
  it('refuses to save a set that does not sum to 100', async () => {
    stubFetch()
    await renderPage()
    await waitForHydration()

    setField('Kecocokan Skill', 50)

    expect(screen.getByText(/Total: 120%/)).toBeDefined()
    expect(screen.getByText(/harus sama dengan 100%/)).toBeDefined()
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: /Simpan/ })[0].disabled).toBe(
      true,
    )
  })

  /** All four sliders feed one payload; a crossed wire would swap two weights. */
  it('carries an edit to every weight into the payload', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await waitForHydration()

    setField('Kecocokan Skill', 25)
    setField('Pemerataan (Fairness)', 40)
    setField('Track Record', 25)
    setField('Rating', 10)
    await user.click(screen.getAllByRole('button', { name: /Simpan/ })[0])

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    expect(JSON.parse(String((patchCalls(spy)[0][1] as RequestInit).body)).value).toEqual({
      skill_match: 25,
      pemerataan: 40,
      track_record: 25,
      rating: 10,
    })
  })

  it('saves the whole distribution once it balances', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await waitForHydration()

    setField('Kecocokan Skill', 40)
    setField('Pemerataan (Fairness)', 25)
    expect(screen.getByText(/Total: 100%/)).toBeDefined()

    await user.click(screen.getAllByRole('button', { name: /Simpan/ })[0])

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1))
    const [url, init] = patchCalls(spy)[0]
    expect(url).toBe('/api/v1/admin/settings/matching_weights')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      adminId: 'admin-1',
      value: { skill_match: 40, pemerataan: 25, track_record: 20, rating: 15 },
    })
  })

  /** The defaults are the fairness policy in CLAUDE.md; reset must restore exactly those. */
  it('restores the documented default weights', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()
    await waitForHydration()

    setField('Kecocokan Skill', 70)
    await user.click(screen.getByRole('button', { name: /Reset Default/ }))

    expect(screen.getByLabelText<HTMLInputElement>('Kecocokan Skill').value).toBe('30')
    expect(screen.getByLabelText<HTMLInputElement>('Pemerataan (Fairness)').value).toBe('35')
    expect(screen.getByLabelText<HTMLInputElement>('Track Record').value).toBe('20')
    expect(screen.getByLabelText<HTMLInputElement>('Rating').value).toBe('15')
    expect(screen.getByText(/Total: 100%/)).toBeDefined()
  })

  it('writes nothing when the acting admin is unknown', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    stubFetch()
    await renderPage()
    await waitForHydration()

    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: /Simpan/ })[0].disabled).toBe(
      true,
    )
  })

  /**
   * Not covered: a failed save cannot be driven from a test without leaving an
   * unhandled promise rejection, because handleSaveWeights and
   * handleSavePlatform `await saveMutation.mutateAsync(...)` with no catch. The
   * banner itself renders off saveMutation.isError and is correct; the missing
   * catch is reported as a defect rather than asserted around here.
   */
})

describe('platform configuration', () => {
  it('writes each core setting under its own key', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await waitForHydration()

    await user.click(screen.getAllByRole('button', { name: /Simpan/ })[1])

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(4))
    const written = Object.fromEntries(
      patchCalls(spy).map(([url, init]) => [
        String(url).split('/').pop(),
        JSON.parse(String((init as RequestInit).body)).value,
      ]),
    )
    // Exploration goes back as the 0-1 rate the matcher reads.
    expect(written).toEqual({
      exploration_rate: 0.3,
      auto_release_days: 14,
      free_revision_rounds: 2,
      max_team_size: 8,
    })
  })

  /** Each control has to reach its own key; a crossed wire is silent. */
  it('sends every edited core setting under the right key', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await waitForHydration()

    setField('Exploration Rate', 45)
    setField(/Timer Auto-Release/, 21)
    setField(/Putaran Revisi Gratis/, 3)
    setField(/Ukuran Tim Maksimal/, 6)
    await user.click(screen.getAllByRole('button', { name: /Simpan/ })[1])

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(4))
    const written = Object.fromEntries(
      patchCalls(spy).map(([url, init]) => [
        String(url).split('/').pop(),
        JSON.parse(String((init as RequestInit).body)).value,
      ]),
    )
    expect(written).toEqual({
      // Exploration goes back as the 0-1 rate the matcher reads.
      exploration_rate: 0.45,
      auto_release_days: 21,
      free_revision_rounds: 3,
      max_team_size: 6,
    })
  })

  it('sends an edited auto-release window', async () => {
    const user = userEvent.setup()
    const spy = stubFetch()
    await renderPage()
    await waitForHydration()

    setField(/Timer Auto-Release/, 21)
    await user.click(screen.getAllByRole('button', { name: /Simpan/ })[1])

    await waitFor(() => expect(patchCalls(spy).length).toBeGreaterThanOrEqual(4))
    const call = patchCalls(spy).find(([u]) => String(u).endsWith('auto_release_days'))
    expect(call).toBeDefined()
    const [, init] = call as [string, RequestInit]
    expect(JSON.parse(String(init.body)).value).toBe(21)
  })
})

describe('fee bracket table', () => {
  /**
   * pricing.ts is the single owner. The panel renders whatever the constants
   * say, so a rate changed in the engine shows up here without a second edit.
   */
  it('publishes every locked bracket straight from the pricing constants', async () => {
    stubFetch({ settings: [] })
    await renderPage()

    for (const bracket of PLATFORM_FEE_BRACKETS) {
      const jt = `Rp ${Math.round(bracket.maxFee / 1_000_000)} jt`
      expect(screen.getByText(`<= ${jt}`), jt).toBeDefined()
    }
    const top = PLATFORM_FEE_BRACKETS[PLATFORM_FEE_BRACKETS.length - 1]
    expect(screen.getByText(`> Rp ${Math.round(top.maxFee / 1_000_000)} jt`)).toBeDefined()
  })

  it('renders each split to one decimal place', async () => {
    stubFetch({ settings: [] })
    await renderPage()

    // Bottom bracket: 81.5 / 18.5.
    expect(screen.getByText('81.5%')).toBeDefined()
    expect(screen.getByText('18.5%')).toBeDefined()
    // Top bracket beyond Rp 50 juta.
    expect(
      screen.getByText(`${(PLATFORM_FEE_TOP_BRACKET.talentShare * 100).toFixed(1)}%`),
    ).toBeDefined()
  })

  it('prefers a stored bracket row over the constants when one exists', async () => {
    stubFetch({
      settings: [
        {
          ...SETTINGS[0],
          key: 'platform_fee_brackets',
          value: {
            brackets: [{ maxFee: 1_000_000, talentShare: 0.9, feeRate: 0.1 }],
            topBracket: { talentShare: 0.5, feeRate: 0.5 },
          },
        },
      ],
    })
    await renderPage()

    expect(await screen.findByText('<= Rp 1 jt')).toBeDefined()
    expect(screen.getByText('90.0%')).toBeDefined()
  })

  it('falls back to the constants when the stored row is malformed', async () => {
    stubFetch({
      settings: [{ ...SETTINGS[0], key: 'platform_fee_brackets', value: { brackets: [] } }],
    })
    await renderPage()

    expect(screen.getByText('81.5%')).toBeDefined()
  })

  /** No edit control: the engine reads the constants, not platform_settings. */
  it('offers no way to edit a bracket', async () => {
    stubFetch({ settings: [] })
    await renderPage()

    const table = screen.getByText('<= Rp 3 jt').closest('table')
    expect(table?.querySelectorAll('input, button, select')).toHaveLength(0)
  })
})

describe('language switch', () => {
  it('moves the console between the two supported locales', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()

    expect(screen.getByText('Bahasa Indonesia')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Switch to English' }))

    expect(await screen.findByRole('button', { name: 'Ganti ke Bahasa Indonesia' })).toBeDefined()
    expect(i18n.language).toBe('en')
  })
})
