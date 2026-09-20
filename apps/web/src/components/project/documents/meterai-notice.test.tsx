// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ContractItem } from '@/hooks/use-projects'
import i18n from '@/lib/i18n'
import { MeteraiNotice } from './meterai-notice'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function contract(overrides: Partial<ContractItem> = {}): ContractItem {
  return {
    id: 'c1',
    type: 'standard_nda',
    signedByOwner: false,
    signedByTalent: false,
    signedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    meteraiRequired: true,
    meteraiDocumentUrl: null,
    meteraiAffixedAt: null,
    ...overrides,
  }
}

function renderNotice(contracts: ContractItem[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MeteraiNotice contracts={contracts} projectId="p1" />
    </QueryClientProvider>,
  )
}

describe('MeteraiNotice', () => {
  it('renders nothing when no contract needs a stamp', () => {
    const { container } = renderNotice([contract({ meteraiRequired: false })])
    expect(container.querySelector('section')).toBeNull()
  })

  it('links to the official portal and offers an upload for a required contract', () => {
    renderNotice([contract()])
    const link = screen.getByRole('link', { name: /e-meterai\.co\.id/i })
    expect(link.getAttribute('href')).toBe('https://e-meterai.co.id')
    // Throws if absent.
    screen.getByRole('button')
  })

  it('shows the stamped state and links to the stamped copy when affixed', () => {
    renderNotice([
      contract({
        meteraiAffixedAt: '2026-02-01T00:00:00.000Z',
        meteraiDocumentUrl: 'https://storage.test/stamped.pdf',
      }),
    ])
    const link = screen.getByRole('link', { name: /bermeterai/i })
    expect(link.getAttribute('href')).toBe('https://storage.test/stamped.pdf')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uploads a stamped copy and records it', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url)
        calls.push(href)
        if (href.includes('/presigned-url')) {
          return new Response(
            JSON.stringify({
              data: { url: 'https://storage.test/put?sig=1', contentType: 'application/pdf' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (href.includes('/meterai')) {
          return new Response(JSON.stringify({ success: true, data: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(null, { status: 200 })
      }),
    )

    renderNotice([contract()])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'contract.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(calls.some((c) => c.includes('/meterai'))).toBe(true)
    })
  })

  it('does not record the stamp when the upload fails', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url)
        calls.push(href)
        // Presign fails, so nothing is uploaded and /meterai is never called.
        return new Response(null, { status: 500 })
      }),
    )

    renderNotice([contract()])
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'contract.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(calls.some((c) => c.includes('/presigned-url'))).toBe(true)
    })
    expect(calls.some((c) => c.includes('/meterai'))).toBe(false)
  })
})
