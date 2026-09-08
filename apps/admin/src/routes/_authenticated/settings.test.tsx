// @vitest-environment jsdom
import {
  AUTO_RELEASE_DAYS,
  EXPLORATION_RATE,
  FREE_MILESTONE_REVISIONS,
  MATCHING_WEIGHTS,
  MAX_TEAM_SIZE,
  PLATFORM_FEE_BRACKETS,
  PLATFORM_FEE_TOP_BRACKET,
} from '@kerjacus/shared'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRouteWithQuery } from '@/lib/testing/harness'
import { useAuthStore } from '@/stores/auth'
import { Route } from './settings'

/**
 * Everything on this screen except the language toggle is read-only.
 *
 * It was not. Five controls wrote matching_weights, exploration_rate,
 * auto_release_days, free_revision_rounds and max_team_size to platform_settings
 * and no engine ever read that table - the services read the compiled constants.
 * The console showed what it had stored while the platform behaved by the code,
 * and admin-service wrote a config.update audit row for each save, so the audit
 * trail recorded policy changes that never took effect.
 *
 * These tests now hold the opposite line: the page must show the values the
 * engine actually runs on, and must offer no way to pretend otherwise.
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

type Options = {
  settings?: unknown[]
  listFails?: boolean
}

function stubFetch(options: Options = {}) {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    // Nothing on this page writes any more; a PATCH reaching here is the
    // regression these tests exist to catch.
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({ success: true }) }
    if (options.listFails) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, json: async () => ({ success: true, data: options.settings ?? SETTINGS }) }
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

const renderPage = () => renderRouteWithQuery({ Route })

function patchCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
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

describe('the values the engine actually runs on', () => {
  it('shows each compiled constant rather than the stored row', async () => {
    stubFetch()
    await renderPage()

    expect(await screen.findByText(String(AUTO_RELEASE_DAYS))).toBeDefined()
    expect(screen.getByText(String(FREE_MILESTONE_REVISIONS))).toBeDefined()
    expect(screen.getByText(String(MAX_TEAM_SIZE))).toBeDefined()
    expect(screen.getByText(`${Math.round(EXPLORATION_RATE * 100)}%`)).toBeDefined()
  })

  /**
   * The stored row said two free revisions long after the constant moved to
   * three. Reading the constant is what makes that impossible rather than
   * merely unlikely.
   */
  it('ignores a stored value that disagrees with the constant', async () => {
    stubFetch({
      settings: [{ ...SETTINGS[3], value: 99 }],
    })
    await renderPage()

    expect(await screen.findByText(String(FREE_MILESTONE_REVISIONS))).toBeDefined()
    expect(screen.queryByText('99')).toBeNull()
  })

  it('spells out every matching weight', async () => {
    stubFetch()
    await renderPage()

    const shown = await screen.findByText(/Kecocokan Skill|Skill match/)
    const row = shown.closest('div')?.parentElement
    for (const weight of Object.values(MATCHING_WEIGHTS)) {
      expect(row?.textContent, String(weight)).toContain(`${Math.round(weight * 100)}%`)
    }
  })

  it('still reports a failed load', async () => {
    stubFetch({ listFails: true })
    await renderPage()

    expect(await screen.findByText('Gagal memuat data')).toBeDefined()
  })

  /** The whole point: no lever that writes a value nothing reads. */
  it('offers no control that writes a setting', async () => {
    const spy = stubFetch()
    await renderPage()
    await screen.findByText(String(AUTO_RELEASE_DAYS))

    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Simpan/ })).toBeNull()
    expect(patchCalls(spy)).toHaveLength(0)
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

/** The switch has to work in both directions, not just away from the default. */
describe('switching the language back', () => {
  it('returns to Indonesian from English', async () => {
    const user = userEvent.setup()
    stubFetch()
    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Switch to English' }))
    await user.click(await screen.findByRole('button', { name: 'Ganti ke Bahasa Indonesia' }))

    expect(await screen.findByRole('button', { name: 'Switch to English' })).toBeDefined()
    expect(i18n.language).toBe('id')
  })
})
