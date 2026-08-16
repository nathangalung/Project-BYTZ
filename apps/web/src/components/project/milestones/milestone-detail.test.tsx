// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useToastStore } from '@/stores/toast'
import { MilestoneDetail } from './milestone-detail'
import type { MilestoneItem } from './shared'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
  useToastStore.setState({ toasts: [] })
})

const PAST = '2020-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function milestone(overrides: Partial<MilestoneItem> = {}): MilestoneItem {
  return {
    id: 'ms-1',
    title: 'Backend API',
    description: 'Endpoint autentikasi dan proyek',
    status: 'pending',
    amount: 5_000_000,
    dueDate: FUTURE,
    revisionCount: 0,
    assignedWorkerLabel: null,
    milestoneType: 'individual',
    orderIndex: 0,
    metadata: null,
    ...overrides,
  }
}

type Attachments = { files?: unknown[]; comments?: unknown[] }

function stubApi({ files = [], comments = [] }: Attachments = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: String(url).includes('/files') ? files : comments,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  )
}

function renderDetail(props: Partial<Parameters<typeof MilestoneDetail>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MilestoneDetail
        milestone={milestone()}
        onClose={vi.fn()}
        onStatusChange={vi.fn()}
        isMutating={false}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('MilestoneDetail', () => {
  it('names the milestone and shows what it is worth', () => {
    stubApi()
    renderDetail()

    expect(screen.getByRole('heading', { name: 'Backend API' })).toBeDefined()
    expect(screen.getByText('Rp 5.000.000')).toBeDefined()
  })

  it('closes from the overlay', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    stubApi()
    renderDetail({ onClose })

    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('marks an integration milestone as one', () => {
    stubApi()
    renderDetail({ milestone: milestone({ milestoneType: 'integration' }) })

    expect(screen.getByText('Milestone Integrasi')).toBeDefined()
  })

  it('shows a dash rather than a blank where there is no due date or talent', () => {
    stubApi()
    renderDetail({ milestone: milestone({ dueDate: null, assignedWorkerLabel: null }) })

    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  it('counts revisions against the two free rounds', () => {
    stubApi()
    renderDetail({ milestone: milestone({ revisionCount: 2 }) })

    expect(screen.getByText('2/2')).toBeDefined()
  })

  /**
   * Overdue is suppressed once the milestone is settled: one approved after
   * its due date is finished, not late.
   */
  it('colours an overdue due date and leaves a settled one alone', () => {
    stubApi()
    const { unmount } = renderDetail({ milestone: milestone({ dueDate: PAST }) })
    expect(screen.getByText('1 Januari 2020').className).toContain('text-accent-coral-600')
    unmount()

    renderDetail({ milestone: milestone({ dueDate: PAST, status: 'approved' }) })
    expect(screen.getByText('1 Januari 2020').className).toContain('text-brand-text')
  })

  describe('the attachments', () => {
    it('says so when there are none', async () => {
      stubApi({ files: [] })
      renderDetail()

      expect(await screen.findByText('Belum ada lampiran')).toBeDefined()
    })

    it('lists each attachment with its size and a download link', async () => {
      stubApi({
        files: [
          {
            id: 'f-1',
            milestoneId: 'ms-1',
            fileName: 'desain.pdf',
            fileUrl: 'https://files.example/desain.pdf',
            fileSize: 1_572_864,
            mimeType: 'application/pdf',
            uploadedBy: 'u-1',
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      })
      renderDetail()

      expect(await screen.findByText('desain.pdf')).toBeDefined()
      expect(screen.getByText('1.5 MB')).toBeDefined()
      expect(screen.getByRole('link', { name: 'Unduh' }).getAttribute('href')).toBe(
        'https://files.example/desain.pdf',
      )
    })

    it('degrades to an empty list when the request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
      )
      renderDetail()

      expect(await screen.findByText('Belum ada lampiran')).toBeDefined()
    })
  })

  describe('the deliverable checklist', () => {
    /**
     * The PRD defines what each milestone owes, and the checklist is what the
     * owner reviews against. With none defined the section is dropped rather
     * than rendered as an empty heading.
     */
    it('stays out of the panel when the PRD defined none', () => {
      stubApi()
      renderDetail({ milestone: milestone({ metadata: null }) })

      expect(screen.queryByText('Deliverable')).toBeNull()
    })

    it('lists each deliverable with its type and expectation', () => {
      stubApi()
      renderDetail({
        milestone: milestone({
          metadata: {
            deliverables: [{ title: 'Dokumentasi API', type: 'document', expected: 'OpenAPI 3.1' }],
          },
        }),
      })

      expect(screen.getByText('Dokumentasi API')).toBeDefined()
      expect(screen.getByText('document')).toBeDefined()
      expect(screen.getByText('OpenAPI 3.1')).toBeDefined()
    })

    it('renders a deliverable carrying only a title', () => {
      stubApi()
      renderDetail({
        milestone: milestone({ metadata: { deliverables: [{ title: 'Kode sumber' }] } }),
      })

      expect(screen.getByText('Kode sumber')).toBeDefined()
    })
  })

  describe('the feedback thread', () => {
    it('stays out of the panel when there is none', async () => {
      stubApi({ comments: [] })
      renderDetail()

      await screen.findByText('Belum ada lampiran')
      expect(screen.queryByText('Umpan Balik')).toBeNull()
    })

    /**
     * The thread is where a rejection or revision reason lands, so it is the
     * only place the talent learns what to change.
     */
    it('shows the reason a revision was asked for', async () => {
      stubApi({
        comments: [
          {
            id: 'c-1',
            userId: 'u-1',
            content: 'Endpoint login belum menangani OTP',
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      })
      renderDetail()

      expect(await screen.findByText('Endpoint login belum menangani OTP')).toBeDefined()
      expect(screen.getByText('Umpan Balik')).toBeDefined()
    })
  })

  describe('the actions', () => {
    /**
     * The transitions are split by role: the talent moves work forward and the
     * owner decides on it. Rendering the other side's control offers an action
     * the API refuses.
     */
    it.each([
      ['talent', 'pending', 'in_progress'],
      ['talent', 'in_progress', 'submitted'],
      ['talent', 'revision_requested', 'in_progress'],
    ])('lets a %s move a %s milestone to %s', async (role, status, next) => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      stubApi()
      renderDetail({ role, milestone: milestone({ status }), onStatusChange })

      const actions = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== 'Close')
      await user.click(actions[0])

      expect(onStatusChange).toHaveBeenCalledExactlyOnceWith('ms-1', next)
    })

    it.each([
      ['Setujui', 'approved'],
      ['Minta Revisi', 'revision_requested'],
      ['Tolak', 'rejected'],
    ])('lets an owner press %s on a submitted milestone', async (label, next) => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      stubApi()
      renderDetail({ role: 'owner', milestone: milestone({ status: 'submitted' }), onStatusChange })

      await user.click(screen.getByRole('button', { name: label }))

      expect(onStatusChange).toHaveBeenCalledExactlyOnceWith('ms-1', next)
    })

    it('offers an owner nothing on a milestone still being worked on', () => {
      stubApi()
      renderDetail({ role: 'owner', milestone: milestone({ status: 'in_progress' }) })

      expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull()
    })

    it('offers a talent nothing on a submitted milestone', () => {
      stubApi()
      renderDetail({ role: 'talent', milestone: milestone({ status: 'submitted' }) })

      expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Diajukan' })).toBeNull()
    })

    it('offers nothing at all when the role is unknown', () => {
      stubApi()
      renderDetail({ milestone: milestone({ status: 'submitted' }) })

      const actions = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== 'Close')
      expect(actions).toHaveLength(0)
    })

    it('refuses a second press while the first is in flight', async () => {
      const user = userEvent.setup()
      const onStatusChange = vi.fn()
      stubApi()
      renderDetail({
        role: 'owner',
        milestone: milestone({ status: 'submitted' }),
        onStatusChange,
        isMutating: true,
      })

      const approve = screen.getByRole('button', { name: 'Setujui' })
      expect((approve as HTMLButtonElement).disabled).toBe(true)
      await user.click(approve)

      expect(onStatusChange).not.toHaveBeenCalled()
    })
  })
})

describe('MilestoneDetail attachment upload', () => {
  /**
   * Presign, PUT straight to storage, then record the key. The browser never
   * posts the file through the API, so the backend only ever sees metadata.
   */
  function stubUpload({ failAt }: { failAt?: 'presign' | 'record' } = {}) {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({
          url: String(url),
          method,
          body: init?.body && method !== 'PUT' ? JSON.parse(String(init.body)) : undefined,
        })
        if (String(url).includes('/upload/presigned-url')) {
          return Promise.resolve(
            failAt === 'presign'
              ? new Response('{}', { status: 500 })
              : new Response(
                  JSON.stringify({ data: { url: 'https://storage.example/f.pdf?sig=abc' } }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
          )
        }
        if (method === 'PUT') return Promise.resolve(new Response('', { status: 200 }))
        if (method === 'POST') {
          return Promise.resolve(
            failAt === 'record'
              ? new Response('{}', { status: 500 })
              : new Response(JSON.stringify({ success: true, data: {} }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )
    return calls
  }

  async function upload(container: HTMLElement) {
    const user = userEvent.setup()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'desain.pdf', { type: 'application/pdf' }))
  }

  it('presigns, puts the file, then records it', async () => {
    const calls = stubUpload()
    const { container } = renderDetail()

    await upload(container)

    const presign = calls.find((c) => c.url.includes('/upload/presigned-url'))
    expect(presign?.body).toEqual({
      fileName: 'desain.pdf',
      fileType: 'application/pdf',
      folder: 'milestone',
    })
    expect(calls.some((c) => c.method === 'PUT')).toBe(true)
  })

  /**
   * The signature is stripped before the URL is stored: a recorded URL still
   * carrying its query string would expire and stop resolving.
   */
  it('records the URL without its signature', async () => {
    const calls = stubUpload()
    const { container } = renderDetail()

    await upload(container)

    const record = calls.find((c) => c.url.includes('/files') && c.method === 'POST')
    expect(record?.body).toEqual({
      fileName: 'desain.pdf',
      fileUrl: 'https://storage.example/f.pdf',
      fileSize: 1,
      mimeType: 'application/pdf',
    })
  })

  it('confirms the upload', async () => {
    stubUpload()
    const { container } = renderDetail()

    await upload(container)

    expect(useToastStore.getState().toasts[0]?.type).toBe('success')
  })

  it.each(['presign', 'record'] as const)(
    'reports a failure at the %s step rather than pretending it worked',
    async (failAt) => {
      stubUpload({ failAt })
      const { container } = renderDetail()

      await upload(container)

      expect(useToastStore.getState().toasts[0]?.type).toBe('error')
    },
  )
})
