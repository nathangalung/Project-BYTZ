// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * getInitialTheme and its applyTheme run at module load, so which branch fires
 * is decided before any test body does. Each case re-imports behind a stubbed
 * localStorage and matchMedia rather than calling a setter afterwards.
 */

function stubPrefersDark(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

async function loadStore() {
  vi.resetModules()
  const mod = await import('./theme')
  return mod.useThemeStore
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  stubPrefersDark(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initial theme', () => {
  it('restores the stored choice over the system preference', async () => {
    localStorage.setItem('kerjacus-theme', 'dark')
    stubPrefersDark(false)

    const useThemeStore = await loadStore()

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('honours a stored light choice against a dark system preference', async () => {
    localStorage.setItem('kerjacus-theme', 'light')
    stubPrefersDark(true)

    const useThemeStore = await loadStore()

    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('falls back to the system preference with nothing stored', async () => {
    stubPrefersDark(true)

    const useThemeStore = await loadStore()

    expect(useThemeStore.getState().theme).toBe('dark')
  })

  /** A value written by an older build must not be treated as a theme. */
  it('ignores an unrecognised stored value', async () => {
    localStorage.setItem('kerjacus-theme', 'solarized')
    stubPrefersDark(true)

    const useThemeStore = await loadStore()

    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('defaults to light when the system expresses no preference', async () => {
    stubPrefersDark(false)

    const useThemeStore = await loadStore()

    expect(useThemeStore.getState().theme).toBe('light')
  })
})

/**
 * The class on <html> is what Tailwind reads and localStorage is what the next
 * page load reads. A setter that updates the store but not both leaves the
 * page styled for the theme the user just left.
 */
describe('changing the theme', () => {
  it('toggle flips the class and persists the new value', async () => {
    const useThemeStore = await loadStore()

    useThemeStore.getState().toggleTheme()

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('kerjacus-theme')).toBe('dark')
  })

  it('toggling twice returns to the starting theme', async () => {
    const useThemeStore = await loadStore()

    useThemeStore.getState().toggleTheme()
    useThemeStore.getState().toggleTheme()

    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('kerjacus-theme')).toBe('light')
  })

  it('setTheme applies the requested theme directly', async () => {
    const useThemeStore = await loadStore()

    useThemeStore.getState().setTheme('dark')

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('kerjacus-theme')).toBe('dark')
  })

  it('setTheme back to light removes the class again', async () => {
    const useThemeStore = await loadStore()
    useThemeStore.getState().setTheme('dark')

    useThemeStore.getState().setTheme('light')

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('kerjacus-theme')).toBe('light')
  })
})
